export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const sqs = new SQSClient({ region: process.env.AWS_REGION });

export async function POST(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await params;

  // Verify project ownership
  const project = await prisma.project.findFirst({
    where: { id: projectId, user: { email: session.user.email } },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Find ready documents with no topic assignment
  const unassigned = await prisma.document.findMany({
    where: {
      projectId,
      status: "ready",
      topicDocument: null,
    },
    select: { id: true },
  });

  if (unassigned.length === 0) {
    return NextResponse.json({ scheduled: 0 });
  }

  // Enqueue a cluster job for each unassigned document
  const QUEUE_URL = process.env.SQS_QUEUE_URL;
  let scheduled = 0;

  for (const doc of unassigned) {
    try {
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: QUEUE_URL,
          MessageBody: JSON.stringify({
            type:      "cluster",
            docId:     doc.id,
            projectId,
            recluster: true,
          }),
        })
      );
      scheduled++;
    } catch (err) {
      console.error(`Failed to enqueue recluster for ${doc.id}:`, err.message);
    }
  }

  return NextResponse.json({ scheduled });
}
