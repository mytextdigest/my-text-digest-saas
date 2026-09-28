// worker/processTables.js
// Automatic Table Extraction: a forked, non-blocking SQS stage like figures.
// Ported from the desktop's main.js orchestration (runTableExtraction,
// extractFigureTablesInBackground, extractRemainingScannedTables,
// embedTableChunks, scheduleTableReembed). Detection/cleaning/grounding is
// the pure code in src/lib/tables; this file owns persistence, embeddings
// and progress (written to TableExtractionLog.visionJson.progress for the
// UI's poller instead of IPC events).
//
// Four job types, each wrapped so no error escapes (like processFigureJob;
// see the table exclusions in worker/index.js's recordJobFailure) — table
// extraction never touches Document.status:
//   tables          text PDF / DOCX / spreadsheet / uploaded image
//   tables-scan     up to SCAN_BATCH_PAGES scanned PDF pages; self-chains
//   tables-figures  table pictures among the captioned figures
//   tables-reembed  one table's chunks after an edit
//
// Scanned pages run in small self-chaining batches (the graph-batch
// precedent) so no message comes near the 8-minute job watchdog.

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { PrismaClient, Prisma } from "@prisma/client";
import pLimit from "p-limit";
import config from "../src/lib/tables/config.js";
import { extractTables, finishTables, finaliseTables, supportsTables } from "../src/lib/tables/index.js";
import { isImageFilename, readImageFile, readScannedPages, readFigures } from "../src/lib/tables/vision/index.js";
import { effectiveTableOf } from "../src/lib/tables/schema.js";
import { toChunkTexts, signature as tableSignature } from "../src/lib/tables/serialize.js";
import { toTableRecord } from "../src/lib/tables/rows.js";
import { removeTableChunks, removeTablesForDocument, getTableSettings, pendingScannedPages } from "../src/lib/tables/cleanup.js";
import { getOpenAIForDocument } from "./openai.js";

const S3_BUCKET = process.env.S3_BUCKET;
const QUEUE_URL = process.env.SQS_QUEUE_URL;

const s3 = new S3Client({
  requestHandler: new NodeHttpHandler({ connectionTimeout: 5000, requestTimeout: 60000 }),
});
const sqs = new SQSClient({
  requestHandler: new NodeHttpHandler({ connectionTimeout: 5000, requestTimeout: 30000 }),
});
const prisma = new PrismaClient();

export const TABLE_JOB_TYPES = ["tables", "tables-scan", "tables-figures", "tables-reembed"];
export const SCAN_BATCH_PAGES = 8;
// tables-figures waits for the main run to record which pages are scanned
// (figures on them are skipped: the whole page is read instead).
const FIGURE_WAIT_SECONDS = 30;
const FIGURE_WAIT_MAX_ATTEMPTS = 20;

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function download(key) {
  const object = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  return streamToBuffer(object.Body);
}

export async function enqueueTableJob(body, { delaySeconds = 0 } = {}) {
  await sqs.send(new SendMessageCommand({
    QueueUrl: QUEUE_URL,
    MessageBody: JSON.stringify(body),
    ...(delaySeconds ? { DelaySeconds: delaySeconds } : {}),
  }));
}

async function upsertLog(docId, data) {
  await prisma.tableExtractionLog.upsert({
    where: { documentId: docId },
    create: { documentId: docId, status: data.status || "running", ...data },
    update: data,
  });
}

async function readVision(docId) {
  const log = await prisma.tableExtractionLog.findUnique({ where: { documentId: docId }, select: { visionJson: true } });
  return log?.visionJson || { scannedPages: [], checkedPages: [], calls: 0 };
}

