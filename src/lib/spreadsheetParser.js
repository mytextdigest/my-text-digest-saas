import { createRequire } from "module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const MAX_ROWS = 1000;

export async function streamToBuffer(stream) {
  const parts = [];
  for await (const chunk of stream) parts.push(chunk);
  return Buffer.concat(parts);
}

export function parseWorkbook(buffer, filename) {
  const isCsv = filename.toLowerCase().endsWith(".csv");
  const workbook = isCsv
    ? XLSX.read(buffer.toString("utf8"), { type: "string" })
    : XLSX.read(buffer, { type: "buffer" });

  return workbook.SheetNames.map((name) => {
    const ws = workbook.Sheets[name];
    const raw = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      blankrows: false,
      defval: "",
    });

    if (raw.length === 0) {
      return { name, headers: [], rows: [], totalRows: 0 };
    }

    const headers = raw[0].map((h) => String(h ?? "").trim());
    const dataRows = raw.slice(1);
    const totalRows = dataRows.length;

    const rows = dataRows.slice(0, MAX_ROWS).map((row) => {
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h || `Col${idx + 1}`] = String(row[idx] ?? "");
      });
      return obj;
    });

    return { name, headers, rows, totalRows };
  });
}
