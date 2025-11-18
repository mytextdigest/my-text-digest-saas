// src/app/api/documents/[id]/regenerate/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import path from "path";
import fs from "fs";

export async function POST(req, { params }) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const documentId = params.id;
    if (!documentId) return NextResponse.json({ error: "Missing document id" }, { status: 400 });

    // Load document and verify ownership
    const doc = await prisma.document.findFirst({
      where: { id: documentId, user: { email: session.user.email } },
      include: { project: true, user: true },
    });

    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    if (!doc.filePath)
      return NextResponse.json({ error: "Document filePath missing (cannot regenerate)" }, { status: 400 });

    const filename = doc.filename || path.basename(doc.filePath);

    // update status to queued (same as ingest)
    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: "queued",
      },
    });

    // ensure logs directory exists (same pattern as ingest)
    const logDir = path.resolve(process.cwd(), "logs");
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logPath = path.join(logDir, `background_${documentId}.log`);
    // touch file (or append will create)
    fs.openSync(logPath, "a");

    // build SQS message
    const sqs = new SQSClient({ region: process.env.VPC_REGION });

    const messageBody = JSON.stringify({
      docId: documentId,
      s3Key: doc.filePath,
      filename,
      projectId: doc.projectId || null,
      userId: doc.userId || null,
      regenerate: true
    });

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.SQS_QUEUE_URL,
        MessageBody: messageBody,
      })
    );

    console.log(`📄 Queued regenerate-summary for document ${documentId}`);

    return NextResponse.json({
      success: true,
      id: documentId,
      status: "queued",
      logFile: `background_${documentId}.log`,
    });
  } catch (err) {
    console.error("❌ Regenerate summary failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
