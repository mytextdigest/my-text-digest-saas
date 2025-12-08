// src/app/api/documents/ingest/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

export async function POST(req) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const formData = await req.formData();
    const projectId = formData.get("projectId");
    const s3Key = formData.get("s3Key");

    if (!projectId || !s3Key) {
      return NextResponse.json({ error: "Missing projectId or s3Key" }, { status: 400 });
    }

    const filename = s3Key.split("/").pop();

    const dbUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });

    if (!dbUser)
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    // Document created with "queued" status
    const doc = await prisma.document.create({
      data: {
        filename,
        filePath: s3Key,
        status: "queued",
        project: { connect: { id: projectId } },
        user: { connect: { id: dbUser.id } },
      },
    });

    // SQS client
    const sqs = new SQSClient({ region: process.env.AWS_REGION });

    // 🔥 NEW: 3-Stage Pipeline → initial job is ALWAYS "chunk"
    const messageBody = JSON.stringify({
      type: "chunk",      // STEP 1 in pipeline
      docId: doc.id,
      s3Key,
      filename,
      projectId,
      userId: dbUser.id,
      regenerate: false
    });

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.SQS_QUEUE_URL,
        MessageBody: messageBody,
      })
    );

    return NextResponse.json({
      success: true,
      id: doc.id,
      status: "queued"
    });

  } catch (err) {
    console.error("❌ File ingestion failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
