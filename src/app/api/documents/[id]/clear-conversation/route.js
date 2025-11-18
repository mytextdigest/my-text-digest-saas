import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

export async function POST(req, { params }) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const documentId = params.id;

    const doc = await prisma.document.findFirst({
      where: { id: documentId, user: { email: session.user.email } }
    });

    if (!doc)
      return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const newConv = await prisma.conversation.create({
      data: {
        documentId,
        userId: doc.userId
      }
    });

    return NextResponse.json({
      success: true,
      conversationId: newConv.id
    });

  } catch (err) {
    console.error("clear-conversation error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
