// src/lib/slides/deckServer.js
// Server-side helpers shared by the slide-deck routes and the worker's media
// jobs (talking points, narration, video, PDF): loading a deck's editable
// outline, S3 object helpers, and the SlideDeckJob rows + media queue that
// replace desktop's in-process IPC handlers and progress events.
//
// Imported by worker/ too, so: relative imports only (no "@/..."), and
// `prisma` is always passed in by the caller.

import {
  S3Client, PutObjectCommand, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand, ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { setMaxListeners } from "node:events";

let s3;
export function s3Client() {
  s3 ||= new S3Client({
    region: process.env.AWS_REGION,
    requestHandler: new NodeHttpHandler({ connectionTimeout: 5000, requestTimeout: 120000 }),
  });
  return s3;
}

let sqs;
function sqsClient() {
  sqs ||= new SQSClient({ region: process.env.AWS_REGION });
  return sqs;
}

// Exported files (.pptx with notes, talking-points .pdf, .mp4) — kept under
// their own prefix so an S3 lifecycle rule can expire them (they're
// re-created on every export), and removed with the deck.
export function exportPrefix(deckId) {
  return `slide-exports/${deckId}/`;
}

export function slugify(title) {
  return (title || "presentation")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "presentation";
}

// ---------------------------------------------------------------------------
// Deck access
// ---------------------------------------------------------------------------

// Desktop's loadEditableOutline. With `userEmail`, the deck must belong to
// that user (a tampered deckId 404s); without it (worker, render token) the
// caller has already authorised the request.
export async function loadEditableOutline(prisma, deckId, { userEmail } = {}) {
  const where = userEmail ? { id: deckId, document: { user: { email: userEmail } } } : { id: deckId };
  const deck = await prisma.slideDeck.findFirst({ where });
  if (!deck) return { error: "Deck not found.", status: 404 };
  const outline = deck.outlineJson;
  if (!outline || deck.status === "outline_review" || !Array.isArray(outline.slides)) {
    return { deck, error: "This deck has no editable outline.", status: 409 };
  }
  return { deck, outline };
}

export async function documentTextFor(prisma, documentId) {
  const chunks = await prisma.chunk.findMany({
    where: { documentId },
    orderBy: { chunkIndex: "asc" },
    select: { text: true },
  });
  return chunks.map((c) => c.text || "").join("\n\n");
}

// ---------------------------------------------------------------------------
// S3
// ---------------------------------------------------------------------------

const bucket = () => process.env.S3_BUCKET;

export async function s3PutBytes(key, bytes, contentType) {
  await s3Client().send(new PutObjectCommand({
    Bucket: bucket(), Key: key, Body: Buffer.from(bytes), ContentType: contentType,
  }));
}

export async function s3GetBytes(key) {
  const res = await s3Client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function s3Exists(key) {
  try {
    await s3Client().send(new GetObjectCommand({ Bucket: bucket(), Key: key, Range: "bytes=0-0" }));
    return true;
  } catch (err) {
    if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

export async function s3Copy(fromKey, toKey) {
  await s3Client().send(new CopyObjectCommand({
    Bucket: bucket(), Key: toKey, CopySource: `${bucket()}/${encodeURIComponent(fromKey).replace(/%2F/g, "/")}`,
  }));
}

// Best effort: a leftover object must never fail the user's action.
export async function s3Delete(key) {
  if (!key) return;
  try {
    await s3Client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  } catch (err) {
    console.error(`⚠️  S3 delete failed for ${key}:`, err.message || err);
  }
}

export async function s3DeletePrefix(prefix) {
  try {
    let token;
    do {
      const listed = await s3Client().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: token }));
      for (const obj of listed.Contents || []) await s3Delete(obj.Key);
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);
  } catch (err) {
    console.error(`⚠️  S3 prefix cleanup failed for ${prefix}:`, err.message || err);
  }
}

// A short-lived GET URL. `filename` forces a download with that name.
export async function s3SignedGetUrl(key, { filename, contentType, expiresIn = 300 } = {}) {
  const command = new GetObjectCommand({
    Bucket: bucket(),
    Key: key,
    ...(filename && { ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, "")}"` }),
    ...(contentType && { ResponseContentType: contentType }),
  });
  return getSignedUrl(s3Client(), command, { expiresIn });
}

// ---------------------------------------------------------------------------
// Jobs (SlideDeckJob rows + the media queue)
// ---------------------------------------------------------------------------

// A queued/running row older than this (no progress update) is treated as
// dead — the worker's watchdog is 8 minutes, and a route's maxDuration 60 s.
export const ACTIVE_JOB_WINDOW_MS = 12 * 60 * 1000;
// Inline rows (runInlineJob, phase "inline") can't outlive their route's
// 60 s, so one left "running" by a killed request stops counting sooner.
const ACTIVE_INLINE_WINDOW_MS = 2 * 60 * 1000;
const INLINE_PHASE = "inline";

export async function findActiveJob(prisma, deckId, kinds, { slideId } = {}) {
  const now = Date.now();
  return prisma.slideDeckJob.findFirst({
    where: {
      deckId,
      kind: { in: kinds },
      status: { in: ["queued", "running"] },
      OR: [
        { phase: INLINE_PHASE, updatedAt: { gt: new Date(now - ACTIVE_INLINE_WINDOW_MS) } },
        { OR: [{ phase: null }, { phase: { not: INLINE_PHASE } }], updatedAt: { gt: new Date(now - ACTIVE_JOB_WINDOW_MS) } },
      ],
      ...(slideId !== undefined && { slideId }),
    },
    orderBy: { createdAt: "desc" },
  });
}

export function createJob(prisma, { deckId, kind, slideId = null, status = "queued", phase = null, total = 0 }) {
  return prisma.slideDeckJob.create({ data: { deckId, kind, slideId, status, phase, total } });
}

// One AbortController is shared by every OpenAI / ffmpeg call of a job (a
// whole deck can be dozens), each adding an abort listener.
export function jobAbortController() {
  const controller = new AbortController();
  setMaxListeners(200, controller.signal);
  return controller;
}

export function updateJob(prisma, jobId, data) {
  return prisma.slideDeckJob.update({ where: { id: jobId }, data }).catch((err) => {
    console.error(`⚠️  Could not update slide job ${jobId}:`, err.message || err);
    return null;
  });
}

export function jobToClient(job) {
  if (!job) return null;
  return {
    id: job.id,
    kind: job.kind,
    slideId: job.slideId,
    status: job.status,
    phase: job.phase,
    done: job.done,
    total: job.total,
    result: job.result || null,
    error: job.error || null,
  };
}

// Media jobs get their own queue and poll loop (spec D3) so a minute-long
// narration run or a video never holds up document processing; without one
// (local dev) they share the main queue, like chat-image jobs.
export async function enqueueMediaJob(body) {
  await sqsClient().send(new SendMessageCommand({
    QueueUrl: process.env.SQS_MEDIA_QUEUE_URL || process.env.SQS_QUEUE_URL,
    MessageBody: JSON.stringify(body),
  }));
}

// Creates the row and sends the message. If the send fails the row is
// marked failed, so it never blocks the next attempt.
// `phase`/`total`: where the job starts, so the first progress the client
// shows is right before the worker has picked it up.
export async function startMediaJob(prisma, { deckId, kind, slideId = null, payload = {}, phase = null, total = 0 }) {
  const job = await createJob(prisma, { deckId, kind, slideId, phase, total });
  try {
    await enqueueMediaJob({ type: kind, jobId: job.id, deckId, slideId, ...payload });
  } catch (err) {
    await updateJob(prisma, job.id, { status: "error", error: "Could not start the job." });
    throw err;
  }
  return job;
}

// Work a route does inline (one slide) still gets a "running" row for its
// lifetime, so the one-generation-per-deck rule holds across serverless
// instances, and a cancel can reach it. `fn(job, signal)`.
export async function runInlineJob(prisma, { deckId, kind, slideId = null }, fn) {
  const job = await createJob(prisma, { deckId, kind, slideId, status: "running", phase: INLINE_PHASE });
  const controller = jobAbortController();
  const stopWatching = watchJobCancel(prisma, job.id, controller);
  try {
    const result = await fn(job, controller.signal);
    await updateJob(prisma, job.id, { status: controller.signal.aborted ? "cancelled" : "done" });
    return result;
  } catch (err) {
    await updateJob(prisma, job.id, {
      status: controller.signal.aborted ? "cancelled" : "error",
      error: String(err?.message || err).slice(0, 2000),
    });
    throw err;
  } finally {
    stopWatching();
  }
}

// Aborts `controller` once the job's row is marked cancelled (the cancel
// route only flips the status; this is how the running work hears it) — or
// failed from outside (the worker's watchdog, or found stale by the poll
// route), so timed-out work stops instead of running on unseen.
export function watchJobCancel(prisma, jobId, controller, intervalMs = 1000) {
  let stopped = false;
  const timer = setInterval(async () => {
    if (stopped || controller.signal.aborted) return;
    try {
      const row = await prisma.slideDeckJob.findUnique({ where: { id: jobId }, select: { status: true } });
      if (row?.status === "cancelled" || row?.status === "error") controller.abort();
    } catch (e) { /* transient DB error: try again next tick */ }
  }, intervalMs);
  return () => { stopped = true; clearInterval(timer); };
}
