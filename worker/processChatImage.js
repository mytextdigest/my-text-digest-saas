// worker/processChatImage.js
// "chat-image" jobs: the generation half of a chat image turn, and Improve
// quality redraws. Ported from the desktop's runImageTurn generate branch
// and its improve-chat-image handler (main.js); the route did the planning
// and left the inputs in the message's imageJobJson. Progress goes to the
// message's imageProgress column for the client's poller instead of
// chat-progress IPC events.
//
// Cancelling sets the message's status to "cancelled" (the job cancel
// route). The job checks before every paid step and before storing, and a
// watcher aborts the in-flight OpenAI call, but that call is still billed.
//
// Never throws (see the chat-image exclusion in worker/index.js's
// recordJobFailure): every failure lands on the message.
import { prisma } from "../src/lib/prisma.mjs";
import { getOpenAIForUser } from "../src/lib/openaiForDocument.js";
import {
  buildImagePrompt,
  addDocumentFactsToPrompt,
  generateCheckedImage,
  generateImageFromImages,
} from "../src/lib/chatImages/imageTurn.js";
import {
  messageDelegate, readAttachmentBuffer, storeOutputImage, deleteS3Keys, failChatImageMessage,
} from "../src/lib/chatImages/server.js";

const CANCEL_CHECK_MS = 3000;

class JobCancelled extends Error {}

export { failChatImageMessage };

export async function processChatImageJob({ kind, messageId, userId }) {
  const delegate = messageDelegate(kind);
  if (!delegate || !messageId) return;
  const message = await delegate.findUnique({ where: { id: messageId } }).catch(() => null);
  // Cancelled, already finished, or a duplicate delivery.
  if (!message || message.status !== "generating") return;
  const job = message.imageJobJson || {};

  const controller = new AbortController();
  const signal = controller.signal;
  const stillGenerating = async () => {
    const row = await delegate.findUnique({ where: { id: messageId }, select: { status: true } });
    return row?.status === "generating";
  };
  const assertGenerating = async () => {
    if (!(await stillGenerating())) {
      controller.abort();
      throw new JobCancelled();
    }
  };
  const setProgress = async (text) => {
    const { count } = await delegate.updateMany({ where: { id: messageId, status: "generating" }, data: { imageProgress: text } });
    if (!count) {
      controller.abort();
      throw new JobCancelled();
    }
  };
  // generateCheckedImage reports status synchronously; a cancellation found
  // there aborts the signal it is running on.
  const onStatus = (text) => { setProgress(text).catch(() => {}); };
  const watcher = setInterval(() => {
    stillGenerating().then((ok) => { if (!ok) controller.abort(); }).catch(() => {});
  }, CANCEL_CHECK_MS);

  try {
    const openai = await getOpenAIForUser(userId);
    const images = await loadInputs(job.inputAttachmentIds, userId);

    let buffer;
    let generation;
    if (job.mode === "improve") {
      const source = await prisma.chatAttachment.findFirst({ where: { id: job.sourceAttachmentId, userId } });
      if (!source?.generationJson?.prompt) throw new Error("This image can't be redrawn.");
      await assertGenerating();
      buffer = await generateImageFromImages({
        openai, images, prompt: source.generationJson.prompt, size: source.generationJson.size, quality: job.quality, signal,
      });
      generation = { ...source.generationJson, quality: job.quality, improvedFrom: source.id };
    } else {
      await setProgress("Reading the charts…");
      let { prompt, charts } = await buildImagePrompt({ openai, imagePrompt: job.imagePrompt, images, signal });
      if (job.documentContext) {
        await assertGenerating();
        prompt = await addDocumentFactsToPrompt({ openai, imagePrompt: prompt, question: job.question, documentContext: job.documentContext, signal });
      }
      await setProgress("Creating the image… this can take up to a minute");
      const result = await generateCheckedImage({ openai, images, prompt, charts, size: job.size, signal, onStatus });
      buffer = result.buffer;
      generation = { prompt, size: job.size, quality: result.quality, inputAttachmentIds: job.inputAttachmentIds };
    }

    await assertGenerating();
    await storeResult({ delegate, kind, messageId, userId, buffer, generation });
    console.log(`🖼️ Chat image ${job.mode || "generate"} done: ${kind} message ${messageId}`);
  } catch (err) {
    if (err instanceof JobCancelled || signal.aborted) {
      console.log(`🖼️ Chat image job cancelled: ${kind} message ${messageId}`);
      return;
    }
    console.error(`❌ Chat image job failed (${kind} message ${messageId}):`, err);
    await failChatImageMessage({ kind, messageId }, err);
  } finally {
    clearInterval(watcher);
  }
}

// Inputs in planner order. All must still exist — a redraw from a partial
// set would silently drop a chart.
async function loadInputs(ids, userId) {
  const wanted = Array.isArray(ids) ? ids : [];
  const rows = await prisma.chatAttachment.findMany({ where: { id: { in: wanted }, userId } });
  const ordered = wanted.map((id) => rows.find((r) => r.id === id)).filter(Boolean);
  if (!ordered.length || ordered.length !== wanted.length) {
    throw new Error("The original images are no longer available, so this image can't be redrawn.");
  }
  return Promise.all(ordered.map(async (row) => ({
    buffer: await readAttachmentBuffer(row),
    mime: row.mime || "image/png",
    name: row.originalName,
    direction: row.direction,
    isCurrent: false,
  })));
}

// The image row and the message's "done" land together, and only if the
// message wasn't cancelled meanwhile.
async function storeResult({ delegate, kind, messageId, userId, buffer, generation }) {
  let key = null;
  try {
    await prisma.$transaction(async (tx) => {
      const row = await storeOutputImage({ userId, kind, messageId, buffer, generation, db: tx });
      key = row.s3Key;
      const { count } = await messageDelegate(kind, tx).updateMany({
        where: { id: messageId, status: "generating" },
        data: { status: "done", imageProgress: null, imageJobJson: null },
      });
      if (!count) throw new JobCancelled();
    }, { timeout: 30000 });
  } catch (err) {
    if (key) await deleteS3Keys([key]);
    throw err;
  }
}