async function writeVision(docId, patch) {
  const vision = await readVision(docId);
  const next = { ...vision, ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  await upsertLog(docId, { visionJson: next });
  return next;
}

async function tableCount(docId) {
  return prisma.documentTable.count({ where: { documentId: docId } });
}

async function openaiFor(docId, settings) {
  if (!settings.llm) return null;
  try {
    return await getOpenAIForDocument(docId);
  } catch (_) {
    return null; // no key: extraction still runs, LLM steps are skipped
  }
}

// Inserts finished tables after the document's existing ones, allocating
// tableIndex from max + 1 inside the transaction. preserveEdits: Map(key →
// old record) of user-edited tables to carry over when the same table (same
// index and page/sheet) is found again. `before(tx)` runs first in the same
// transaction (re-extraction removes the old tables there). Concurrent
// inserts for one document (another worker) collide on
// @@unique([documentId, tableIndex]) and are retried.
async function insertExtractedTables(docId, tables, { preserveEdits = null, before = null, after = null } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        if (before) await before(tx);
        const max = await tx.documentTable.aggregate({ where: { documentId: docId }, _max: { tableIndex: true } });
        const start = (max._max.tableIndex ?? -1) + 1;
        const data = tables.map((t, k) => {
          const i = start + k;
          const key = `${i}:${t.pageStart ?? ""}:${t.sheetName ?? ""}`;
          const prev = preserveEdits?.get(key);
          const userTitled = prev && prev.title_source === "user";
          const edited = prev?.edited_json || null;
          const eff = edited || t.clean;
          return {
            documentId: docId,
            tableIndex: i,
            pageStart: t.pageStart ?? null,
            pageEnd: t.pageEnd ?? null,
            sheetName: t.sheetName ?? null,
            sourceType: t.sourceType,
            title: userTitled ? prev.title : t.title,
            titleSource: userTitled ? "user" : t.titleSource,
            description: userTitled ? prev.description : t.description || null,
            caption: t.caption || null,
            confidence: t.confidence ?? null,
            rowCount: eff.rows.length,
            colCount: eff.columns.length,
            rawJson: t.raw,
            cleanJson: t.clean,
            editedJson: edited ?? Prisma.DbNull,
            editedAt: edited ? (prev.edited_at ? new Date(prev.edited_at) : new Date()) : null,
            groundingIssues: t.groundingIssues || 0,
            figureId: t.figureId ?? null,
            status: "ready",
          };
        });
        if (data.length) await tx.documentTable.createMany({ data });
        if (after) await after(tx);
        return data.length;
      }, { timeout: 60000 });
    } catch (err) {
      if (err?.code === "P2002" && attempt < 4) continue;
      throw err;
    }
  }
}

// Spreadsheets keep their existing row chunks, so their tables get no
// synthetic chunk — it would duplicate retrieval. They still get a
// signature embedding for find_tables/compare_tables.
async function embedTableChunks(docId, openai, { onlyTableId = null } = {}) {
  if (!openai) return;
  const doc = await prisma.document.findUnique({ where: { id: docId }, select: { filename: true } });
  const records = (await prisma.documentTable.findMany({
    where: {
      documentId: docId,
      status: "ready",
      ...(onlyTableId
        ? { id: onlyTableId }
        : { OR: [{ chunkId: null }, { signatureEmbedding: { equals: Prisma.DbNull } }] }),
    },
  })).map(toTableRecord);
  if (!records.length) return;

  const limit = pLimit(5);
  await Promise.all(records.map((record) => limit(async () => {
    try {
      const table = effectiveTableOf(record);
      if (!table) return;
      if (record.source_type !== "spreadsheet" && (onlyTableId || !record.chunk_id)) {
        const texts = toChunkTexts(table, {
          docName: doc?.filename,
          tableIndex: record.table_index,
          title: record.title,
          description: record.description,
          pageStart: record.page_start,
          pageEnd: record.page_end,
          sheetName: record.sheet_name,
        });
        let firstChunkId = null;
        for (let part = 0; part < texts.length; part++) {
          const text = texts[part];
          const emb = await openai.embeddings.create({ model: "text-embedding-3-small", input: text.slice(0, 8000) });
          const chunk = await prisma.chunk.create({
            data: {
              documentId: docId,
              chunkIndex: config.CHUNK_INDEX_BASE + record.table_index * 100 + part, // cosmetic only — never read back by index
              text,
              embedding: emb?.data?.[0]?.embedding ?? Prisma.DbNull,
              tableId: record.id,
              metadata: { tableId: record.id, pageNumber: record.page_start, sheetName: record.sheet_name, sourceType: record.source_type },
            },
          });
          if (firstChunkId == null) firstChunkId = chunk.id;
        }
        await prisma.documentTable.update({ where: { id: record.id }, data: { chunkId: firstChunkId } });
      }
      const signatureText = tableSignature(table, { title: record.title, description: record.description });
      const sig = await openai.embeddings.create({ model: "text-embedding-3-small", input: signatureText });
      await prisma.documentTable.update({
        where: { id: record.id },
        data: { signature: signatureText, signatureEmbedding: sig?.data?.[0]?.embedding ?? Prisma.DbNull },
      });
    } catch (err) {
      console.error(`❌ [tables] Embedding failed for table ${record.id}:`, err.message || err);
    }
  })));
}

