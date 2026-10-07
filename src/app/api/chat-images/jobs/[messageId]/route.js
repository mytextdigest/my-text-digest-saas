// src/app/api/chat-images/jobs/[messageId]/route.js
// Progress and result of a chat-image job, polled by the client every
// 1.5 s in place of the desktop's chat-progress events.
// → { status, progress, leadIn, answer?, attachments?, error? }
import { NextResponse } from "next/server";
import { CHAT_KINDS, attachmentsByMessage, failChatImageMessage } from "@/lib/chatImages/server";
import { sessionUser, ownedMessage, unauthorized, notFound, badRequest, fail } from "@/lib/chatImages/routeUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A job still "generating" this long after it was queued has lost its
// worker (crash, deploy); resolve it so the placeholder doesn't spin forever.
const STALE_MS = 20 * 60 * 1000;

export async function GET(req, { params }) {
  try {
    const user = await sessionUser();
    if (!user) return unauthorized();
    const { messageId } = await params;
    const kind = new URL(req.url).searchParams.get("kind");
    if (!CHAT_KINDS.has(kind)) return badRequest("Unknown chat.");

    let message = await ownedMessage(kind, messageId, user.id);
    if (!message) return notFound("Message not found.");
    if (message.status === "generating" && Date.now() - new Date(message.createdAt).getTime() > STALE_MS) {
      await failChatImageMessage({ kind, messageId }, new Error("the image took too long. Please try again."));
      message = await ownedMessage(kind, messageId, user.id);
    }

    const improve = message.imageJobJson?.mode === "improve";
    const body = {
      status: message.status,
      progress: message.status === "generating" ? message.imageProgress : null,
      leadIn: message.imageJobJson?.leadIn || message.content || "",
    };
    if (message.status === "done") {
      body.answer = message.content || "";
      body.attachments = (await attachmentsByMessage(kind, [message.id]))[message.id] || [];
    } else if (message.status === "error") {
      if (improve) body.error = message.imageProgress || "Could not redraw the image.";
      else body.answer = message.content || "";
    }
    return NextResponse.json(body);
  } catch (err) {
    console.error("❌ chat-images job status:", err);
    return fail(err);
  }
}
