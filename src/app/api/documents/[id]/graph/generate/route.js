import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { prisma } from "@/lib/prisma";
import { removeGraphDataForDocument } from "@/lib/graph/cleanup";

// The only trigger for single-document graph extraction — never called
// automatically at upload/ingestion (see the feature's decision 2: manual
// generation only, to avoid stacking a fourth concurrent OpenAI pipeline on
// top of embedding/summarization/figures at upload time). Also serves as
// "Regenerate" (GraphView.jsx calls this same route either way) — any
// previously-extracted graph data for this document is cleared first so
// repeated clicks don't pile up duplicate mentions/relationships.
export async function POST(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: documentId } = await params;
  if (!documentId) return NextResponse.json({ error: "Missing document id" }, { status: 400 });

  const doc = await prisma.document.findFirst({
    where: { id: documentId, user: { email: session.user.email } },
    select: { id: true, projectId: true },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await removeGraphDataForDocument(prisma, documentId, { projectId: doc.projectId });

  await prisma.graphExtractionLog.upsert({
    where: { documentId },
    create: { documentId, status: "pending" },
    update: { status: "pending", errorMessage: null, completedAt: null },
  });

  const sqs = new SQSClient({ region: process.env.AWS_REGION });
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.SQS_QUEUE_URL,
      MessageBody: JSON.stringify({ type: "graph", documentId, projectId: doc.projectId }),
    })
  );

  return NextResponse.json({ success: true });
}
