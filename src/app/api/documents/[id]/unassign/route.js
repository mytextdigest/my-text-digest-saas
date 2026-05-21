import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { moveDocumentToTopic } from "@/lib/topicUtils";

export async function POST(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: docId } = await params;

  // Verify document belongs to user
  const doc = await prisma.document.findFirst({
    where: { id: docId, user: { email: session.user.email } },
    select: { id: true },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // moveDocumentToTopic with null newTopicId = unassign
  await moveDocumentToTopic(docId, null);

  return NextResponse.json({ success: true });
}
