// src/lib/tables/index.js
// Entry point for table extraction. extractTables() is pure and LLM-free:
// dispatch by file type → detect/structure → continuation → clean → verify.
// finishTables() runs the optional LLM steps (repair, titles).
// worker/processTables.js owns persistence, embeddings and progress.
import { readFile } from "fs/promises";
import config from "./config.js";
import { extractDocxTables } from "./docx/docxTables.js";
import { extractPdfTables } from "./pdf/index.js";
import { extractSpreadsheetTables } from "./spreadsheet.js";
import { buildClean } from "./clean.js";
import { verifyCleanAgainstRaw, flagRawTable } from "./verify.js";
import { repairLowConfidence } from "./repair.js";
import { titleTables, titleFromCaption } from "./title.js";
import { countCells } from "./schema.js";
import { isImageFilename } from "./vision/index.js";

const SPREADSHEET_EXT = [".xlsx", ".xls", ".csv"];

function supportsTables(filename) {
  const lower = String(filename || "").toLowerCase();
  return lower.endsWith(".pdf") || lower.endsWith(".docx") || SPREADSHEET_EXT.some((e) => lower.endsWith(e)) || isImageFilename(lower);
}

// Cap very large tables so the UI and chat stay responsive (FR-26 caps).
function capRows(raw) {
  const width = Math.max(1, raw.columns.length);
  const maxRows = Math.floor(config.MAX_CELLS_PER_TABLE / width);
  if (raw.rows.length > maxRows) {
    raw.totalRows = raw.rows.length;
    raw.rows = raw.rows.slice(0, maxRows);
    raw.truncated = true;
  }
  return raw;
}

function finalise(t) {
  capRows(t.raw);
  // Numbers in a text-layer grid come from the text layer itself; recheck
  // anyway so any future detector change can't introduce ungrounded values.
  let issues = t.sourceText ? flagRawTable(t.raw, t.sourceText) : 0;
  t.clean = buildClean(t.raw, { caption: [t.caption, t.unitNote].filter(Boolean).join(" ") || null });
  issues += verifyCleanAgainstRaw(t.clean);
  t.groundingIssues = issues;
  if (!t.title) {
    const fromCaption = titleFromCaption(t.caption);
    if (fromCaption) { t.title = fromCaption; t.titleSource = "caption"; }
  }
  t.rowCount = t.clean.rows.length;
  t.colCount = t.clean.columns.length;
  return t;
}

// Raw candidates (from any detector, including vision/) → finished tables.
function finaliseTables(tables) {
  return tables.map(finalise).filter((t) => countCells(t.clean) > 0 && t.clean.columns.length >= 1);
}

// `input` is the file's Buffer (an S3 download); a path string is also
// accepted so the golden tests can pass fixture paths as on desktop.
async function extractTables(filename, input) {
  const lower = String(filename || "").toLowerCase();
  const buffer = typeof input === "string" ? await readFile(input) : input;
  let result;
  if (lower.endsWith(".pdf")) result = await extractPdfTables(buffer);
  else if (lower.endsWith(".docx")) result = await extractDocxTables(buffer);
  else if (SPREADSHEET_EXT.some((e) => lower.endsWith(e))) result = extractSpreadsheetTables(buffer);
  // Images have no text layer: their tables come only from the vision path
  // (vision/index.js), which worker/processTables.js runs after this.
  else if (isImageFilename(lower)) return { tables: [], stats: { candidatesSeen: 0 }, supported: true };
  else return { tables: [], stats: { candidatesSeen: 0 }, supported: false };

  let tables = result.tables;
  let skippedForCap = 0;
  if (tables.length > config.MAX_TABLES_PER_DOCUMENT) {
    skippedForCap = tables.length - config.MAX_TABLES_PER_DOCUMENT;
    tables = tables.slice(0, config.MAX_TABLES_PER_DOCUMENT);
  }
  tables = finaliseTables(tables);
  return {
    tables,
    stats: { ...result.stats, skippedForCap, skippedLowConf: result.stats.skippedLowConf || 0 },
    supported: true,
  };
}

// Optional LLM steps. Each is isolated; failures leave the heuristic result.
async function finishTables(openai, tables, { docName = "", useLLM = true } = {}) {
  let repaired = 0;
  if (useLLM && openai) {
    try {
      repaired = await repairLowConfidence(openai, tables);
      for (const t of tables) if (t.repaired) finalise(t);
    } catch (err) {
      console.warn("⚠️  [tables] Repair step failed:", err.message || err);
    }
  }
  await titleTables(openai, tables, { docName, useLLM });
  return { repaired };
}

export { extractTables, finishTables, finaliseTables, supportsTables };
