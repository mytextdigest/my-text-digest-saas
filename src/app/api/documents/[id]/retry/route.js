import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { prisma } from "@/lib/prisma";

const RETRYABLE_STATUSES = new Set(["failed", "chunk_failed", "ocr_failed"]);

// Maps the pipeline stage that failed to (a) the status the document should
// show while the re-enqueued job is in flight and (b) the SQS message that
// resumes the pipeline from that stage, instead of re-running stages that
// already succeeded.
const STAGE_CONFIG = {
  chunk: (doc) => ({
    resetStatus: "queued",
    message: {
      type: "chunk",
      docId: doc.id,
      s3Key: doc.filePath,
      filename: doc.filename,
      projectId: doc.projectId,
      userId: doc.userId,
      visibility: doc.visibility,
      regenerate: false,
    },
  }),
  embed: (doc) => ({
    resetStatus: "chunked",
    message: { type: "embed", docId: doc.id, filename: doc.filename, projectId: doc.projectId },
  }),
  summarize: (doc) => ({
    resetStatus: "embedded",
    message: { type: "summarize", docId: doc.id, filename: doc.filename, projectId: doc.projectId, regenerate: false },
  }),
};

export async function POST(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing document id" }, { status: 400 });

  const doc = await prisma.document.findFirst({
    where: { id, user: { email: session.user.email } },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!RETRYABLE_STATUSES.has(doc.status)) {
    return NextResponse.json(
      { error: `Document is not in a failed state (status: ${doc.status})` },
      { status: 400 }
    );
  }

  // chunk_failed/ocr_failed always originate from the chunk stage; a
  // "failed" status without a recorded failedStage (e.g. a pre-migration
  // row) falls back to a full re-chunk — the safest resumption point.
  const stage = doc.failedStage && STAGE_CONFIG[doc.failedStage] ? doc.failedStage : "chunk";

  if (stage === "chunk" && !doc.filePath) {
    return NextResponse.json({ error: "Document has no stored file to reprocess" }, { status: 400 });
  }

  const { resetStatus, message } = STAGE_CONFIG[stage](doc);

  await prisma.document.update({
    where: { id },
    data: { status: resetStatus, lastError: null, failedStage: null, failedAt: null },
  });

  const sqs = new SQSClient({ region: process.env.AWS_REGION });
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.SQS_QUEUE_URL,
      MessageBody: JSON.stringify(message),
    })
  );

  return NextResponse.json({ success: true, status: resetStatus });
}
