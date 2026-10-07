// src/lib/chatImages/turn.js
// runImageTurn for the ask routes — a port of the desktop's runImageTurn
// (main.js) with one change: the generate branch enqueues a "chat-image"
// job for the worker instead of generating in the request, since a
// generation can outlast the route's maxDuration. The client polls
// /api/chat-images/jobs/[messageId] for progress and the result.
import { planImageTurn, answerAboutImages } from "./imageTurn.js";
import {
  messageDelegate,
  collectTurnImages,
  retrieveImageTurnContext,
  enqueueChatImageJob,
} from "./server.js";

// Returns the chat response for an image turn, or null when the turn isn't
// about images and the normal document flow should run. Shared by project
// chat (kind "project", docIds = selected documents) and document chat
// ("document", docIds = [that document]). Document retrieval only happens
// when the planner says the request needs it.
export async function runImageTurn({ openai, kind, conversationId, userMessageId, userId, question, docIds, signal }) {
  const images = await collectTurnImages(kind, conversationId, userMessageId);
  if (!images.length) return null;

  const delegate = messageDelegate(kind);
  const userMsg = await delegate.findUnique({ where: { id: userMessageId }, select: { createdAt: true } });
  const history = (await delegate.findMany({
    where: { conversationId, createdAt: { lt: userMsg.createdAt } },
    orderBy: { createdAt: "desc" },
    take: 4,
    select: { role: true, content: true },
  })).reverse();
  const effectiveQuestion = question || "(The user sent the image(s) without a message.)";

  const plan = await planImageTurn({ openai, question: effectiveQuestion, images, history, signal });
  console.log(`🖼️ Image turn: route=${plan.route} images=${plan.imageIndices.map((i) => i + 1)} docs=${plan.useDocuments}`);
  if (plan.route === "documents") return null;

  const documentContext = plan.useDocuments
    ? await retrieveImageTurnContext({ openai, docIds, text: effectiveQuestion, signal })
    : "";
  const selected = plan.imageIndices.map((i) => images[i]);

  await delegate.update({ where: { id: userMessageId }, data: { status: "done" } });

  if (plan.route === "answer_image") {
    const answer = await answerAboutImages({ openai, question: effectiveQuestion, images: selected, history, documentContext, signal });
    await delegate.create({ data: { conversationId, role: "assistant", content: answer, status: "done" } });
    return { success: true, conversationId, answer, attachments: [] };
  }

  // generate_image — the lead-in shows straight away while the worker draws.
  const leadIn = plan.leadIn || "Here's the image you asked for.";
  const assistant = await delegate.create({
    data: {
      conversationId,
      role: "assistant",
      content: leadIn,
      status: "generating",
      imageProgress: "Reading the charts…",
      imageJobJson: {
        mode: "generate",
        inputAttachmentIds: selected.map((img) => img.row.id),
        size: plan.size,
        imagePrompt: plan.imagePrompt,
        question: effectiveQuestion,
        documentContext,
        leadIn,
      },
    },
  });

  try {
    await enqueueChatImageJob({ type: "chat-image", kind, messageId: assistant.id, userId });
  } catch (err) {
    console.error("❌ Failed to enqueue chat image job:", err);
    const content = `${leadIn}\n\n⚠️ I couldn't start the image: ${err.message || "the job queue is unavailable"}`;
    await delegate.update({
      where: { id: assistant.id },
      data: { status: "error", content, imageProgress: null, imageJobJson: null },
    });
    return { success: true, conversationId, answer: content, attachments: [] };
  }

  return { success: true, conversationId, pendingImage: { kind, messageId: assistant.id, leadIn } };
}
