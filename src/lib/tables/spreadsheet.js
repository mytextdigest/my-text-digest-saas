// src/lib/tables/spreadsheet.js
// Spreadsheet parsing for table extraction (FR-4). Ported from desktop,
// where ingestion shares it; here ingestion keeps worker/extractSpreadsheet.js.
// Takes buffers (S3 downloads) instead of file paths.
import * as XLSX from "xlsx";
import { makeRawTable } from "./schema.js";
import config from "./config.js";

// Parse a spreadsheet buffer (.xlsx, .xls, .csv) with SheetJS.
// Returns { workbookName, sheets: [{ index, name, headers, rows }] }
function extractSpreadsheetData(buffer, workbookName = "") {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, defval: "" });

  const sheets = workbook.SheetNames.map((sheetName, index) => {
    const worksheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
      blankrows: false,
    });

    if (rawRows.length === 0) return { index, name: sheetName, headers: [], rows: [] };

    // Treat first non-empty row as headers; fall back to column letters if needed
    const rawHeaders = rawRows[0].map((h, i) => (String(h).trim() || `Col${i + 1}`));
    const dataRows = rawRows.slice(1);

    const rows = dataRows.map(rowArr => {
      const obj = {};
      rawHeaders.forEach((header, i) => {
        const val = rowArr[i] !== undefined ? rowArr[i] : "";
        obj[header] = val instanceof Date ? val.toISOString().split("T")[0] : String(val);
      });
      return obj;
    }).filter(row => Object.values(row).some(v => String(v).trim() !== ""));

    return { index, name: sheetName, headers: rawHeaders, rows };
  });

  return { workbookName, sheets };
}

// Serializes a spreadsheet's exact rows/headers (capped) for the chart-generation
// prompt, so numeric chart data can be sourced precisely instead of parsed out of
// lossy top-K RAG chunk text. Returns null if the file can't be read/parsed.
const CHART_SPREADSHEET_ROW_CAP = 200;
function buildSpreadsheetChartData(buffer) {
  try {
    if (!buffer) return null;
    const { sheets } = extractSpreadsheetData(buffer);
    return sheets
      .map(sheet => {
        const rows = sheet.rows.slice(0, CHART_SPREADSHEET_ROW_CAP);
        const lines = rows.map(row =>
          sheet.headers.map(h => `${h}=${row[h]}`).join(", ")
        );
        return `Sheet: ${sheet.name}\nHeaders: ${sheet.headers.join(", ")}\n${lines.join("\n")}`;
      })
      .join("\n\n")
      .slice(0, 12000);
  } catch (e) {
    console.error("buildSpreadsheetChartData error:", e.message || e);
    return null;
  }
}

// Convert one sheet's rows into fixed-size text chunks that preserve header context.
// Returns an array of { text, pageNumber, sheetName, rowRange } objects.
function chunkSpreadsheetData(sheet, chunkSize, workbookName) {
  const { index, name: sheetName, headers, rows } = sheet;
  if (rows.length === 0) return [];

  const headerLine = `Headers: ${headers.join(", ")}`;
  const prefix = `[Workbook: ${workbookName}] [Sheet: ${sheetName}]\n${headerLine}\n`;

  const chunks = [];
  let currentLines = [];
  let currentSize = prefix.length;
  let chunkStartRow = 2; // 1-indexed, row 1 is the header

  const flushChunk = (endRow) => {
    if (currentLines.length === 0) return;
    const rowRange = `rows ${chunkStartRow}–${endRow}`;
    chunks.push({
      text: prefix + currentLines.join("\n"),
      pageNumber: index,
      sheetName,
      rowRange,
    });
    currentLines = [];
    currentSize = prefix.length;
    chunkStartRow = endRow + 1;
  };

  rows.forEach((row, i) => {
    const dataRowNumber = i + 2; // +2: 1-indexed + skip header
    const rowLine = `Row ${dataRowNumber}: ` + headers.map(h => `${h}=${row[h] ?? ""}`).join(", ");

    if (currentLines.length > 0 && currentSize + rowLine.length + 1 > chunkSize) {
      flushChunk(dataRowNumber - 1);
    }

    currentLines.push(rowLine);
    currentSize += rowLine.length + 1;
  });

  flushChunk(rows.length + 1); // flush any remaining rows

  return chunks;
}

// Each non-empty sheet becomes one raw table (confidence 1, title = sheet
// name). Large sheets are capped at MAX_CELLS_PER_TABLE and marked
// truncated; cross-document operations can re-read the file when needed.
function extractSpreadsheetTables(buffer) {
  const { sheets } = extractSpreadsheetData(buffer);
  const tables = [];
  let skippedEmpty = 0;
  for (const sheet of sheets) {
    if (!sheet.rows.length || sheet.headers.length < 1) { skippedEmpty++; continue; }
    const width = sheet.headers.length;
    const maxRows = Math.max(1, Math.floor(config.MAX_CELLS_PER_TABLE / Math.max(1, width)) - 1);
    const truncated = sheet.rows.length > maxRows;
    const grid = [
      sheet.headers,
      ...sheet.rows.slice(0, maxRows).map((row) => sheet.headers.map((h) => String(row[h] ?? ""))),
    ];
    const raw = makeRawTable(grid, { headerRows: 1 });
    if (truncated) { raw.truncated = true; raw.totalRows = sheet.rows.length; }
    tables.push({
      raw,
      caption: null,
      title: sheet.name,
      sheetName: sheet.name,
      nearbyHeading: sheet.name,
      pageStart: null,
      pageEnd: null,
      confidence: 1,
      sourceType: "spreadsheet",
      sourceText: null,
    });
  }
  return { tables, stats: { candidatesSeen: sheets.length, skippedEmpty } };
}

export {
  extractSpreadsheetData,
  buildSpreadsheetChartData,
  chunkSpreadsheetData,
  extractSpreadsheetTables,
};
