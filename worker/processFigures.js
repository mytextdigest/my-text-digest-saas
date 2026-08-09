// worker/processFigures.js
// Forked, non-blocking SQS stage: extracts embedded figures/diagrams from
// PDF/DOCX documents, captions them with a vision model, OCRs them, and
// inserts a synthetic retrieval Chunk per figure — all without ever being
// able to flip Document.status to "failed" (see recordJobFailure's
// "figures" exclusion in worker/index.js, mirroring the "cluster" exclusion).

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { PrismaClient } from "@prisma/client";
import Tesseract from "tesseract.js";
import pLimit from "p-limit";
import { extractPdfFigures, extractDocxFigures, filterAndDedupFigures } from "./extractFigures.js";
import { getOpenAIForDocument } from "./openai.js";
import { upsertFigureChunk } from "../src/lib/figureChunk.js";

const S3_BUCKET = process.env.S3_BUCKET;

const s3 = new S3Client({
  requestHandler: new NodeHttpHandler({ connectionTimeout: 5000, requestTimeout: 60000 }),
});
const prisma = new PrismaClient();

// Vision captioning is slower/pricier than text embedding, hence a lower
// concurrency ceiling than the pLimit(5) used for embeddings/summaries.
const CAPTION_CONCURRENCY = 3;

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function figureS3Key({ userId, projectId, docId, figureIndex }) {
  return `uploads/${userId}/${projectId}/${docId}/figures/${figureIndex}.png`;
}

function getFigureMimeType(format) {
  return format === "jpeg" ? "image/jpeg" : "image/png";
}

async function captionFigure(openai, figure, buffer, format) {
  const base64 = buffer.toString("base64");

  const [visionResp, ocrResult] = await Promise.all([
    openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${getFigureMimeType(format)};base64,${base64}`, detail: "high" } },
          { type: "text", text: "Analyze this figure/diagram from a document. Describe what it shows, key data points, labels, and any visible text. Be concise but thorough." },
        ],
      }],
      max_tokens: 1000,
    }),
    Tesseract.recognize(buffer, "eng", { logger: () => {} }).catch((err) => {
      console.warn(`⚠️  OCR failed for figure ${figure.id}: ${err.message}`);
      return { data: { text: "" } };
    }),
  ]);

  return {
    caption: visionResp.choices[0].message.content,
    ocrText: ocrResult.data.text.trim(),
  };
}

// processFigureJob({ docId, s3Key, filename, projectId, userId })
// The entire body is wrapped so no error escapes it (decision 2) — an
// uncaught throw here would still trip SQS's redrive/DLQ machinery for what
// are individually-recoverable captioning failures, for a subsystem that
// isn't supposed to be able to fail the document.
export async function processFigureJob(job) {
  const { docId, s3Key, filename, projectId, userId } = job;

  try {
    const lower = (filename || "").toLowerCase();
    const isPdf = lower.endsWith(".pdf");
    const isDocx = lower.endsWith(".docx");
    if (!isPdf && !isDocx) return;

    console.log(`🟨 FIGURES JOB: ${docId}`);

    const object = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }));
    const buffer = await streamToBuffer(object.Body);

    const rawFigures = isPdf ? await extractPdfFigures(buffer) : await extractDocxFigures(buffer);
    const kept = filterAndDedupFigures(rawFigures, { minWidth: 100, minHeight: 100, maxFigures: 40 });

    if (kept.length === 0) {
      console.log(`🟨 FIGURES JOB: ${docId} — no qualifying figures found`);
      return;
    }

    // Upload + create a Figure row per kept image before captioning any of them.
    const figures = [];
    for (const fig of kept) {
      const key = figureS3Key({ userId, projectId, docId, figureIndex: fig.figureIndex });
      try {
        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
          Body: fig.buffer,
          ContentType: getFigureMimeType(fig.format),
        }));
      } catch (err) {
        console.error(`❌ Figure upload failed (doc ${docId}, figure ${fig.figureIndex}): ${err.message}`);
        continue;
      }

      const figure = await prisma.figure.create({
        data: {
          documentId: docId,
          figureIndex: fig.figureIndex,
          pageNumber: fig.pageNumber,
          sourceType: isPdf ? "pdf_image" : "docx_media",
          s3Key: key,
          width: fig.width,
          height: fig.height,
          format: fig.format,
          status: "pending",
        },
      });

      figures.push({ figure, buffer: fig.buffer, format: fig.format });
    }

    const openai = await getOpenAIForDocument(docId);
    const limit = pLimit(CAPTION_CONCURRENCY);

    await Promise.all(figures.map(({ figure, buffer: figBuffer, format }) =>
      limit(async () => {
        try {
          await prisma.figure.update({ where: { id: figure.id }, data: { status: "captioning" } });

          const { caption, ocrText } = await captionFigure(openai, figure, figBuffer, format);

          await prisma.figure.update({
            where: { id: figure.id },
            data: { caption, ocrText, status: "ready" },
          });

          const chunkId = await upsertFigureChunk({
            prisma,
            openai,
            figure,
            caption,
            ocrText,
          });

          await prisma.figure.update({ where: { id: figure.id }, data: { chunkId } });
        } catch (err) {
          console.error(`❌ Figure captioning failed (doc ${docId}, figure ${figure.figureIndex}): ${err.message}`);
          await prisma.figure.update({
            where: { id: figure.id },
            data: { status: "error", errorMessage: String(err?.message || err).slice(0, 2000) },
          }).catch((updateErr) => {
            console.error(`❌ Failed to record figure error (doc ${docId}, figure ${figure.figureIndex}): ${updateErr.message}`);
          });
        }
      })
    ));

    console.log(`✅ Figures job complete: ${docId} (${figures.length} figure(s))`);
  } catch (err) {
    console.error(`❌ Figures job failed (doc ${docId}): ${err?.message || err}`);
  }
}