// ---------------------------------------------------------------------------
// tables { docId, s3Key, filename, projectId, userId, rerun? }
// The desktop's runTableExtraction. Every run replaces the document's
// previous tables (so an SQS redelivery or a document retry never
// duplicates them), carrying user edits over by position; tables read from
// figures are left to tables-figures unless this is a re-extract.
// ---------------------------------------------------------------------------
export async function processTablesJob(job) {
  const { docId, s3Key, filename, rerun = false } = job;
  const startTime = Date.now();
  try {
    const doc = await prisma.document.findUnique({ where: { id: docId }, select: { id: true, userId: true } });
    if (!doc) return;
    const settings = await getTableSettings(prisma, doc.userId);
    if (!supportsTables(filename) || !settings.enabled) {
      await upsertLog(docId, { status: "disabled", completedAt: new Date() });
      return;
    }

    console.log(`📋 TABLES JOB: ${docId}${rerun ? " (re-extract)" : ""}`);
    const startedAt = new Date();
    await upsertLog(docId, {
      status: "running", tablesFound: 0, candidatesSeen: 0, skippedLowConf: 0, skippedForCap: 0,
      repairedByLlm: 0, errorMessage: null, startedAt, completedAt: null, visionJson: Prisma.DbNull,
    });

    const scope = rerun ? {} : { figureId: null };
    const preserveEdits = new Map();
    const previous = await prisma.documentTable.findMany({
      where: { documentId: docId, ...scope, OR: [{ editedAt: { not: null } }, { titleSource: "user" }] },
    });
    for (const t of previous.map(toTableRecord)) {
      preserveEdits.set(`${t.table_index}:${t.page_start ?? ""}:${t.sheet_name ?? ""}`, t);
    }

    const buffer = await download(s3Key);
    const { tables, stats } = await extractTables(filename, buffer);

    const openai = await openaiFor(docId, settings);
    const useLLM = !!openai && settings.llm;
    const useVision = useLLM && settings.vision;

    // Tables in images: the whole file when it is an image. A PDF's scanned
    // pages are queued as tables-scan batches once the text tables are in.
    let imageTables = [];
    let scanPages = [];
    if (isImageFilename(filename)) {
      if (useVision) {
        try {
          await upsertLog(docId, { visionJson: { scannedPages: [], checkedPages: [], calls: 0, progress: { done: 0, total: 1 } } });
          const res = await readImageFile(openai, buffer);
          await upsertLog(docId, { visionJson: { scannedPages: [], checkedPages: [], calls: res.calls } });
          imageTables = finaliseTables(res.candidates);
        } catch (err) {
          console.error(`❌ [${docId}] Reading tables from the image failed:`, err.message || err);
          await upsertLog(docId, { visionJson: { scannedPages: [], checkedPages: [], calls: 0 } });
        }
      }
    } else if (stats.scannedPageNumbers?.length) {
      await upsertLog(docId, { visionJson: { scannedPages: stats.scannedPageNumbers, checkedPages: [], calls: 0 } });
      if (useVision) scanPages = stats.scannedPageNumbers.slice(0, config.VISION_AUTO_MAX_PAGES);
    }

    const all = [...tables, ...imageTables];
    const { repaired } = await finishTables(openai, all, { docName: filename, useLLM });
    await insertExtractedTables(docId, all, {
      preserveEdits,
      before: (tx) => removeTablesForDocument(tx, docId, { keepLog: true, where: scope }),
    });

    await upsertLog(docId, {
      tablesFound: await tableCount(docId),
      candidatesSeen: (stats.candidatesSeen || 0) + imageTables.length,
      skippedLowConf: stats.skippedLowConf || 0,
      skippedForCap: stats.skippedForCap || 0,
      repairedByLlm: repaired || 0,
    });
    console.log(`📋 [${docId}] Found ${all.length} table(s)` + (imageTables.length ? ` (${imageTables.length} from the image)` : "") +
      ` in ${((Date.now() - startTime) / 1000).toFixed(1)}s` + (stats.rejected ? ` (${stats.rejected} candidate(s) rejected)` : ""));

    if (all.length) await embedTableChunks(docId, openai);

    if (scanPages.length) {
      // The log stays "running" until the last batch finishes.
      await writeVision(docId, { progress: { done: 0, total: scanPages.length } });
      await enqueueTableJob({
        type: "tables-scan", docId, s3Key, filename, auto: true, runStartedAt: startedAt.toISOString(),
        pages: scanPages.slice(0, SCAN_BATCH_PAGES), remaining: scanPages.slice(SCAN_BATCH_PAGES), done: 0, total: scanPages.length,
      });
    } else {
      await upsertLog(docId, { status: "ready", completedAt: new Date() });
    }
    // Figures are checked for tables again after a re-extract.
    if (rerun) await enqueueTableJob({ type: "tables-figures", docId });
  } catch (err) {
    console.error(`❌ [${docId}] Table extraction failed:`, err?.message || err);
    await upsertLog(docId, { status: "error", errorMessage: String(err?.message || err).slice(0, 2000), completedAt: new Date() })
      .catch((e) => console.error(`❌ Failed to record table extraction error (doc ${docId}):`, e.message));
  }
}

