import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, SendMessageCommand } from "@aws-sdk/client-sqs";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { extractPdfText } from "./extractPdf.js";
import { extractSpreadsheetChunks } from "./extractSpreadsheet.js";
import { runOCR } from "./runOcr.js";
import mammoth from "mammoth";
import Tesseract from "tesseract.js";
import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";
import nodemailer from "nodemailer";
import { createStructuredSummary, summarizeChunks } from "./summarize.js";
import { getOpenAIForDocument } from "./openai.js";
import { processClusterJobWorker } from "./cluster.js";
import { processFigureJob } from "./processFigures.js";

const QUEUE_URL = process.env.SQS_QUEUE_URL;
const S3_BUCKET = process.env.S3_BUCKET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Idle-socket timeouts on the AWS clients — without these, a stalled network
// call to SQS/S3 hangs the single-threaded mainLoop forever, blocking every
// other user's queued job behind it, not just the one that's stuck.
const sqs = new SQSClient({
  requestHandler: new NodeHttpHandler({ connectionTimeout: 5000, requestTimeout: 30000 }), // > the 20s long-poll wait
});
const s3 = new S3Client({
  requestHandler: new NodeHttpHandler({ connectionTimeout: 5000, requestTimeout: 60000 }),
});
const prisma = new PrismaClient();
// const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Overall watchdog per job — must stay comfortably under the SQS
// VisibilityTimeout (600s) below so a timed-out job's status update lands
// before SQS could otherwise redeliver the same message to another worker.
const JOB_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_MS) || 8 * 60 * 1000;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error(`Job timed out after ${ms}ms: ${label}`), { errorCode: "JOB_TIMEOUT" })),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

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

// Splits on sentence boundaries — used to break up a paragraph that alone
// exceeds the chunk size, without falling back to a mid-word hard cut.
const SENTENCE_SPLIT_RE = /(?<=[.?!])\s+(?=[A-Z0-9"'(])/;

function splitOversizedUnit(unit, size) {
  if (unit.length <= size) return [unit];

  const sentences = unit.split(SENTENCE_SPLIT_RE);
  if (sentences.length > 1) {
    return sentences.flatMap((s) => splitOversizedUnit(s, size));
  }

  // No sentence boundary found (e.g. one giant run-on line) — last resort
  // hard slice, same as the old behavior, but only for this one unit.
  const pieces = [];
  for (let i = 0; i < unit.length; i += size) pieces.push(unit.slice(i, i + size));
  return pieces;
}

// Paragraph/sentence-aware chunking with overlap: packs whole paragraphs
// (falling back to sentences, then a hard cut, only when a single paragraph
// itself exceeds `size`) into chunks up to `size` chars, and carries the
// tail paragraphs/sentences of each chunk into the start of the next so a
// fact sitting near a chunk boundary still appears whole in at least one chunk.
function chunkText(text, size = 2000, overlap = Math.round(size * 0.15)) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const units = paragraphs.flatMap((p) => splitOversizedUnit(p, size));

  const chunks = [];
  let current = [];
  let currentLen = 0;

  const flush = () => {
    if (current.length > 0) chunks.push(current.join("\n\n"));
  };

  for (const unit of units) {
    const addLen = unit.length + (current.length > 0 ? 2 : 0);

    if (currentLen > 0 && currentLen + addLen > size) {
      flush();

      // Carry trailing units from the chunk just flushed until the carried
      // text reaches ~`overlap` chars, forming the start of the next chunk.
      const carried = [];
      let carriedLen = 0;
      for (let i = current.length - 1; i >= 0 && carriedLen < overlap; i--) {
        carried.unshift(current[i]);
        carriedLen += current[i].length + 2;
      }
      current = carried;
      currentLen = carriedLen;
    }

    current.push(unit);
    currentLen += addLen;
  }

  flush();

  return chunks.length > 0 ? chunks : [text];
}


function sanitizeText(input) {
  if (!input) return "";

  return input
    // Remove replacement chars
    .replace(/\uFFFD/g, "")
    // Remove control chars except newline + tab
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    // Neutralize orphaned backslashes (CRITICAL)
    .replace(/\\(?![\\ntbrfux])/g, "")
    // Normalize unicode
    .normalize("NFC");
}

function forceValidUTF8(input) {
  if (!input) return "";
  return Buffer.from(input, "utf8").toString("utf8");
}

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
function isImageFile(f) {
  return IMAGE_EXTENSIONS.some(e => f.toLowerCase().endsWith(e));
}
function getImageMimeType(f) {
  const map = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
                '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp' };
  return map[Object.keys(map).find(k => f.toLowerCase().endsWith(k))] || 'image/jpeg';
}

