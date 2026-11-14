// src/lib/slides/narrationServer.js
// Slide narration storage + generation (SLIDE_AUDIO_ROADMAP.md Phases 1, 3–5)
// — a port of desktop electron/slideAudio.js with the same function names.
// Shared by the narration routes and the worker's `narration` /
// `audio-remux` jobs; this is the one place the narration rules live
// server-side.
//
// One clip per slide in the slide_audio table, keyed by the slide's stable id
// (like slide_talking_points), so clips follow reorders, survive AI edits and
// come back with an undo-delete. Audio bytes live in S3 under
// slide-audio/<deckId>/ (desktop: userData/slide-audio/<deckId>/) and reach
// the browser through the authed GET /api/slide-audio/[deckId]/[slideId]/file,
// which redirects to a short-lived signed URL.
//
// These functions only ever READ the outline, so nothing here races the
// read-buildDeck-write mutation routes.

import crypto from "node:crypto";
import pLimit from "p-limit";
import { textHash, talkingPointsHash, talkingPointsToPlainText, slideContentView } from "./talkingPoints.js";
import {
  AUDIO_TYPES, VOICE_PREVIEW_TEXT, TTS_MAX_SCRIPT_CHARS,
  normalizeNarrationSettings, mp3DurationMs, wavDurationMs,
  generateNarrationScripts, synthesizeSpeech,
  slideNumberSources, checkScriptNumbers, describeNumberProblem,
} from "./narration.js";
import { s3PutBytes, s3Copy, s3Delete, s3DeletePrefix, s3Exists, s3SignedGetUrl } from "./deckServer.js";

const SCRIPT_BATCH = 3;      // slides per script-writing LLM call (small = fewer slips)
const TTS_CONCURRENCY = 3;

export const AUDIO_PREFIX = "slide-audio";

export function deckAudioPrefix(deckId) {
  return `${AUDIO_PREFIX}/${deckId}/`;
}