// ---------------------------------------------------------------------------
// tables-scan { docId, s3Key, filename, pages, remaining, auto, done, total, runStartedAt }
// One batch of scanned pages (the desktop's readScannedPagesForDoc). Pages
// already in checkedPages are skipped, and the batch's tables and its
// checkedPages are written in one transaction, so a redelivered batch never
// duplicates tables.
// ---------------------------------------------------------------------------
export async function processTablesScanJob(job) {
  const { docId, s3Key, filename, auto = true, remaining = [], total, runStartedAt } = job;
  try {
    const log = await prisma.tableExtractionLog.findUnique({ where: { documentId: docId } });
    // A re-extract started since this batch was queued: its own batches take over.
    if (!log || (runStartedAt && log.startedAt.toISOString() !== runStartedAt)) return;
    const doc = await prisma.document.findUnique({ where: { id: docId }, select: { userId: true } });
    if (!doc) return;
    const settings = await getTableSettings(prisma, doc.userId);
    const openai = await openaiFor(docId, settings);

    const vision = log.visionJson || { scannedPages: [], checkedPages: [], calls: 0 };
    const checkedBefore = new Set(vision.checkedPages || []);
    const pages = (job.pages || []).filter((p) => !checkedBefore.has(p));
    const doneBefore = job.done || 0;
    let found = [];
    let result = { checkedPages: [], calls: 0 };

    if (pages.length && openai && settings.vision) {
      console.log(`📋 TABLES-SCAN: ${docId} pages ${pages.join(",")}${auto ? "" : " (on demand)"}`);
      const buffer = await download(s3Key);
      const maxCalls = auto
        ? Math.max(0, config.VISION_AUTO_MAX_CALLS - (vision.calls || 0))
        : config.VISION_MAX_PAGES_ON_DEMAND;
      result = await readScannedPages(openai, buffer, pages, {
        maxPages: pages.length,
        maxCalls,
        onProgress: ({ done }) => writeVision(docId, { progress: { done: doneBefore + done, total } }),
      });
      found = finaliseTables(result.candidates);
      if (found.length) await finishTables(openai, found, { docName: filename, useLLM: true });
    }

    await insertExtractedTables(docId, found, {
      after: async (tx) => {
        const current = (await tx.tableExtractionLog.findUnique({ where: { documentId: docId }, select: { visionJson: true } }))?.visionJson || vision;
        const checked = new Set([...(current.checkedPages || []), ...result.checkedPages]);
        await tx.tableExtractionLog.update({
          where: { documentId: docId },
          data: {
            visionJson: { ...current, checkedPages: [...checked].sort((a, b) => a - b), calls: (current.calls || 0) + result.calls },
            tablesFound: await tx.documentTable.count({ where: { documentId: docId } }),
          },
        });
      },
    });
    if (found.length) {
      console.log(`📋 [${docId}] Found ${found.length} table(s) on scanned pages`);
      await embedTableChunks(docId, openai);
    }

    const done = doneBefore + (job.pages || []).length;
    if (remaining.length && openai && settings.vision) {
      await writeVision(docId, { progress: { done, total } });
      await enqueueTableJob({
        ...job, pages: remaining.slice(0, SCAN_BATCH_PAGES), remaining: remaining.slice(SCAN_BATCH_PAGES), done,
      });
    } else {
      await writeVision(docId, { progress: undefined });
      await upsertLog(docId, { status: "ready", completedAt: new Date() });
    }
  } catch (err) {
    console.error(`❌ [${docId}] Reading scanned pages failed:`, err?.message || err);
    // As on desktop: a failed page read leaves the pages pending, not an error state.
    try {
      await writeVision(docId, { progress: undefined });
      await upsertLog(docId, { status: "ready", completedAt: new Date() });
    } catch (e) {
      console.error(`❌ Failed to record scanned-page failure (doc ${docId}):`, e.message);
    }
  }
}

