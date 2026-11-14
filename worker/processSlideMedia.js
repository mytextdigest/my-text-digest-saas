// worker/processSlideMedia.js
// Slide media jobs (spec D3), on their own queue (SQS_MEDIA_QUEUE_URL) and
// poll loop so a minute-long narration run or a video never holds up other
// users' document processing:
//   - talking-points:     whole-deck talking points (one long LLM call)
//   - narration:          scripts + AI voices (whole deck, or one slide
//                         whose script must be written first)
//   - talking-points-pdf: the talking points as a PDF (headless Chromium)
//   - deck-video:         the deck as an MP4 (headless Chromium + ffmpeg)
//   - audio-remux:        fixes a WebM recording's header (real duration)
//
// Each job updates its SlideDeckJob row (status, phase/done/total, result)
// where desktop sent IPC progress events; the client polls the row. A cancel
// flips the row to "cancelled" and the job's AbortController stops the
// OpenAI / ffmpeg work between steps. Every error lands on the row — these
// jobs never touch Document.status.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prisma } from "../src/lib/prisma.mjs";
import { getOpenAIForDocument } from "../src/lib/openaiForDocument.js";
import { buildTalkingPointsPdfHtml } from "../src/lib/slides/talkingPoints.js";
import {
  loadEditableOutline, updateJob, watchJobCancel, jobAbortController, slugify, exportPrefix, s3PutBytes, s3GetBytes,
  enqueueMediaJob,
} from "../src/lib/slides/deckServer.js";
import { loadTalkingPoints, generateAndStoreTalkingPoints } from "../src/lib/slides/talkingPointsServer.js";
import {
  loadSlideAudio, loadSettings, planNarrationAudio, generateNarrationAudio, friendlyTtsError,
} from "../src/lib/slides/narrationServer.js";
import { renderStage, encodeStage, removeWorkFiles, renderPdf, removeTempDir } from "./deckVideo.js";
import { probeDurationMs, remuxInPlace } from "./ffmpeg.js";

export const MEDIA_JOB_TYPES = ["talking-points", "narration", "talking-points-pdf", "deck-video", "audio-remux"];

function userMessage(err, fallback) {
  const m = String(err?.message || err || "");
  if (/OPENAI_KEY_MISSING/.test(m)) return "Add your OpenAI API key in Settings first.";
  return m || fallback;
}

async function editableDeck(deckId) {
  const { deck, outline, error } = await loadEditableOutline(prisma, deckId);
  if (error) throw new Error(error);
  if (deck.status !== "ready") throw new Error("Wait for the current edit to finish first.");
  return { deck, outline };
}

const handlers = {
  "talking-points": async ({ deckId }, { signal }) => {
    const { deck, outline } = await editableDeck(deckId);
    const openai = await getOpenAIForDocument(deck.documentId);
    const { missing } = await generateAndStoreTalkingPoints(prisma, { deck, outline, openai, signal });
    return { result: { missing } };
  },

  narration: async ({ deckId, slideId, rewriteScript, redoAll }, { signal, progress }) => {
    const { deck, outline } = await editableDeck(deckId);
    const points = await loadTalkingPoints(prisma, deckId);
    const plan = await planNarrationAudio(prisma, {
      deckId, outline, points, slideId: slideId || undefined, rewriteScript: !!rewriteScript, redoAll: !!redoAll,
    });
    if (plan.error) throw new Error(plan.error);
    if (plan.skipped) return { result: { success: true, generated: 0, failed: 0, skipped: true } };
    const openai = await getOpenAIForDocument(deck.documentId);
    const { audio, ...result } = await generateNarrationAudio(prisma, {
      deckId, outline, points, plan, openai, signal, onProgress: progress,
    });
    if (result.cancelled) return { status: "cancelled", result };
    return { result };
  },

  "talking-points-pdf": async ({ deckId }) => {
    const { deck, outline, error } = await loadEditableOutline(prisma, deckId);
    if (error) throw new Error(error);
    const points = await loadTalkingPoints(prisma, deckId);
    if (!outline.slides.some((s) => points[s.id]?.html)) throw new Error("Generate talking points first.");
    const pdf = await renderPdf(buildTalkingPointsPdfHtml({ outline, points }));
    const base = slugify(outline.title || deck.title || "deck");
    const s3Key = `${exportPrefix(deckId)}${base}-talking-points-${Date.now()}.pdf`;
    await s3PutBytes(s3Key, pdf, "application/pdf");
    return { result: { s3Key, filename: `${base}-talking-points.pdf` } };
  },

  // Staged (worker/deckVideo.js): the first message renders and starts
  // encoding; when a stage runs out of time it re-queues the job with
  // {stage: "encode", next} and a later message carries on.
  "deck-video": async ({ deckId, jobId, stage, next }, { signal, progress, startedAt }) => {
    let dir = null;
    let from = 0;
    try {
      if (stage !== "encode") {
        const { deck, outline } = await editableDeck(deckId);
        const audio = await loadSlideAudio(prisma, deckId);
        const audioRows = Object.fromEntries((await prisma.slideAudio.findMany({ where: { deckId } })).map((r) => [r.slideId, r]));
        ({ dir } = await renderStage({
          deckId,
          jobId,
          outline,
          points: await loadTalkingPoints(prisma, deckId),
          audio,
          audioRows,
          settings: await loadSettings(prisma, deckId),
          filenameBase: slugify(outline.title || deck.title || "deck"),
          signal,
          onProgress: progress,
        }));
      } else {
        from = Number(next) || 0;
      }

      const out = await encodeStage({ deckId, jobId, from, dir, startedAt, signal, onProgress: progress });
      if (out.next !== undefined) {
        await enqueueMediaJob({ type: "deck-video", jobId, deckId, stage: "encode", next: out.next });
        console.log(`⏩ deck-video ${jobId}: out of time for this stage, continuing from slide ${out.next + 1}`);
        return { status: "running" };
      }
      dir = out.dir;
      const s3Key = `${exportPrefix(deckId)}${out.filenameBase}-${Date.now()}.mp4`;
      await s3PutBytes(s3Key, fs.readFileSync(out.file), "video/mp4");
      await removeWorkFiles(deckId, jobId);
      return { result: { s3Key, filename: `${out.filenameBase}.mp4`, durationMs: out.durationMs } };
    } catch (err) {
      await removeWorkFiles(deckId, jobId);
      throw err;
    } finally {
      removeTempDir(dir);
    }
  },

  // MediaRecorder's WebM has no duration in its header; a stream-copy remux
  // writes one (desktop did this before saving). Only if the slide still
  // uses this exact clip.
  "audio-remux": async ({ deckId, slideId, s3Key }) => {
    const row = await prisma.slideAudio.findUnique({ where: { deckId_slideId: { deckId, slideId } } });
    if (!row || row.s3Key !== s3Key) return { result: { skipped: true } };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtd-remux-"));
    try {
      const file = path.join(dir, `clip${path.extname(s3Key)}`);
      fs.writeFileSync(file, await s3GetBytes(s3Key));
      const replaced = await remuxInPlace(file);
      const ms = await probeDurationMs(file);
      if (replaced) await s3PutBytes(s3Key, fs.readFileSync(file), row.mime || "audio/webm");
      const fresh = await prisma.slideAudio.findUnique({ where: { deckId_slideId: { deckId, slideId } } });
      if (ms && fresh?.s3Key === s3Key) {
        await prisma.slideAudio.update({ where: { deckId_slideId: { deckId, slideId } }, data: { durationMs: ms } });
      }
      return { result: { remuxed: replaced, durationMs: ms } };
    } finally {
      fs.rm(dir, { recursive: true, force: true }, () => {});
    }
  },
};

