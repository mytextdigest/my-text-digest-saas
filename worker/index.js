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


function sanitizeText(input) {
  if (!input) return "";

  return input
    // Remove invalid UTF-8 replacement chars
    .replace(/\uFFFD/g, "")
    // Remove control characters except newline/tab
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    // Normalize Unicode
    .normalize("NFC");
}


async function processChunkJob(job) {
  const { docId, s3Key, filename, visibility="private" } = job;
  console.log(`🟦 CHUNK JOB: ${docId} (${visibility})`);

  const chunkSize = visibility === "public" ? 8000 : 2000;

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

  text = sanitizeText(text);

  await prisma.document.update({
    where: { id: docId },
    data: { content: text },
  });

  // 4. Chunk text
  const chunks = chunkText(text, chunkSize)
  .map(c => sanitizeText(c))
  .filter(Boolean);

  const BATCH_SIZE = 50;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);

    

    try {
      await prisma.chunk.createMany({
        data: batch.map((c, idx) => ({
          documentId: docId,
          chunkIndex: i + idx,
          text: c,
        })),
      });
    } catch (err) {
      console.error("❌ Chunk insert failed", {
        docId,
        batchStart: i,
        batchEnd: i + batch.length - 1,
        chunkCount: batch.length,
        sample: batch[0]?.slice(0, 200),
      });
    
       // IMPORTANT: let worker fail so SQS retries
    }


  }

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
  const { docId, filename, regenerate = false } = job; 
  // regenerate defaults to false if not provided

  console.log(`🟩 SUMMARY JOB: ${docId} (regenerate = ${regenerate})`);

  // Update status → summarizing
  await prisma.document.update({
    where: { id: docId },
    data: { status: "summarizing" },
  });

  // Load chunks
  const chunks = await prisma.chunk.findMany({
    where: { documentId: docId },
    orderBy: { chunkIndex: "asc" },
  });

  // Decide which text to summarize:
  // - Regenerate mode: Prefer existing summaries → use them as input (if available)
  // - Normal mode: Always use raw text
  const chunkTexts = regenerate
    ? chunks.map(c => c.summary || c.text || "")
    : chunks.map(c => c.text || "");

  console.log(`📄 Summarizing ${chunkTexts.length} chunks (regenerate: ${regenerate})`);

  // Generate per-chunk summaries
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

  // Save document summary + mark ready
  await prisma.document.update({
    where: { id: docId },
    data: {
      summary: JSON.stringify(structured),
      status: "ready",
    },
  });

  // Load user details
  const doc = await prisma.document.findUnique({
    where: { id: docId },
    include: { user: true },
  });

  // No email? Skip
  if (!doc?.user?.email) {
    console.log("⚠️ No user email found, skipping notification");
  } else {

    // -------------------------------------------
    // 📬 DIFFERENT EMAILS FOR regenerate vs normal
    // -------------------------------------------

    if (regenerate) {
      // 🔁 REGENERATED SUMMARY
      await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: doc.user.email,
        subject: "Your Summary Has Been Regenerated ✔",
        html: `
          <p>Hello,</p>
          <p>Your document <strong>${filename}</strong> has a newly regenerated summary.</p>
          <p>You can now review the improved structured summary in your dashboard.</p>
          <p>— MyTextDigest</p>
        `,
      });

      console.log(`📧 Regeneration email sent to ${doc.user.email}`);

    } else {
      // 🆕 FIRST-TIME FULL PROCESSING
      await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: doc.user.email,
        subject: "Document Fully Processed ✔",
        html: `
          <p>Your document <strong>${filename}</strong> has been fully processed.</p>
          <p>High-level summary and improved chat are now available.</p>
          <p>— MyTextDigest</p>
        `,
      });

      console.log(`📧 Completion email sent to ${doc.user.email}`);
    }
  }

  console.log(`✅ Summarization complete: ${docId} (regenerate: ${regenerate})`);
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
