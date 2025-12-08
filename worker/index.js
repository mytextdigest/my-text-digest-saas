import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, SendMessageCommand } from "@aws-sdk/client-sqs";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { extractPdfText } from "./extractPdf.js";
import mammoth from "mammoth";
import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";
import nodemailer from "nodemailer";
import { createStructuredSummary, summarizeChunks } from "./summarize.js";

const QUEUE_URL = process.env.SQS_QUEUE_URL;
const S3_BUCKET = process.env.S3_BUCKET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const sqs = new SQSClient({});
const s3 = new S3Client({});
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

function chunkText(text, size = 2000) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size)
    chunks.push(text.slice(i, i + size));

  return chunks;
}


async function processChunkJob(job) {
  const { docId, s3Key, filename } = job;
  console.log(`🟦 CHUNK JOB: ${docId}`);

  // 1. Set status
  await prisma.document.update({
    where: { id: docId },
    data: { status: "extracting" },
  });

  // 2. Download file
  const object = await s3.send(
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key })
  );

  const buffer = await streamToBuffer(object.Body);

  // 3. Extract text
  let text = "";
  if (filename.endsWith(".pdf")) {
    text = await extractPdfText(buffer);
  } else if (filename.endsWith(".txt")) {
    text = buffer.toString("utf8");
  } else if (filename.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  }

  await prisma.document.update({
    where: { id: docId },
    data: { content: text },
  });

  // 4. Chunk text
  const chunks = chunkText(text);

  await prisma.chunk.createMany({
    data: chunks.map((c, i) => ({
      documentId: docId,
      chunkIndex: i,
      text: c,
    })),
  });

  // 5. Status → chunked
  await prisma.document.update({
    where: { id: docId },
    data: { status: "chunked" },
  });

  // 6. Notify user (basic chat ready)
  const doc = await prisma.document.findUnique({
    where: { id: docId },
    include: { user: true },
  });

  if (doc?.user?.email) {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: doc.user.email,
      subject: "Chat is Ready",
      html: `
        <p>Your document <strong>${filename}</strong> is chunked.</p>
        <p>You can now start basic chat while embeddings are generated.</p>
      `,
    });
  }

  // 7. Enqueue embedding job
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify({
        type: "embed",
        docId,
        filename,
      }),
    })
  );

  console.log(`✅ Chunk job complete: ${docId}`);
}



async function processEmbeddingJob(job) {
  const { docId, filename } = job;
  console.log(`🟧 EMBEDDING JOB: ${docId}`);

  await prisma.document.update({
    where: { id: docId },
    data: { status: "embedding" },
  });

  const chunks = await prisma.chunk.findMany({
    where: { documentId: docId },
    orderBy: { chunkIndex: "asc" },
  });

  // Loop through & create embeddings
  for (const chunk of chunks) {
    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: chunk.text.slice(0, 8000),
    });

    await prisma.chunk.update({
      where: { id: chunk.id },
      data: { embedding: emb.data[0].embedding },
    });
  }

  // Mark as embedded
  await prisma.document.update({
    where: { id: docId },
    data: { status: "embedded" },
  });

  // Enqueue summarization
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify({
        type: "summarize",
        docId,
        filename,
      }),
    })
  );

  console.log(`✅ Embedding complete: ${docId}`);
}


async function processSummarizationJob(job) {
  const { docId, filename } = job;
  console.log(`🟩 SUMMARY JOB: ${docId}`);

  await prisma.document.update({
    where: { id: docId },
    data: { status: "summarizing" },
  });

  const chunks = await prisma.chunk.findMany({
    where: { documentId: docId },
    orderBy: { chunkIndex: "asc" },
  });

  const chunkTexts = chunks.map(c => c.text);

  // Summaries
  const chunkSummaries = await summarizeChunks(chunkTexts, filename);

  // Save chunk summaries
  for (let i = 0; i < chunkSummaries.length; i++) {
    await prisma.chunk.updateMany({
      where: { documentId: docId, chunkIndex: i },
      data: { summary: chunkSummaries[i] },
    });
  }

  // Final structured summary
  const structured = await createStructuredSummary(chunkSummaries, filename);

  await prisma.document.update({
    where: { id: docId },
    data: {
      summary: JSON.stringify(structured),
      status: "ready",
    },
  });

  // Notify user
  const doc = await prisma.document.findUnique({
    where: { id: docId },
    include: { user: true },
  });

  if (doc?.user?.email) {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: doc.user.email,
      subject: "Document Fully Ready ✔",
      html: `
        <p>Your document <strong>${filename}</strong> has been fully processed.</p>
        <p>High-level summary and improved chat are now available.</p>
      `,
    });
  }

  console.log(`✅ Summarization complete: ${docId}`);
}


async function processJob(job) {
  if (job.type === "chunk") return processChunkJob(job);
  if (job.type === "embed") return processEmbeddingJob(job);
  if (job.type === "summarize") return processSummarizationJob(job);

  throw new Error("Unknown job type: " + job.type);
}


async function mainLoop() {
  console.log("Worker started. Waiting for jobs...");

  while (true) {
    const res = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 20,
        VisibilityTimeout: 600,
      })
    );

    if (!res.Messages || res.Messages.length === 0) continue;

    const msg = res.Messages[0];
    const body = JSON.parse(msg.Body);

    try {
      await processJob(body);

      await sqs.send(
        new DeleteMessageCommand({
          QueueUrl: QUEUE_URL,
          ReceiptHandle: msg.ReceiptHandle,
        })
      );
    } catch (err) {
      console.error("❌ Worker error:", err);
    }
  }
}

mainLoop();