export async function processSlideMediaJob(job) {
  const handler = handlers[job.type];
  if (!handler) throw new Error(`Unknown slide media job: ${job.type}`);
  const row = job.jobId ? await prisma.slideDeckJob.findUnique({ where: { id: job.jobId } }) : null;
  // A continuation (a staged video's next stage) finds its job already running.
  const continuation = job.stage === "encode";
  const expected = continuation ? "running" : "queued";
  if (!row || row.status !== expected) {
    console.log(`⏭️  Slide media job ${job.jobId} skipped (${row ? row.status : "missing"})`);
    if (continuation && row && (row.status === "cancelled" || row.status === "error")) await removeWorkFiles(job.deckId, job.jobId);
    return;
  }
  const startedAt = Date.now();
  await updateJob(prisma, row.id, { status: "running" });
  console.log(`🎬 Slide media job ${job.type}${continuation ? ` (continues at slide ${Number(job.next) + 1})` : ""} started: deck ${job.deckId} (${row.id})`);

  const controller = jobAbortController();
  const stopWatching = watchJobCancel(prisma, row.id, controller);
  let lastProgressAt = 0;
  const progress = async (phase, done, total) => {
    // Throttled, except phase changes and the last step of a phase.
    const t = Date.now();
    if (done !== 0 && done !== total && t - lastProgressAt < 400) return;
    lastProgressAt = t;
    await updateJob(prisma, row.id, { phase, done, total });
  };

  try {
    const out = await handler(job, { signal: controller.signal, progress, startedAt });
    const fresh = await prisma.slideDeckJob.findUnique({ where: { id: row.id }, select: { status: true } });
    if (fresh?.status === "error") return; // the watchdog already gave up on it
    const status = controller.signal.aborted || fresh?.status === "cancelled" ? "cancelled" : (out?.status || "done");
    await updateJob(prisma, row.id, { status, result: out?.result ?? null });
    console.log(`✅ Slide media job ${job.type} ${status}: deck ${job.deckId} (${row.id})`);
  } catch (err) {
    if (err?.cancelled || controller.signal.aborted) {
      const fresh = await prisma.slideDeckJob.findUnique({ where: { id: row.id }, select: { status: true } });
      if (fresh?.status !== "error") await updateJob(prisma, row.id, { status: "cancelled" });
      console.log(`🛑 Slide media job ${job.type} cancelled: deck ${job.deckId} (${row.id})`);
      return;
    }
    console.error(`❌ Slide media job ${job.type} failed: deck ${job.deckId} (${row.id})`, err);
    await updateJob(prisma, row.id, {
      status: "error",
      error: job.type === "narration" ? friendlyTtsError(err?.message) : userMessage(err, "Something went wrong."),
    });
  } finally {
    stopWatching();
  }
}

// The watchdog timed the job out (only path that reaches recordJobFailure —
// processSlideMediaJob catches everything else). Mark the row failed; the
// job's cancel watcher sees it and aborts the work still running.
export async function failSlideMediaJob(body, err) {
  if (!body?.jobId) return;
  try {
    await prisma.slideDeckJob.updateMany({
      where: { id: body.jobId, status: { in: ["queued", "running"] } },
      data: { status: "error", error: /JOB_TIMEOUT|timed out/i.test(String(err?.message)) ? "This took too long and was stopped. Please try again." : String(err?.message || err).slice(0, 2000) },
    });
  } catch (updateErr) {
    console.error("❌ Failed to record slide media job failure:", updateErr.message);
  }
}
