// src/app/api/chat/feedback/route.js
// 👍 / 👎 on an assistant answer — the desktop's set-message-feedback IPC.
// value: 1 (helpful), -1 (not helpful) or null (cleared). Ownership comes
// from the session (the message's conversation must belong to the caller),
// never from the request body.
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

const DELEGATES = {
  document: () => prisma.message,
  project: () => prisma.projectMessage,
};

export async function POST(req) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const { kind, messageId, value } = body || {};
  if (!DELEGATES[kind] || typeof messageId !== "string" || !messageId || ![1, -1, null].includes(value)) {
    return NextResponse.json({ success: false, error: "Invalid feedback." }, { status: 400 });
  }

  const delegate = DELEGATES[kind]();
  const message = await delegate.findUnique({
    where: { id: messageId },
    select: { role: true, conversation: { select: { user: { select: { email: true } } } } },
  });
  if (!message || message.role !== "assistant" || message.conversation?.user?.email !== session.user.email) {
    return NextResponse.json({ success: false, error: "Message not found." }, { status: 404 });
  }

  await delegate.update({
    where: { id: messageId },
    data: { feedback: value, feedbackAt: value === null ? null : new Date() },
  });
  return NextResponse.json({ success: true });
}
