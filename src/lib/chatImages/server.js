// src/lib/chatImages/server.js
// Server-side helpers for chat image attachments, shared by the API routes
// and the worker (so relative imports only — no "@/" alias, no next/*).
// Ports of the desktop's main.js helpers under "Chat attachments (images in
// chat)": chatAttachmentToClient, bindChatAttachments, collectTurnImages,
// retrieveImageTurnContext and the delete helpers, on Prisma + S3 instead of
// SQLite + the filesystem.
import { randomUUID } from "node:crypto";
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { prisma } from "../prisma.mjs";
import { MAX_INPUT_IMAGES, friendlyImageError } from "./imageTurn.js";

// Prisma delegate name for each chat's message table.
export const MESSAGE_MODEL = { project: "projectMessage", document: "message" };
export const CHAT_KINDS = new Set(Object.keys(MESSAGE_MODEL));

export function messageDelegate(kind, db = prisma) {
  const name = MESSAGE_MODEL[kind];
  return name ? db[name] : null;
}

// Images an image turn can work with: this message's attachments, or — on a
// follow-up with none — the images on the last two recent messages that have
// any (the user's uploads and the assistant's generated images alike).
export const IMAGE_TURN_LOOKBACK = 6;

let s3;
function s3Client() {
  s3 ||= new S3Client({ region: process.env.AWS_REGION });
  return s3;
}

let sqs;
function sqsClient() {
  sqs ||= new SQSClient({ region: process.env.AWS_REGION });
  return sqs;
}

export function chatAttachmentToClient(row) {
  const generation = row.generationJson || null;
  return {
    id: row.id,
    fileUrl: `/api/chat-attachments/${row.id}/file`,
    width: row.width ?? null,
    height: row.height ?? null,
    name: row.originalName ?? null,
    direction: row.direction,
    savedDocumentId: row.savedDocumentId || null,
    // Set on generated images that "Improve quality" can redraw.
    quality: generation?.prompt ? generation.quality : null,
  };
}

export function chatImageKey(userId, kind, mime = "image/png") {
  return `chat/${userId}/${kind}/${randomUUID()}.${mime === "image/webp" ? "webp" : "png"}`;
}

export function stagedKeyPrefix(userId) {
  return `chat/${userId}/staged/`;
}

// Width/height from a PNG's IHDR chunk.
export function pngSize(buf) {
  if (!buf || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return { width: null, height: null };
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function getS3Object(key) {
  return s3Client().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
}

export async function readS3Buffer(key) {
  const object = await getS3Object(key);
  return streamToBuffer(object.Body);
}

export function readAttachmentBuffer(row) {
  return readS3Buffer(row.s3Key);
}

export async function putS3Object(key, buffer, contentType) {
  await s3Client().send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: buffer, ContentType: contentType }));
}

