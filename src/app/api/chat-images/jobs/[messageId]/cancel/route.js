// src/app/api/chat-images/jobs/[messageId]/cancel/route.js
// Stop on a queued/running chat-image job. The worker checks the status
// before each paid step and before storing, and drops the result; an
// OpenAI call already in flight is still billed.
import { NextResponse } from "next/server";
import { CHAT_KINDS, messageDelegate } from "@/lib/chatImages/server";
import { sessionUser, ownedMessage, unauthorized, notFound, badRequest, fail } from "@/lib/chatImages/routeUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req, { params }) {
  try {
    const user = await sessionUser();
    if (!user) return unauthorized();
    const { messageId } = await params;
    const kind = new URL(req.url).searchParams.get("kind");
    if (!CHAT_KINDS.has(kind)) return badRequest("Unknown chat.");

    const message = await ownedMessage(kind, messageId, user.id);
    if (!message) return notFound("Message not found.");
    if (message.status !== "generating") return NextResponse.json({ success: true, cancelled: false, status: message.status });

    // A cancelled generation stays in the conversation, marked as such; a
    // cancelled redraw is hidden from history (see the messages routes).
    const improve = message.imageJobJson?.mode === "improve";
    const { count } = await messageDelegate(kind).updateMany({
      where: { id: messageId, status: "generating" },
      data: {
        status: "cancelled",
        imageProgress: null,
        ...(improve ? {} : { content: `${message.content || ""}\n\n⚠️ Image generation was cancelled.`.trim() }),
      },
    });
    return NextResponse.json({ success: true, cancelled: count > 0 });
  } catch (err) {
    console.error("❌ chat-images job cancel:", err);
    return fail(err);
  }
}
