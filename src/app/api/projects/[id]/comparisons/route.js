import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { prisma } from "@/lib/prisma";

// POST creates a new comparison row + enqueues the "compare" SQS job,
// returning immediately (does NOT wait for the worker — the frontend polls
// GET /api/comparisons/[comparisonId] the same way GraphView.jsx/
// FiguresGallery.jsx already poll their own job statuses).
export async function POST(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: projectId } = await params;
  const { documentAId, documentBId } = await req.json();

  if (!documentAId || !documentBId || documentAId === documentBId) {
    return NextResponse.json({ error: "Two distinct documents are required" }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, user: { email: session.user.email } },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const [docA, docB] = await Promise.all([
    prisma.document.findFirst({ where: { id: documentAId, projectId } }),
    prisma.document.findFirst({ where: { id: documentBId, projectId } }),
  ]);
  if (!docA || !docB) {
    return NextResponse.json({ error: "Both documents must belong to this project" }, { status: 400 });
  }

  const comparison = await prisma.documentComparison.create({
    data: { projectId, documentAId, documentBId, status: "generating" },
  });

  const sqs = new SQSClient({ region: process.env.AWS_REGION });
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.SQS_QUEUE_URL,
      MessageBody: JSON.stringify({
        type: "compare",
        comparisonId: comparison.id,
        documentAId,
        documentBId,
        projectId,
      }),
    })
  );

  return NextResponse.json({ success: true, comparisonId: comparison.id });
}

// GET lists a project's comparisons newest-first, with both documents'
// filenames joined in.
export async function GET(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: projectId } = await params;

  const project = await prisma.project.findFirst({
    where: { id: projectId, user: { email: session.user.email } },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const comparisons = await prisma.documentComparison.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: {
      documentA: { select: { filename: true } },
      documentB: { select: { filename: true } },
    },
  });

  return NextResponse.json({
    success: true,
    comparisons: comparisons.map((c) => ({
      id: c.id,
      projectId: c.projectId,
      documentAId: c.documentAId,
      documentBId: c.documentBId,
      documentAFilename: c.documentA.filename,
      documentBFilename: c.documentB.filename,
      status: c.status,
      createdAt: c.createdAt,
    })),
  });
}