// ---------------------------------------------------------------------------
// tables-figures { docId, attempt? }
// The desktop's extractFigureTablesInBackground: runs after figure
// captioning, since the caption and OCR text decide which figures are worth
// a vision call. Figures on scanned pages are skipped: the whole page is
// read by tables-scan.
// ---------------------------------------------------------------------------
export async function processTablesFiguresJob(job) {
  const { docId, attempt = 0 } = job;
  try {
    const doc = await prisma.document.findUnique({ where: { id: docId }, select: { userId: true, filename: true } });
    if (!doc || !supportsTables(doc.filename)) return;
    const settings = await getTableSettings(prisma, doc.userId);
    if (!settings.enabled || !settings.vision || !settings.llm) return;
    const openai = await openaiFor(docId, settings);
    if (!openai) return;

    // The main run hasn't recorded the scanned pages yet: wait for it.
    const log = await prisma.tableExtractionLog.findUnique({ where: { documentId: docId } });
    if (!log || (log.status === "running" && !log.visionJson)) {
      if (attempt < FIGURE_WAIT_MAX_ATTEMPTS) {
        await enqueueTableJob({ type: "tables-figures", docId, attempt: attempt + 1 }, { delaySeconds: FIGURE_WAIT_SECONDS });
      }
      return;
    }

    const scanned = new Set(log.visionJson?.scannedPages || []);
    const figures = await prisma.figure.findMany({
      where: { documentId: docId, status: "ready", tableScan: null },
      orderBy: { figureIndex: "asc" },
    });
    const onScanned = figures.filter((f) => f.pageNumber != null && scanned.has(f.pageNumber));
    if (onScanned.length) {
      await prisma.figure.updateMany({ where: { id: { in: onScanned.map((f) => f.id) } }, data: { tableScan: "not-table" } });
    }
    const todo = figures.filter((f) => !(f.pageNumber != null && scanned.has(f.pageNumber)));
    if (!todo.length) return;

    console.log(`📋 TABLES-FIGURES: ${docId} (${todo.length} figure(s))`);
    const { candidates, outcomes } = await readFigures(
      openai,
      todo.map((f) => ({ id: f.id, caption: f.caption, ocr_text: f.ocrText, page_number: f.pageNumber, s3Key: f.s3Key })),
      { loadImage: (f) => download(f.s3Key) }
    );
    const found = finaliseTables(candidates);
    if (found.length) await finishTables(openai, found, { docName: doc.filename, useLLM: true });
    await insertExtractedTables(docId, found, {
      after: async (tx) => {
        for (const [figureId, outcome] of outcomes) {
          await tx.figure.update({ where: { id: figureId }, data: { tableScan: outcome } });
        }
        await tx.tableExtractionLog.update({
          where: { documentId: docId },
          data: { tablesFound: await tx.documentTable.count({ where: { documentId: docId } }) },
        });
      },
    });
    if (found.length) {
      console.log(`📋 [${docId}] Found ${found.length} table(s) in embedded images`);
      await embedTableChunks(docId, openai);
    }
  } catch (err) {
    console.error(`❌ [${docId}] Reading tables from figures failed:`, err?.message || err);
  }
}

// ---------------------------------------------------------------------------
// tables-reembed { tableId }
// Replaces the desktop's debounced scheduleTableReembed: always embeds the
// table's current state, so duplicate messages are harmless.
// ---------------------------------------------------------------------------
export async function processTablesReembedJob(job) {
  const { tableId } = job;
  try {
    const record = await prisma.documentTable.findUnique({ where: { id: tableId }, select: { id: true, documentId: true } });
    if (!record) return;
    await prisma.$transaction(async (tx) => {
      await removeTableChunks(tx, [tableId], record.documentId);
      await tx.documentTable.update({ where: { id: tableId }, data: { chunkId: null } });
    }, { timeout: 60000 });
    let openai = null;
    try { openai = await getOpenAIForDocument(record.documentId); } catch (_) {}
    await embedTableChunks(record.documentId, openai, { onlyTableId: tableId });
  } catch (err) {
    console.error(`❌ [tables] Re-embed failed for table ${tableId}:`, err?.message || err);
  }
}

export { pendingScannedPages };
