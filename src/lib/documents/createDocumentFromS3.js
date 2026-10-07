// src/lib/documents/createDocumentFromS3.js
// The post-validation body of documents/ingest: storage-limit check,
// Document create + storageUsedBytes increment, and the "chunk" job that
// starts the pipeline. Shared with chat image Save to project, which copies
// the image into uploads/ first. Server-only.
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";

// → { ok: true, doc } or { ok: false, status, body } for the route to return.
export async function createDocumentFromS3({ userId, projectId, s3Key, filename = s3Key.split("/").pop(), visibility = "private" }) {
  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      subscription: {
        include: { plan: true }
      }
    }
  });

  if (!dbUser)
    return { ok: false, status: 404, body: { error: "User not found" } };

  if (!dbUser.subscription || !dbUser.subscription.plan) {
    return { ok: false, status: 403, body: { error: "No active subscription" } };
  }

  const s3 = new S3Client({ region: process.env.AWS_REGION });

  const head = await s3.send(
    new HeadObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: s3Key,
    })
  );

  const fileSizeBytes = head.ContentLength;

  if (!fileSizeBytes) {
    return { ok: false, status: 400, body: { error: "Unable to determine file size" } };
  }

  const planLimitBytes =
    dbUser.subscription.plan.storageLimitGb * 1024 * 1024 * 1024;

  const currentUsage = BigInt(dbUser.storageUsedBytes);
  const incomingSize = BigInt(fileSizeBytes);
  const projectedUsage = currentUsage + incomingSize;

  if (projectedUsage > BigInt(planLimitBytes)) {
    return {
      ok: false,
      status: 413,
      body: {
        error: "Storage limit exceeded",
        limitGb: dbUser.subscription.plan.storageLimitGb,
        usedBytes: Number(currentUsage),
        incomingBytes: Number(incomingSize)
      },
    };
  }

  // Document created with "queued" status
  const [doc] = await prisma.$transaction([
    prisma.document.create({
      data: {
        filename,
        filePath: s3Key,
        status: "queued",
        visibility,
        project: { connect: { id: projectId } },
        user: { connect: { id: dbUser.id } },
      },
    }),

    prisma.user.update({
      where: { id: dbUser.id },
      data: {
        storageUsedBytes: {
          increment: fileSizeBytes
        }
      }
    })
  ]);

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
    visibility,
    regenerate: false
  });

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.SQS_QUEUE_URL,
      MessageBody: messageBody,
    })
  );

  return { ok: true, doc };
}
