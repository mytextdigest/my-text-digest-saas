// src/app/api/chat-attachments/[id]/improve/route.js
// "Improve quality" on a generated image (desktop improve-chat-image):
// redraws it from its stored recipe (same prompt, inputs and size) at a
// higher quality, as a new assistant message so the two versions can be
// compared. No planner, chart reading or check — the recipe already has the
// transcribed data. The redraw runs in the worker; the client polls the job.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { messageDelegate, enqueueChatImageJob } from "@/lib/chatImages/server";
import { sessionUser, ownedAttachment, unauthorized, notFound, badRequest, fail } from "@/lib/chatImages/routeUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMPROVE_QUALITY_LABELS = { medium: "Standard", high: "High detail" };

export async function POST(req, { params }) {
  try {
    const user = await sessionUser();
    if (!user) return unauthorized();
    const { id } = await params;
    const { quality } = await req.json().catch(() => ({}));
    const label = IMPROVE_QUALITY_LABELS[quality];
    if (!label) return badRequest("Unknown quality.");

    const row = await ownedAttachment(id, user.id);
    if (!row) return notFound("Image not found.");
    const generation = row.generationJson;
    const delegate = messageDelegate(row.messageKind);
    if (row.direction !== "output" || !generation?.prompt || !delegate) {
      return badRequest("This image can't be redrawn.");
    }
    const inputIds = Array.isArray(generation.inputAttachmentIds) ? generation.inputAttachmentIds : [];
    const inputCount = inputIds.length
      ? await prisma.chatAttachment.count({ where: { id: { in: inputIds }, userId: user.id } })
      : 0;
    if (!inputCount || inputCount !== inputIds.length) {
      return badRequest("The original images are no longer available, so this image can't be redrawn.");
    }
    const message = row.messageId ? await delegate.findUnique({ where: { id: row.messageId }, select: { conversationId: true } }) : null;
    if (!message) return badRequest("This image's conversation no longer exists.");

    const content = `Here's a sharper version (${label} quality).`;
    const assistant = await delegate.create({
      data: {
        conversationId: message.conversationId,
        role: "assistant",
        content,
        status: "generating",
        imageJobJson: { mode: "improve", inputAttachmentIds: inputIds, size: generation.size, quality, sourceAttachmentId: row.id },
      },
    });

    try {
      await enqueueChatImageJob({ type: "chat-image", kind: row.messageKind, messageId: assistant.id, userId: user.id });
    } catch (err) {
      await delegate.delete({ where: { id: assistant.id } }).catch(() => {});
      throw new Error("Could not start the redraw. Please try again.");
    }

    return NextResponse.json({ success: true, pending: { kind: row.messageKind, messageId: assistant.id } });
  } catch (err) {
    console.error("❌ chat-attachments improve:", err);
    return fail(err);
  }
}