function safeSlideId(slideId) {
  return String(slideId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "slide";
}

// slide-audio/<deckId>/<slideId>-<ts>-<rand>.<ext>. Each saved clip gets a
// unique key, so a replaced clip never plays from cache.
export function clipKey(deckId, slideId, ext) {
  return `${deckAudioPrefix(deckId)}${safeSlideId(slideId)}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}${ext}`;
}

// True when `key` is a clip key this deck/slide could have been issued.
export function isClipKeyFor(key, deckId, slideId) {
  return typeof key === "string"
    && key.startsWith(`${deckAudioPrefix(deckId)}${safeSlideId(slideId)}-`)
    && !key.includes("..")
    && !!AUDIO_TYPES[extOf(key)];
}

export function extOf(key) {
  const m = /\.[a-z0-9]+$/i.exec(String(key || ""));
  return m ? m[0].toLowerCase() : "";
}

// The browser plays a clip through this route; `v` changes with the object,
// so a replaced clip is never served from cache.
function clipUrl(deckId, slideId, s3Key) {
  const v = String(s3Key).split("/").pop().replace(/\.[a-z0-9]+$/i, "");
  return `/api/slide-audio/${encodeURIComponent(deckId)}/${encodeURIComponent(slideId)}/file?v=${encodeURIComponent(v)}`;
}

function getRow(prisma, deckId, slideId) {
  return prisma.slideAudio.findUnique({ where: { deckId_slideId: { deckId, slideId } } });
}

export async function loadSlideAudio(prisma, deckId) {
  const rows = await prisma.slideAudio.findMany({ where: { deckId } });
  const audio = {};
  rows.forEach((r) => {
    const exists = !!r.s3Key;
    audio[r.slideId] = {
      source: exists ? r.source : null,
      url: exists ? clipUrl(deckId, r.slideId, r.s3Key) : null,
      mime: exists ? r.mime : null,
      durationMs: exists ? r.durationMs : null,
      script: r.script || "",
      scriptOrigin: r.scriptOrigin || null,
      notesHash: r.notesHash || null,
      voice: r.voice || null,
      audioScriptHash: r.audioScriptHash || null,
      numbersOkHash: r.numbersOkHash || null,
      updatedAt: r.updatedAt,
    };
  });
  return audio;
}

export async function loadSettings(prisma, deckId) {
  const r = await prisma.slideNarrationSettings.findUnique({ where: { deckId } });
  return normalizeNarrationSettings(r ? { voice: r.voice, tone: r.tone, gapMs: r.gapMs } : null);
}

export async function saveSettings(prisma, deckId, { voice, tone, gapMs } = {}) {
  const next = normalizeNarrationSettings({
    ...(await loadSettings(prisma, deckId)),
    ...(voice !== undefined && { voice }),
    ...(tone !== undefined && { tone }),
    ...(gapMs !== undefined && { gapMs }),
  });
  await prisma.slideNarrationSettings.upsert({
    where: { deckId },
    create: { deckId, voice: next.voice, tone: next.tone, gapMs: next.gapMs },
    update: { voice: next.voice, tone: next.tone, gapMs: next.gapMs },
  });
  return next;
}

const ROW_FIELDS = [
  "source", "s3Key", "mime", "durationMs", "script", "scriptOrigin",
  "notesHash", "voice", "audioScriptHash", "numbersOkHash",
];

// Upserts the given columns of one slide's row, leaving the others as they are.
export async function upsert(prisma, deckId, slideId, fields) {
  const existing = await getRow(prisma, deckId, slideId);
  const row = {};
  ROW_FIELDS.forEach((k) => {
    row[k] = k in fields ? fields[k] : (existing ? existing[k] : null);
  });
  await prisma.slideAudio.upsert({
    where: { deckId_slideId: { deckId, slideId } },
    create: { deckId, slideId, ...row },
    update: row,
  });
  // A replaced clip's old object is no longer referenced.
  if (existing?.s3Key && existing.s3Key !== row.s3Key) await s3Delete(existing.s3Key);
}

export function measureDuration(ext, bytes, fallbackMs) {
  let ms = null;
  try {
    if (ext === ".mp3") ms = mp3DurationMs(bytes);
    else if (ext === ".wav") ms = wavDurationMs(bytes);
  } catch (e) { ms = null; }
  if (!ms) {
    const fb = Number(fallbackMs);
    ms = Number.isFinite(fb) && fb > 0 ? Math.round(fb) : null;
  }
  return ms;
}

// ---------------------------------------------------------------------------
// Lifecycle hooks used by the slide-deck routes
// ---------------------------------------------------------------------------

// duplicate-slide: the clone gets its own copy of the row and the object, so
// replacing one slide's clip never touches the other.
export async function copySlideAudio(prisma, deckId, fromSlideId, toSlideId) {
  const row = await getRow(prisma, deckId, fromSlideId);
  if (!row) return;
  let s3Key = null;
  if (row.s3Key) {
    const next = clipKey(deckId, toSlideId, extOf(row.s3Key));
    try {
      await s3Copy(row.s3Key, next);
      s3Key = next;
    } catch (err) {
      console.error("⚠️  Could not copy a narration clip for a duplicated slide:", err.message || err);
    }
  }
  const fields = {};
  ROW_FIELDS.forEach((k) => { fields[k] = row[k]; });
  await upsert(prisma, deckId, toSlideId, { ...fields, s3Key, source: s3Key ? row.source : null });
}

export async function deleteDeckAudio(prisma, deckId) {
  await prisma.slideAudio.deleteMany({ where: { deckId } });
  await prisma.slideNarrationSettings.deleteMany({ where: { deckId } });
  await s3DeletePrefix(deckAudioPrefix(deckId)); // best effort
}

// ---------------------------------------------------------------------------
// Script + voice generation
// ---------------------------------------------------------------------------

// The number check for one slide's script (narration.js checkScriptNumbers).
export function numberCheck(slide, points, script) {
  const notesText = points[slide.id]?.html ? talkingPointsToPlainText(points[slide.id].html) : "";
  return checkScriptNumbers(script, slideNumberSources(slide, notesText), notesText);
}

// A script may be voiced when its figures check out, or the user confirmed
// this exact script's figures.
export function numbersCleared(slide, points, row) {
  const script = row?.script || "";
  return numberCheck(slide, points, script).ok || (!!row?.numbersOkHash && row.numbersOkHash === textHash(script));
}

export function scriptItem(outline, points, index) {
  const slide = outline.slides[index];
  const p = points[slide.id];
  return {
    index,
    content: slideContentView(slide),
    notesText: p?.html ? talkingPointsToPlainText(p.html) : "",
    seconds: p?.seconds || null,
  };
}

async function liveSlideIds(prisma, deckId) {
  const fresh = await prisma.slideDeck.findUnique({ where: { id: deckId }, select: { outlineJson: true } });
  return new Set((fresh?.outlineJson?.slides || []).map((s) => s.id));
}

function abortError() {
  const e = new Error("Cancelled.");
  e.cancelled = true;
  return e;
}

// Writes scripts for `indices` (batched), storing each with the notes hash it
// was written from. Returns the number of slides that got one.
export async function writeScripts(prisma, { deckId, outline, points, indices, openai, signal, onProgress }) {
  let done = 0;
  for (let i = 0; i < indices.length; i += SCRIPT_BATCH) {
    if (signal?.aborted) throw abortError();
    const batch = indices.slice(i, i + SCRIPT_BATCH);
    const items = batch.map((idx) => scriptItem(outline, points, idx));
    let results;
    try {
      results = await generateNarrationScripts({
        openai, deckTitle: outline.title, items, totalSlides: outline.slides.length, signal,
      });
    } catch (err) {
      if (signal?.aborted) throw abortError();
      if (indices.length === 1) throw err;
      console.error("❌ Narration script batch failed:", err.message);
      results = new Map();
    }
    // Number check: a script quoting a figure that isn't on the slide or in
    // its notes gets one retry on its own, with no randomness and the wrong
    // figures spelled out. If it still fails it's stored anyway, flagged, and
    // the voice step refuses it until fixed or confirmed.
    for (const [idx, script] of [...results]) {
      const check = numberCheck(outline.slides[idx], points, script);
      if (check.ok) continue;
      if (signal?.aborted) throw abortError();
      console.warn(`⚠️ Narration script for slide ${idx + 1} failed the number check: ${describeNumberProblem(check)}. Retrying.`);
      try {
        const retry = await generateNarrationScripts({
          openai, deckTitle: outline.title, totalSlides: outline.slides.length, signal, temperature: 0,
          items: [{
            ...scriptItem(outline, points, idx),
            correction: `Your previous script was wrong: ${describeNumberProblem(check)}. Use ONLY numbers that appear in "slide" or "talkingPoints", in digits, copied exactly.`,
          }],
        });
        const again = retry.get(idx);
        if (again && numberCheck(outline.slides[idx], points, again).ok) results.set(idx, again);
      } catch (err) {
        if (signal?.aborted) throw abortError();
        console.error("❌ Narration script retry failed:", err.message);
      }
    }

    const liveIds = await liveSlideIds(prisma, deckId);
    for (const [idx, script] of results) {
      const slide = outline.slides[idx];
      if (!liveIds.has(slide.id)) continue;
      await upsert(prisma, deckId, slide.id, {
        script, scriptOrigin: "ai", notesHash: talkingPointsHash(points[slide.id]?.html || ""),
      });
      done += 1;
    }
    await onProgress?.(Math.min(indices.length, i + batch.length));
  }
  return done;
}

// Hand-edited script. Keeps notes_hash (editing the wording isn't confirming
// it matches changed notes) unless `markCurrent` ("Keep as is").
export async function saveNarrationScript(prisma, { deckId, outline, points, slideId, script, markCurrent, confirmNumbers }) {
  if (!outline.slides.some((s) => s.id === slideId)) return { success: false, error: "That slide no longer exists." };
  const existing = await getRow(prisma, deckId, slideId);
  const fields = {};
  if (typeof script === "string") {
    fields.script = script.replace(/\r\n/g, "\n").slice(0, TTS_MAX_SCRIPT_CHARS);
    fields.scriptOrigin = "user";
  }
  if (markCurrent || !existing?.notesHash) fields.notesHash = talkingPointsHash(points[slideId]?.html || "");
  if (markCurrent && existing?.source === "generated" && existing.script) {
    // "Keep as is" on a stale AI clip: accept the clip as matching too.
    fields.audioScriptHash = textHash(existing.script);
  }
  // "The numbers are correct": accept this exact script's figures.
  if (confirmNumbers) fields.numbersOkHash = textHash(typeof fields.script === "string" ? fields.script : (existing?.script || ""));
  await upsert(prisma, deckId, slideId, fields);
  return { success: true, audio: await loadSlideAudio(prisma, deckId) };
}

// Which slides an AI narration run touches — desktop generate-narration-audio's
// selection, factored out so the route can answer `skipped` (and decide
// whether the work fits inline) before a job is queued.
// AI narration for one slide (`slideId`) or the whole deck. Whole deck =
// every slide with no clip or an out-of-date AI clip; uploaded and recorded
// clips are never replaced. A slide whose script is missing — or AI-written
// and out of date, or `rewriteScript` — gets a new script first.
// `redoAll`: whole deck, also re-voicing up-to-date AI clips (e.g. after
// changing the voice). Uploaded and recorded clips are never replaced in a
// whole-deck run.
export async function planNarrationAudio(prisma, { deckId, outline, points, slideId, rewriteScript, redoAll }) {
  const single = typeof slideId === "string" && slideId;
  const audio = await loadSlideAudio(prisma, deckId);
  const rows = new Map((await prisma.slideAudio.findMany({ where: { deckId } })).map((r) => [r.slideId, r]));
  const notesHashOf = (s) => talkingPointsHash(points[s.id]?.html || "");
  const isStale = (s) => {
    const a = audio[s.id];
    if (!a?.url || a.source !== "generated") return false;
    const scriptStale = !!a.script && !!a.notesHash && a.notesHash !== notesHashOf(s);
    // An AI clip spoken from a script whose figures don't check out (made
    // before the number check existed) is redone too.
    return scriptStale || (!!a.audioScriptHash && a.audioScriptHash !== textHash(a.script))
      || !numbersCleared(s, points, rows.get(s.id));
  };

  let targets;
  if (single) {
    const idx = outline.slides.findIndex((s) => s.id === slideId);
    if (idx < 0) return { error: "That slide no longer exists." };
    targets = [idx];
  } else {
    targets = outline.slides.map((s, i) => i).filter((i) => {
      const s = outline.slides[i];
      const a = audio[s.id];
      if (!a?.url) return true;
      if (a.source !== "generated") return false;
      return redoAll || isStale(s);
    });
    if (targets.length === 0) return { skipped: true, audio };
  }

  const needsScript = targets.filter((i) => {
    const s = outline.slides[i];
    const a = audio[s.id];
    if (!a?.script?.trim()) return true;
    if (single && rewriteScript) return true;
    if (a.scriptOrigin === "user") return false; // never overwrite the user's own wording
    const scriptStale = !!a.notesHash && a.notesHash !== notesHashOf(s);
    return scriptStale || !numbersCleared(s, points, rows.get(s.id));
  });

  return { targets, needsScript, single: !!single };
}

// Runs a planned narration: scripts first where needed, then the voices.
// `onProgress(phase, done, total)` replaces desktop's slide-audio:progress
// event. Returns desktop's result shape.
export async function generateNarrationAudio(prisma, { deckId, outline, points, plan, openai, signal, onProgress }) {
  const { targets, needsScript, single } = plan;
  const settings = await loadSettings(prisma, deckId);
  const progress = async (phase, done, total) => { await onProgress?.(phase, done, total); };

  try {
    if (needsScript.length) {
      await progress("script", 0, needsScript.length);
      await writeScripts(prisma, {
        deckId, outline, points, indices: needsScript, openai, signal,
        onProgress: (done) => progress("script", done, needsScript.length),
      });
    }

    const limit = pLimit(TTS_CONCURRENCY);
    let done = 0;
    let generated = 0;
    const failures = [];
    const blocked = []; // slides whose script failed the number check
    await progress("audio", 0, targets.length);
    await Promise.all(targets.map((idx) => limit(async () => {
      if (signal?.aborted) return;
      const s = outline.slides[idx];
      const row = await getRow(prisma, deckId, s.id);
      const script = row?.script?.trim();
      try {
        if (!script) throw new Error("No script.");
        if (!numbersCleared(s, points, row)) {
          blocked.push({ index: idx, problem: describeNumberProblem(numberCheck(s, points, row.script)) });
          return;
        }
        const bytes = await synthesizeSpeech({ openai, text: script, voice: settings.voice, tone: settings.tone, signal });
        const ms = mp3DurationMs(bytes);
        if (!ms) throw new Error("The voice service returned no audio.");
        if (!(await liveSlideIds(prisma, deckId)).has(s.id)) return; // deleted mid-generation
        const key = clipKey(deckId, s.id, ".mp3");
        await s3PutBytes(key, bytes, "audio/mpeg");
        await upsert(prisma, deckId, s.id, {
          source: "generated", s3Key: key, mime: "audio/mpeg", durationMs: ms,
          voice: settings.voice, audioScriptHash: textHash(script),
        });
        generated += 1;
      } catch (err) {
        if (signal?.aborted) return;
        console.error(`❌ Narration audio failed for slide ${idx + 1}:`, err.message);
        failures.push({ index: idx, error: err.message });
      } finally {
        done += 1;
        await progress("audio", done, targets.length);
      }
    })));

    if (signal?.aborted) return { success: false, cancelled: true, audio: await loadSlideAudio(prisma, deckId) };
    if (single && blocked.length) {
      return {
        success: false,
        error: `Check this slide's script before it's voiced: ${blocked[0].problem}.`,
        audio: await loadSlideAudio(prisma, deckId),
        blocked: blocked.length,
      };
    }
    if (generated === 0 && failures.length) {
      return { success: false, error: friendlyTtsError(failures[0].error), audio: await loadSlideAudio(prisma, deckId) };
    }
    return { success: true, audio: await loadSlideAudio(prisma, deckId), generated, failed: failures.length, blocked: blocked.length };
  } catch (err) {
    if (err.cancelled || signal?.aborted) return { success: false, cancelled: true, audio: await loadSlideAudio(prisma, deckId) };
    console.error("❌ Error generating narration:", err);
    return { success: false, error: friendlyTtsError(err.message), audio: await loadSlideAudio(prisma, deckId) };
  }
}

// A short sample of a voice + tone, cached in S3 so replaying is free.
export async function previewVoiceUrl({ openai, voice, tone }) {
  const settings = normalizeNarrationSettings({ voice, tone });
  const key = `${AUDIO_PREFIX}/_previews/${settings.voice}-${settings.tone}-${textHash(VOICE_PREVIEW_TEXT)}.mp3`;
  if (!(await s3Exists(key))) {
    const bytes = await synthesizeSpeech({ openai, text: VOICE_PREVIEW_TEXT, voice: settings.voice, tone: settings.tone });
    await s3PutBytes(key, bytes, "audio/mpeg");
  }
  return s3SignedGetUrl(key, { contentType: "audio/mpeg", expiresIn: 3600 });
}

export function friendlyTtsError(message) {
  const m = String(message || "");
  if (/OPENAI_KEY_MISSING/.test(m)) return "Add your OpenAI API key in Settings to use the AI voice.";
  if (/api key|401|unauthor/i.test(m)) return "The AI voice service rejected the API key. Check your OpenAI key in Settings.";
  if (/model.*(not found|does not exist|deprecated)|404/i.test(m)) return "The AI voice model isn't available any more. Please update the app.";
  if (/rate limit|429/i.test(m)) return "The AI voice service is busy. Wait a minute and try again.";
  if (/network|ENOTFOUND|ECONN|fetch failed|timeout/i.test(m)) return "Couldn't reach the AI voice service. Check your internet connection.";
  return m || "Couldn't create the narration.";
}
