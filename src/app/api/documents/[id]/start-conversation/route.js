import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

export async function POST(req, { params }) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const documentId = params.id;

    // Validate doc belongs to user
    const doc = await prisma.document.findFirst({
      where: {
        id: documentId,
        user: { email: session.user.email }
      }
    });
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    // Check for existing conversation
    const existing = await prisma.conversation.findFirst({
      where: { documentId },
      orderBy: { createdAt: "desc" }
    });

    if (existing) {
      return NextResponse.json({
        success: true,
        conversationId: existing.id
      });
    }

    // Create new conversation
    const conv = await prisma.conversation.create({
      data: {
        documentId,
        userId: doc.userId  // required by schema
      }
    });

    return NextResponse.json({
      success: true,
      conversationId: conv.id
    });

  } catch (err) {
    console.error("start-conversation error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
