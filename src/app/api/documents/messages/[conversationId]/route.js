import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { attachmentsByMessage, isHiddenImageMessage } from "@/lib/chatImages/server";

export async function GET(req, { params }) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { conversationId: conversationId } = await params;

    // Validate access — user must own the conversation
    const conv = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        user: { email: session.user.email }
      }
    });

    if (!conv)
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

    const rows = (await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" }
    })).filter((m) => !isHiddenImageMessage(m));
    const attachments = await attachmentsByMessage("document", rows.map((m) => m.id));
    // imageJobJson is the worker's input (it can hold document excerpts).
    const messages = rows.map(({ imageJobJson, ...m }) => ({
      ...m,
      imageProgress: m.status === "generating" ? m.imageProgress : null,
      attachments: attachments[m.id] || [],
    }));

    return NextResponse.json({ success: true, messages });

  } catch (err) {
    console.error("get-messages error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
