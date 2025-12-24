// src/app/api/documents/[id]/regenerate/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

export async function POST(req, { params }) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: documentId } = await params;

    console.log("Regenerate Document id: ", documentId)


    if (!documentId)
      return NextResponse.json({ error: "Missing document id" }, { status: 400 });

    // Verify ownership
    const doc = await prisma.document.findFirst({
      where: { id: documentId, user: { email: session.user.email } },
      include: { project: true, user: true },
    });

    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    if (!doc.filePath)
      return NextResponse.json(
        { error: "Document filePath missing (cannot regenerate)" },
        { status: 400 }
      );

    const filename = doc.filename || doc.filePath.split("/").pop();

    // Update status → regenerating (treated like summarizing)
    await prisma.document.update({
      where: { id: documentId },
      data: { status: "summarizing" },
    });

    // SQS
    const sqs = new SQSClient({ region: process.env.AWS_REGION });

    // 🔥 NEW: For regeneration, we explicitly send type: "summarize"
    const messageBody = JSON.stringify({
      type: "summarize",      // 🟢 Worker stage 3
      docId: documentId,
      s3Key: doc.filePath,
      filename,
      projectId: doc.projectId || null,
      userId: doc.userId || null,
      regenerate: true        // 🟢 Worker takes special regenerate path
    });

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.SQS_QUEUE_URL,
        MessageBody: messageBody,
      })
    );

    console.log(`📄 Queued summary regeneration for document ${documentId}`);

    return NextResponse.json({
      success: true,
      id: documentId,
      status: "summarizing"
    });

  } catch (err) {
    console.error("❌ Regenerate summary failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