function startTimer(label, meta = {}) {
  const start = Date.now();
  console.log(`⏱️ START ${label}`, meta);

  return () => {
    const durationMs = Date.now() - start;
    console.log(`⏱️ END ${label} — ${(durationMs / 1000).toFixed(2)}s`, meta);
    return durationMs;
  };
}

async function processChunkJob(job) {
  const { docId, s3Key, filename, visibility = "private", projectId } = job;
  console.log(`🟦 CHUNK JOB: ${docId} (${visibility})`);
  const endTotal = startTimer("CHUNK JOB TOTAL", { docId });


  // Typical RAG chunk sizes (~1,500-2,000 chars) rather than the old
  // 10,000-12,000 — smaller chunks keep embeddings sharply on-topic instead
  // of diluted across many unrelated sections, improving retrieval precision.
  const chunkSize = visibility === "public" ? 2200 : 1800;
  const BATCH_SIZE = 20; // SAFE for Prisma + Postgres

  // -----------------------------
  // 1. Mark extracting
  // -----------------------------
  const existingDoc = await prisma.document.findUnique({
    where: { id: docId },
  });

  if (!existingDoc) {
    throw new Error(`Document ${docId} not found (aborting chunk job)`);
  }

  await prisma.document.update({
    where: { id: docId },
    data: { status: "extracting" },
  });

  // -----------------------------
  // 2. Download file
  // -----------------------------
  const endDownload = startTimer("S3 DOWNLOAD", { docId });
  const object = await s3.send(
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key })
  );
  endDownload();

  const buffer = await streamToBuffer(object.Body);

  // -----------------------------
  // 3. Extract + sanitize text
  // -----------------------------
  let rawText = "";
  let sheetChunks = null; // set for spreadsheet docs — bypasses generic chunkText()

  const endExtract = startTimer("TEXT EXTRACTION", { docId, filename });

  const isSpreadsheet =
    filename.endsWith(".xlsx") ||
    filename.endsWith(".xls") ||
    filename.endsWith(".csv");

  if (isSpreadsheet) {
    const { chunks: extractedChunks, fullText } = extractSpreadsheetChunks(
      buffer,
      filename,
      chunkSize
    );
    sheetChunks = extractedChunks;
    rawText = fullText;
    endExtract();
  } else if (filename.endsWith(".pdf")) {
    rawText = await extractPdfText(buffer);

    // Detect scanned PDF: text layer is absent or too short to be useful
    const isLikelyScanned = !rawText || rawText.trim().length < 50;

    if (isLikelyScanned) {
      endExtract();
      console.log(`⚠️  Scanned PDF detected for doc ${docId} — starting OCR`);

      await prisma.document.update({
        where: { id: docId },
        data: { status: "running_ocr" },
      });

      const endOcr = startTimer("OCR", { docId });
      try {
        const { fullText } = await runOCR(buffer);
        rawText = fullText;
      } catch (err) {
        console.error("❌ OCR failed:", err.message);
        await prisma.document.update({
          where: { id: docId },
          data: { status: "ocr_failed" },
        });
        throw Object.assign(err, { errorCode: "OCR_FAILED", statusAlreadySet: true });
      }
      endOcr();
    } else {
      endExtract();
    }
  } else if (filename.endsWith(".txt")) {
    rawText = buffer.toString("utf8");
    endExtract();
  } else if (filename.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer });
    rawText = result.value;
    endExtract();
  } else if (isImageFile(filename)) {
    endExtract();
    await prisma.document.update({ where: { id: docId }, data: { status: "running_ocr" } });

    const tessWorker = await Tesseract.createWorker("eng");
    let ocrText = "";
    try {
      const { data } = await tessWorker.recognize(buffer);
      ocrText = data.text.trim();
    } finally {
      await tessWorker.terminate();
    }

    const openaiClient = await getOpenAIForDocument(docId);
    const base64 = buffer.toString("base64");
    const visionResp = await openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: [
        { type: "image_url", image_url: { url: `data:${getImageMimeType(filename)};base64,${base64}`, detail: "high" } },
        { type: "text", text: "Analyze this image comprehensively. Describe the main subjects, any text visible, colors, composition, context, data (charts/tables/graphs), and all important details." }
      ]}],
      max_tokens: 1000,
    });
    const visionDesc = visionResp.choices[0].message.content;

    rawText = `[Image Analysis]\n${visionDesc}\n\n[OCR Text]\n${ocrText || "(no text detected)"}`;
  } else {
    endExtract();
  }

  let text = forceValidUTF8(sanitizeText(rawText));

  if (!text || text.length < 50) {
    await prisma.document.update({
      where: { id: docId },
      data: { status: "chunk_failed" },
    });
    throw Object.assign(new Error(`Extracted text empty or invalid for doc ${docId}`), { statusAlreadySet: true });
  }

  await prisma.document.update({
    where: { id: docId },
    data: { content: text },
  });

  // -----------------------------
  // 4. Prepare chunks
  // -----------------------------
  const chunks = sheetChunks
    ? sheetChunks
        .map(c => ({
          text: forceValidUTF8(sanitizeText(c.text)),
          metadata: c.metadata,
        }))
        .filter(c => c.text.length > 0)
    : chunkText(text, chunkSize)
        .map(c => forceValidUTF8(sanitizeText(c)))
        .filter(c => c.length > 0)
        .map(c => ({ text: c, metadata: null }));



  if (chunks.length === 0) {
    await prisma.document.update({
      where: { id: docId },
      data: { status: "chunk_failed" },
    });
    throw Object.assign(new Error(`No valid chunks generated for doc ${docId}`), { statusAlreadySet: true });
  }


  // -----------------------------
  // 5. Insert chunks (atomic)
  // -----------------------------
  try {
    // Remove any partial leftovers (idempotency)
    await prisma.chunk.deleteMany({
      where: { documentId: docId },
    });

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);

      await prisma.chunk.createMany({
        data: batch.map((c, idx) => ({
          documentId: docId,
          chunkIndex: i + idx,
          text: c.text,
          metadata: c.metadata,
        })),
      });
    }
  } catch (err) {
    console.error("❌ Chunk insertion failed", {
      docId,
      totalChunks: chunks.length,
      failedAtBatch: Math.floor(chunks.length / BATCH_SIZE),
      error: err.message,
    });

    await prisma.document.update({
      where: { id: docId },
      data: { status: "chunk_failed" },
    });

    // IMPORTANT: fail hard → SQS retry
    throw Object.assign(err, { statusAlreadySet: true });
  }

  // -----------------------------
  // 6. Mark chunked
  // -----------------------------
  await prisma.document.update({
    where: { id: docId },
    data: { status: "chunked" },
  });

  // -----------------------------
  // 7. Notify user (optional)
  // -----------------------------
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
        <p>Your document <strong>${filename}</strong> is ready for chat.</p>
        <p>Embeddings are being generated in the background.</p>
      `,
    });
  }

  // -----------------------------
  // 8. Enqueue embedding job
  // -----------------------------
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify({
        type: "embed",
        docId,
        filename,
        projectId: projectId || existingDoc.projectId,
      }),
    })
  );

  // Forked, non-blocking figures stage — enqueued alongside (not chained
  // into) the embed job so vision captioning never delays the main
  // pipeline reaching Document.status: "ready". Needs s3Key, unlike
  // embed/summarize/cluster which don't carry the file itself.
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify({
        type: "figures",
        docId,
        s3Key,
        filename,
        projectId: projectId || existingDoc.projectId,
        userId: existingDoc.userId,
      }),
    })
  );

  console.log(`✅ Chunk job complete: ${docId}`);
  endTotal();
}




async function processEmbeddingJob(job) {
  const { docId, filename, projectId } = job;
  console.log(`🟧 EMBEDDING JOB: ${docId}`);

  const openai = await getOpenAIForDocument(docId);

  const endEmbeddingTotal = startTimer("EMBEDDING JOB TOTAL", { docId });

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

  // Enqueue summarization (pass projectId forward for cluster job)
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify({
        type: "summarize",
        docId,
        filename,
        projectId,
      }),
    })
  );

  console.log(`✅ Embedding complete: ${docId}`);
  endEmbeddingTotal()
}


async function processSummarizationJob(job) {
  const { docId, filename, projectId, regenerate = false } = job;

  const openai = await getOpenAIForDocument(docId);
  // regenerate defaults to false if not provided
  const endSummaryTotal = startTimer("SUMMARY TOTAL", {
    docId,
    regenerate,
  });



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
  const chunkSummaries = await summarizeChunks(openai, chunkTexts, filename);

  // Save chunk summaries
  for (let i = 0; i < chunkSummaries.length; i++) {
    await prisma.chunk.updateMany({
      where: { documentId: docId, chunkIndex: i },
      data: { summary: chunkSummaries[i] },
    });
  }

  // Final structured summary
  const structured = await createStructuredSummary(openai, chunkSummaries, filename);

  // Save document summary.
  // For first-time processing: set status to "clustering" (cluster job will set "ready").
  // For regeneration: set status to "ready" immediately (no re-clustering needed).
  await prisma.document.update({
    where: { id: docId },
    data: {
      summary: JSON.stringify(structured),
      status: regenerate ? "ready" : "clustering",
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

  // Enqueue clustering for first-time documents (not regeneration)
  if (!regenerate) {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: QUEUE_URL,
        MessageBody: JSON.stringify({
          type: "cluster",
          docId,
          filename,
          projectId,
        }),
      })
    );
    console.log(`🔗 Cluster job enqueued for: ${docId}`);
  }

  console.log(`✅ Summarization complete: ${docId} (regenerate: ${regenerate})`);
  endSummaryTotal();
}


async function processJob(job) {
  if (job.type === "chunk")    return processChunkJob(job);
  if (job.type === "embed")    return processEmbeddingJob(job);
  if (job.type === "summarize") return processSummarizationJob(job);
  if (job.type === "cluster")  return processClusterJobWorker(job.docId, job.projectId, job.recluster ?? false);
  if (job.type === "figures")  return processFigureJob(job);

  throw new Error("Unknown job type: " + job.type);
}


async function mainLoop() {
  console.log("Worker started. Waiting for jobs...");

  while (true) {
    let res;
    try {
      res = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: QUEUE_URL,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: 20,
          VisibilityTimeout: 600,
        })
      );
    } catch (err) {
      // A transient SQS error (throttling, network blip, brief AWS outage)
      // must not crash the whole worker process — that would silently stop
      // every user's pipeline until someone notices and restarts it by hand.
      console.error("❌ SQS receive error:", err.message);
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    if (!res.Messages || res.Messages.length === 0) continue;

    const msg = res.Messages[0];
    const body = JSON.parse(msg.Body);

    try {
      await withTimeout(processJob(body), JOB_TIMEOUT_MS, body.type);

      await sqs.send(
        new DeleteMessageCommand({
          QueueUrl: QUEUE_URL,
          ReceiptHandle: msg.ReceiptHandle,
        })
      );
    } catch (err) {
      console.error("❌ Worker error:", err);
      await recordJobFailure(body, err);
    }
  }
}

// Surfaces a failed job on the Document row so the UI can show a "Failed" +
// Retry state instead of leaving it spinning forever behind an SQS retry the
// user has no visibility into. Does NOT delete the SQS message — SQS's own
// maxReceiveCount/DLQ redrive is still the retry mechanism; this is purely
// for user-facing status.
//
// Cluster jobs are excluded: processClusterJobWorker already treats
// clustering failures as non-blocking (chat must stay usable even if topic
// matching fails), so only a watchdog timeout reaches this catch for that
// job type, and marking the doc "failed" here would fight with the
// in-flight cluster job that will still resolve it to "ready" on its own.
// Figures jobs are excluded for the same reason: processFigureJob already
// catches every internal error itself and never throws, so only a watchdog
// timeout would reach this catch — and figure captioning failures must
// never flip a document the user can already chat with into "failed".
async function recordJobFailure(body, err) {
  const docId = body?.docId;
  if (!docId || body.type === "cluster" || body.type === "figures") return;

  const data = {
    lastError: String(err?.message || err).slice(0, 2000),
    failedStage: body.type,
    failedAt: new Date(),
  };
  if (!err.statusAlreadySet) data.status = "failed";

  try {
    await prisma.document.update({ where: { id: docId }, data });
  } catch (updateErr) {
    console.error("❌ Failed to record job failure on document:", updateErr.message);
  }
}

// mainLoop() only ever settles on a bug we didn't anticipate — every
// expected failure path is caught inside the loop already. Restart rather
// than let the whole worker die and sit there until someone notices.
function startWorker() {
  mainLoop().catch((err) => {
    console.error("❌ mainLoop crashed, restarting in 5s:", err);
    setTimeout(startWorker, 5000);
  });
}

startWorker();
