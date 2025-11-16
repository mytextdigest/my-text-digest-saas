import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { extractPdfText } from "./extractPdf.js";
import mammoth from "mammoth";
import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";
import nodemailer from "nodemailer";
import { createStructuredSummary, summarizeChunks } from "./summarize.js";


// ENVIRONMENT VARS
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

async function processJob(job) {
  const { docId, s3Key, filename, regenerate } = job;
  console.log(`🟡 Processing job: ${docId} (${filename})`);

  if (regenerate === true) {
    console.log(`🔁 Regenerating summary for ${docId}...`);

    // Set status → summarizing
    await prisma.document.update({
      where: { id: docId },
      data: { status: "summarizing" },
    });

    // Load existing chunks from DB
    const existingChunks = await prisma.chunk.findMany({
      where: { documentId: docId },
      orderBy: { chunkIndex: "asc" },
      select: { chunkIndex: true, summary: true, text: true },
    });

    // Use summary first if exists, else raw text
    const chunkTexts = existingChunks.map(c => c.summary || c.text || "");

    console.log(`📄 Using ${chunkTexts.length} existing chunks for regeneration`);

    // Run the same summarize functions
    const chunkSummaries = await summarizeChunks(chunkTexts, filename);
    const structured = await createStructuredSummary(chunkSummaries, filename);

    // Save back chunk summaries
    for (let i = 0; i < chunkSummaries.length; i++) {
      await prisma.chunk.updateMany({
        where: { documentId: docId, chunkIndex: i },
        data: { summary: chunkSummaries[i] },
      });
    }

    // Save final structured summary
    await prisma.document.update({
      where: { id: docId },
      data: {
        summary: JSON.stringify(structured),
        status: "ready",
      },
    });

    console.log(`✅ Regenerate summary complete: ${docId}`);

    return; 
  }

  //
  // 1. Update status → extracting
  //
  await prisma.document.update({
    where: { id: docId },
    data: { status: "extracting" },
  });

  //
  // 2. Download file from S3
  //
  const object = await s3.send(
    new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
    })
  );

  const buffer = await streamToBuffer(object.Body);

  //
  // 3. Extract text
  //
  let text = "";
  if (filename.endsWith(".pdf")) {
    text = await extractPdfText(buffer);
  } else if (filename.endsWith(".txt")) {
    text = buffer.toString("utf8");
  } else if (filename.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else {
    throw new Error("Unsupported file type");
  }

  await prisma.document.update({
    where: { id: docId },
    data: { content: text },
  });

  //
  // 4. Chunk text
  //
  const chunks = chunkText(text);

  await prisma.chunk.createMany({
    data: chunks.map((c, i) => ({
      documentId: docId,
      chunkIndex: i,
      text: c,
    })),
  });

  //
  // 5. Generate embeddings (sequential is okay)
  //
  await prisma.document.update({
    where: { id: docId },
    data: { status: "embedding" },
  });

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: chunk.slice(0, 8000),
    });

    await prisma.chunk.updateMany({
      where: { documentId: docId, chunkIndex: i },
      data: { embedding: emb.data[0].embedding },
    });
  }

  //
  // 6. Summaries (PARALLEL, FAST, like Desktop App)
  //
  await prisma.document.update({
    where: { id: docId },
    data: { status: "summarizing" },
  });

  const chunkSummaries = await summarizeChunks(chunks, filename);

  //
  // 7. Save per-chunk summaries
  //
  for (let i = 0; i < chunkSummaries.length; i++) {
    await prisma.chunk.updateMany({
      where: { documentId: docId, chunkIndex: i },
      data: { summary: chunkSummaries[i] },
    });
  }

  //
  // 8. Final structured summary
  //
  const structured = await createStructuredSummary(chunkSummaries, filename);

  await prisma.document.update({
    where: { id: docId },
    data: {
      summary: JSON.stringify(structured),
      status: "ready",
    },
  });

  console.log(`✅ Job complete: ${docId}`);

  //
  // 9. EMAIL NOTIFICATION
  //
  try {
    const doc = await prisma.document.findUnique({
      where: { id: docId },
      include: { user: true },
    });

    const userEmail = doc?.user?.email;
    if (!userEmail) {
      console.log("⚠️ No user email found, skipping notification");
      return;
    }

    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: userEmail,
      subject: "Your Document Is Ready ✔",
      text: `Your document "${filename}" has been successfully processed.`,
      html: `
        <p>Hello,</p>
        <p>Your document <strong>${filename}</strong> has been processed and is now ready in your dashboard.</p>
        <p>— MyTextDigest</p>
      `,
    });

    console.log(`📧 Email sent to: ${userEmail}`);
  } catch (err) {
    console.error("❌ Email sending failed:", err);
  }
}

// Worker infinite loop
async function mainLoop() {
  console.log("Worker started. Waiting for jobs...");

  while (true) {
    const res = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: QUEUE_URL,
      MaxNumberOfMessages: 2,
      WaitTimeSeconds: 20,  // Long polling
      VisibilityTimeout: 600,
    }));

    if (!res.Messages || res.Messages.length === 0) continue;

    const msg = res.Messages[0];
    const body = JSON.parse(msg.Body);

    try {
      await processJob(body);

      await sqs.send(new DeleteMessageCommand({
        QueueUrl: QUEUE_URL,
        ReceiptHandle: msg.ReceiptHandle,
      }));
    } catch (err) {
      console.error("Error processing job:", err);
      // SQS will retry after visibility timeout
    }
  }
}

mainLoop();
