import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { prisma } from "@/lib/prisma";

// Creates a NEW DocumentComparison row + enqueues a new "compare" job — the
// old row is left alone and becomes history. Mirrors desktop's "regenerate
// creates a new id" behavior exactly; this must never update in place.
export async function POST(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { comparisonId } = await params;
  const existing = await prisma.documentComparison.findFirst({
    where: { id: comparisonId, project: { user: { email: session.user.email } } },
  });
  if (!existing) return NextResponse.json({ error: "Comparison not found" }, { status: 404 });

  const comparison = await prisma.documentComparison.create({
    data: {
      projectId: existing.projectId,
      documentAId: existing.documentAId,
      documentBId: existing.documentBId,
      status: "generating",
    },
  });

  const sqs = new SQSClient({ region: process.env.AWS_REGION });
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.SQS_QUEUE_URL,
      MessageBody: JSON.stringify({
        type: "compare",
        comparisonId: comparison.id,
        documentAId: existing.documentAId,
        documentBId: existing.documentBId,
        projectId: existing.projectId,
      }),
    })
  );

  return NextResponse.json({ success: true, comparisonId: comparison.id });
}
