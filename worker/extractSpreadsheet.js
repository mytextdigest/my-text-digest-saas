// worker/extractSpreadsheet.js
// Structure-aware extraction for .xlsx / .xls / .csv using SheetJS (xlsx).
// Unlike the plain-text extractors, this returns ready-made chunk records
// (text + metadata) so sheet/row/column context survives into the Chunk table.
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

function renderRows(headers, rows) {
  return rows
    .map((row) =>
      headers
        .map((h, idx) => `${h || `Col${idx + 1}`}: ${row[idx] ?? ""}`)
        .join(" | ")
    )
    .join("\n");
}

function buildSheetSections(workbook, filename, chunkSize) {
  const chunks = [];
  const fullTextParts = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      blankrows: false,
      defval: "",
    });

    if (rows.length === 0) continue;

    const headers = rows[0].map((h) => String(h ?? "").trim());
    const dataRows = rows.slice(1);
    const columnsLine = `Columns: ${headers.join(", ")}`;

    fullTextParts.push(`## Sheet: ${sheetName}\n${columnsLine}`);

    if (dataRows.length === 0) {
      chunks.push({
        text: `Workbook: ${filename}\nSheet: ${sheetName}\n${columnsLine}\n\n(No data rows)`,
        metadata: {
          workbookName: filename,
          sheetName,
          tableName: null,
          rowRange: null,
          columnHeaders: headers,
        },
      });
      continue;
    }

    // Group consecutive rows into chunks by accumulated text size, repeating
    // the header line in each chunk so retrieval keeps "header relationships".
    const preamble = `Workbook: ${filename}\nSheet: ${sheetName}\n${columnsLine}\n\n`;
    let bucket = [];
    let bucketStartRow = 2; // row 1 is the header, data starts at row 2 (1-based)

    const flushBucket = (endRow) => {
      if (bucket.length === 0) return;
      const tableText = renderRows(headers, bucket);
      const rowRange = `${bucketStartRow}-${endRow}`;
      chunks.push({
        text: `${preamble}Rows ${rowRange}\n\n${tableText}`,
        metadata: {
          workbookName: filename,
          sheetName,
          tableName: null,
          rowRange,
          columnHeaders: headers,
        },
      });
      fullTextParts.push(tableText);
      bucket = [];
    };

    let bucketChars = 0;
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNumber = i + 2; // 1-based, accounting for header row
      const rowText = headers
        .map((h, idx) => `${h || `Col${idx + 1}`}: ${row[idx] ?? ""}`)
        .join(" | ");

      if (bucket.length > 0 && bucketChars + rowText.length > chunkSize) {
        flushBucket(rowNumber - 1);
        bucketStartRow = rowNumber;
        bucketChars = 0;
      }

      bucket.push(row);
      bucketChars += rowText.length + 1;
    }

    flushBucket(dataRows.length + 1);
  }

  return { chunks, fullText: fullTextParts.join("\n\n") };
}

export function extractSpreadsheetChunks(buffer, filename, chunkSize = 4000) {
  const isCsv = filename.toLowerCase().endsWith(".csv");

  const workbook = isCsv
    ? XLSX.read(buffer.toString("utf8"), { type: "string" })
    : XLSX.read(buffer, { type: "buffer" });

  return buildSheetSections(workbook, filename, chunkSize);
}
