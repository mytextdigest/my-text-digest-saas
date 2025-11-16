import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { extractPdfText } from "./extractPdf.js";
import mammoth from "mammoth";
import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";

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

function chunkText(text, size = 2000) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size)
    chunks.push(text.slice(i, i + size));
  return chunks;
}

async function processJob(job) {
  const { docId, s3Key, filename } = job;
  console.log("Processing job:", docId, filename);

  await prisma.document.update({
    where: { id: docId },
    data: { status: "extracting" },
  });

  // Download from S3
  const object = await s3.send(
    new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
    })
  );

  const buffer = await streamToBuffer(object.Body);

  // Extract text
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

  const chunks = chunkText(text);

  await prisma.chunk.createMany({
    data: chunks.map((c, i) => ({
      documentId: docId,
      chunkIndex: i,
      text: c,
    })),
  });

  // Embeddings
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

  // Summaries
  const summaries = [];
  for (const chunk of chunks) {
    const summary = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You summarize text." },
        { role: "user", content: chunk },
      ],
      max_tokens: 200,
      temperature: 0.3,
    });

    summaries.push(summary.choices[0].message.content);
  }

  // Final structured summary
  const final = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Create structured JSON summary." },
      {
        role: "user",
        content: summaries.join("\n\n")
      }
    ],
    max_tokens: 300,
    temperature: 0.3,
  });

  await prisma.document.update({
    where: { id: docId },
    data: {
      summary: final.choices[0].message.content,
      status: "ready",
    },
  });

  console.log("Job complete:", docId);
}

// Worker infinite loop
async function mainLoop() {
  console.log("Worker started. Waiting for jobs...");

  while (true) {
    const res = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: QUEUE_URL,
      MaxNumberOfMessages: 1,
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
