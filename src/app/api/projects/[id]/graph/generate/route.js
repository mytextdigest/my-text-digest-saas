import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { prisma } from "@/lib/prisma";

// Batch-generates graphs for every project document lacking a ready
// GraphExtractionLog. Given this repo's request-timeout constraints, this
// enqueues a single "graph-batch" coordinator job (worker/processGraph.js)
// that itself loops through pending documents sequentially and awaits each
// one's completion — rather than blocking this HTTP request for the whole
// batch. The frontend polls GET .../graph the same way it already does for
// single-document generation.
export async function POST(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: projectId } = await params;
  if (!projectId) return NextResponse.json({ error: "Missing project id" }, { status: 400 });

  const project = await prisma.project.findFirst({
    where: { id: projectId, user: { email: session.user.email } },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const docs = await prisma.document.findMany({
    where: { projectId },
    select: { id: true },
  });

  const readyLogs = await prisma.graphExtractionLog.findMany({
    where: { documentId: { in: docs.map((d) => d.id) }, status: "ready" },
    select: { documentId: true },
  });
  const readyIds = new Set(readyLogs.map((l) => l.documentId));
  const pending = docs.filter((d) => !readyIds.has(d.id));

  if (pending.length === 0) {
    return NextResponse.json({ success: true, documentsQueued: 0 });
  }

  const sqs = new SQSClient({ region: process.env.AWS_REGION });
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.SQS_QUEUE_URL,
      MessageBody: JSON.stringify({ type: "graph-batch", projectId }),
    })
  );

  return NextResponse.json({ success: true, documentsQueued: pending.length });
}