// Best effort: a leftover object costs storage, not correctness.
export async function deleteS3Keys(keys) {
  const unique = [...new Set(keys.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 1000) {
    try {
      await s3Client().send(new DeleteObjectsCommand({
        Bucket: process.env.S3_BUCKET,
        Delete: { Objects: unique.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
      }));
    } catch (err) {
      console.warn("⚠️  Failed to delete chat image objects:", err.message);
    }
  }
}

// Uploads a generated PNG and records it on its message.
export async function storeOutputImage({ userId, kind, messageId, buffer, generation, db = prisma }) {
  const key = chatImageKey(userId, kind);
  await putS3Object(key, buffer, "image/png");
  const { width, height } = pngSize(buffer);
  try {
    return await db.chatAttachment.create({
      data: {
        userId, messageKind: kind, messageId, direction: "output", s3Key: key,
        mime: "image/png", width, height, sizeBytes: buffer.length, generationJson: generation,
      },
    });
  } catch (err) {
    await deleteS3Keys([key]);
    throw err;
  }
}

export function loadAttachments(kind, messageIds, db = prisma) {
  if (!messageIds.length) return Promise.resolve([]);
  return db.chatAttachment.findMany({
    where: { messageKind: kind, messageId: { in: messageIds } },
    orderBy: { createdAt: "asc" },
  });
}

// messageId → client attachments, for the history routes.
export async function attachmentsByMessage(kind, messageIds) {
  const byMessage = {};
  for (const row of await loadAttachments(kind, messageIds)) {
    (byMessage[row.messageId] ||= []).push(chatAttachmentToClient(row));
  }
  return byMessage;
}

// A failed or cancelled Improve quality redraw: on desktop it never became a
// message, so history leaves it out (the card showed the error instead).
export function isHiddenImageMessage(message) {
  return message.imageJobJson?.mode === "improve" && (message.status === "error" || message.status === "cancelled");
}

// Staged uploads (messageId null) become owned by the user's message.
// Returns the ids actually bound — another user's upload, or one staged in
// the other chat, is ignored.
export async function bindChatAttachments(kind, messageId, userId, attachmentIds) {
  const ids = [...new Set((Array.isArray(attachmentIds) ? attachmentIds : []).filter((id) => typeof id === "string" && id))];
  if (!ids.length) return [];
  await prisma.chatAttachment.updateMany({
    where: { id: { in: ids }, userId, messageKind: kind, messageId: null, direction: "input" },
    data: { messageId },
  });
  const bound = await prisma.chatAttachment.findMany({
    where: { id: { in: ids }, messageKind: kind, messageId },
    select: { id: true },
  });
  return bound.map((r) => r.id);
}

// [{ row, buffer, mime, name, direction, isCurrent }] — the input shape of
// imageTurn.js. Ordered by createdAt (cuid ids aren't numeric).
export async function collectTurnImages(kind, conversationId, userMessageId) {
  const delegate = messageDelegate(kind);
  const userMsg = await delegate.findUnique({ where: { id: userMessageId }, select: { createdAt: true } });
  if (!userMsg) return [];
  const recent = await delegate.findMany({
    where: { conversationId, createdAt: { lte: userMsg.createdAt } },
    orderBy: { createdAt: "desc" },
    take: IMAGE_TURN_LOOKBACK,
    select: { id: true },
  });
  const recentIds = recent.map((m) => m.id);
  if (!recentIds.includes(userMessageId)) recentIds.unshift(userMessageId);
  const rows = await loadAttachments(kind, recentIds);

  let picked = rows.filter((r) => r.messageId === userMessageId);
  if (!picked.length) {
    // recentIds is newest first.
    const messageIds = recentIds.filter((id) => rows.some((r) => r.messageId === id)).slice(0, 2);
    picked = rows.filter((r) => messageIds.includes(r.messageId)).slice(-MAX_INPUT_IMAGES);
  }

  const images = await Promise.all(picked.map(async (row) => {
    try {
      return {
        row,
        buffer: await readAttachmentBuffer(row),
        mime: row.mime || "image/png",
        name: row.originalName,
        direction: row.direction,
        isCurrent: row.messageId === userMessageId,
      };
    } catch (err) {
      console.warn(`⚠️  Chat image ${row.id} unreadable:`, err.message);
      return null;
    }
  }));
  return images.filter(Boolean);
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// Top chunks of the given documents for an image turn that the planner said
// needs document facts. Brute-force cosine, like the ask routes.
export async function retrieveImageTurnContext({ openai, docIds, text, signal }) {
  if (!docIds.length) return "";
  const embedding = (await openai.embeddings.create({ model: "text-embedding-3-small", input: text }, { signal })).data[0].embedding;
  const chunks = await prisma.chunk.findMany({
    where: { documentId: { in: docIds } },
    select: { text: true, embedding: true, document: { select: { filename: true } } },
  });
  return chunks
    .filter((c) => Array.isArray(c.embedding) && c.text)
    .map((c) => ({ c, score: cosineSim(embedding, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ c }) => `Document: ${c.document?.filename || "Document"}\n${c.text}`)
    .join("\n\n");
}

// Deletes the attachment rows of these messages and returns their S3 keys.
// Pass a transaction client as `db` to keep it atomic with the messages;
// delete the keys with deleteS3Keys after commit.
export async function deleteAttachmentRowsForMessages(db, kind, messageIds) {
  if (!messageIds.length) return [];
  const rows = await db.chatAttachment.findMany({
    where: { messageKind: kind, messageId: { in: messageIds } },
    select: { s3Key: true },
  });
  await db.chatAttachment.deleteMany({ where: { messageKind: kind, messageId: { in: messageIds } } });
  return rows.map((r) => r.s3Key);
}

export async function deleteAttachmentsForMessages(kind, messageIds) {
  const keys = await deleteAttachmentRowsForMessages(prisma, kind, messageIds);
  await deleteS3Keys(keys);
}

// Uploads abandoned in the composer (never sent) are swept a day later. The
// S3 lifecycle rule on chat/*/staged/ covers objects whose register call
// never happened.
export async function sweepStagedAttachments(userId) {
  const rows = await prisma.chatAttachment.findMany({
    where: { userId, messageId: null, createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    select: { id: true, s3Key: true },
  });
  if (!rows.length) return;
  await prisma.chatAttachment.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  await deleteS3Keys(rows.map((r) => r.s3Key));
}

// Chat-image jobs get their own queue so they don't wait behind document
// ingestion; without one (local dev) they share the main queue.
export async function enqueueChatImageJob(body) {
  await sqsClient().send(new SendMessageCommand({
    QueueUrl: process.env.SQS_CHAT_QUEUE_URL || process.env.SQS_QUEUE_URL,
    MessageBody: JSON.stringify(body),
  }));
}

// A chat-image job that failed (in the worker, its watchdog, or found
// stale by the poll route). Generate: the lead-in plus the error, as the
// desktop shows it. Improve: the content stays (the message is hidden from
// history) and the poll reports the error, which the card shows under the
// image.
export async function failChatImageMessage({ kind, messageId }, err) {
  const delegate = messageDelegate(kind);
  if (!delegate || !messageId) return;
  try {
    const message = await delegate.findUnique({ where: { id: messageId } });
    if (!message || message.status !== "generating") return;
    const friendly = friendlyImageError(err);
    const improve = message.imageJobJson?.mode === "improve";
    await delegate.updateMany({
      where: { id: messageId, status: "generating" },
      data: improve
        ? { status: "error", imageProgress: friendly }
        : { status: "error", content: `${message.content || ""}\n\n⚠️ ${friendly}`.trim(), imageProgress: null, imageJobJson: null },
    });
  } catch (updateErr) {
    console.error("❌ Failed to record chat image failure:", updateErr.message);
  }
}
