// src/lib/tables/serialize.js
// Text forms of a canonical table: retrieval chunks, chat context blocks,
// Markdown/CSV/TSV/JSON, and the "signature" used to match tables across
// documents. Pure.
import config from "./config.js";
import { colLabel } from "./clean.js";

function cellText(cell) {
  if (!cell) return "";
  return String(cell.raw ?? "").replace(/\s+/g, " ").trim();
}

function headerLabels(table) {
  return (table.columns || []).map((c, j) => colLabel(c, j) || (j === 0 ? "Item" : `Column ${j + 1}`));
}

function pageLabel(meta) {
  if (meta.sheetName) return `Sheet: ${meta.sheetName}`;
  if (meta.pageStart == null) return null;
  return meta.pageEnd && meta.pageEnd !== meta.pageStart ? `Pages ${meta.pageStart}–${meta.pageEnd}` : `Page ${meta.pageStart}`;
}

// meta: { docName, tableIndex, title, pageStart, pageEnd, sheetName, description }
function prefixLine(table, meta) {
  const parts = [];
  if (meta.docName) parts.push(`[Document: ${meta.docName}]`);
  parts.push(`[Table ${(meta.tableIndex ?? 0) + 1}: ${meta.title || "Untitled table"}]`);
  const page = pageLabel(meta);
  if (page) parts.push(`[${page}]`);
  if (table.tableUnit) parts.push(`[Units: ${table.tableUnit}]`);
  return parts.join(" ");
}

function rowLine(table, row, i, headers) {
  const kind = row.kind && row.kind !== "data" ? ` (${row.kind})` : "";
  const cells = row.cells.map((c, j) => {
    const text = cellText(c);
    const unit = table.columns[j]?.unit && table.columns[j].unit !== table.tableUnit ? ` ${table.columns[j].unit}` : "";
    return `${headers[j]}=${text}${text && unit && unit !== " %" ? unit : ""}`;
  });
  return `Row ${i + 1}${kind}: ${cells.join(", ")}`;
}

// Same "Headers: … / Row n: col=value" format chunkSpreadsheetData uses, so
// the existing prompts already understand it. Splits long tables into several
// chunks, each repeating the prefix and headers.
function toChunkTexts(table, meta, maxChars = config.CHUNK_TEXT_CHARS) {
  const headers = headerLabels(table);
  const head = [prefixLine(table, meta)];
  if (meta.description) head.push(`Description: ${meta.description}`);
  head.push(`Headers: ${headers.join(", ")}`);
  const prefix = head.join("\n") + "\n";
  const chunks = [];
  let lines = [];
  let size = prefix.length;
  (table.rows || []).forEach((row, i) => {
    const line = rowLine(table, row, i, headers);
    if (lines.length && size + line.length + 1 > maxChars) {
      chunks.push(prefix + lines.join("\n"));
      lines = [];
      size = prefix.length;
    }
    lines.push(line);
    size += line.length + 1;
  });
  if (lines.length || !chunks.length) chunks.push(prefix + lines.join("\n"));
  return chunks;
}

function escapeMd(s) {
  return String(s).replace(/\|/g, "\\|");
}

function toMarkdown(table, { title = null, maxRows = Infinity } = {}) {
  const headers = headerLabels(table);
  const lines = [];
  if (title) lines.push(`**${escapeMd(title)}**${table.tableUnit ? ` (${table.tableUnit})` : ""}`, "");
  lines.push(`| ${headers.map(escapeMd).join(" | ")} |`);
  lines.push(`| ${table.columns.map((c) => (c.type && c.type !== "text" ? "---:" : "---")).join(" | ")} |`);
  const rows = (table.rows || []).slice(0, maxRows);
  for (const r of rows) {
    const cells = r.cells.map((c) => escapeMd(cellText(c)));
    if (r.kind === "total" || r.kind === "subtotal") cells[0] = cells[0] ? `**${cells[0]}**` : cells[0];
    lines.push(`| ${cells.join(" | ")} |`);
  }
  if ((table.rows || []).length > rows.length) lines.push(`| … ${table.rows.length - rows.length} more rows |`);
  const notes = (table.notes || []).filter((n) => n.text);
  if (notes.length) lines.push("", ...notes.map((n) => `${n.marker ? `(${n.marker}) ` : ""}${n.text}`));
  return lines.join("\n");
}

function delimited(table, sep) {
  const quote = (s) => {
    const str = String(s ?? "");
    if (sep === "\t") return str.replace(/[\t\r\n]+/g, " ");
    return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const rows = [headerLabels(table).map(quote).join(sep)];
  for (const r of table.rows || []) {
    rows.push(r.cells.map((c, j) => {
      // Numbers export as plain numbers so spreadsheets read them as numbers.
      const col = table.columns[j];
      if (col && col.type !== "text" && typeof c.v === "number") return quote(String(c.v));
      return quote(cellText(c));
    }).join(sep));
  }
  return rows.join("\r\n");
}

const toCSV = (t) => delimited(t, ",");
const toTSV = (t) => delimited(t, "\t");

function toJSON(table, meta = {}) {
  return JSON.stringify({ title: meta.title || null, description: meta.description || null, ...table }, null, 2);
}

// Compact context block for chat (FR-27). Keeps the header and as many rows
// as fit in `cap` characters; says explicitly when rows were cut.
function toContextBlock(table, meta, cap = config.CONTEXT_BLOCK_CHARS) {
  const head = prefixLine(table, meta);
  const md = toMarkdown(table);
  const lines = md.split("\n");
  let out = head + "\n";
  let used = 0;
  for (let i = 0; i < lines.length; i++) {
    if (out.length + lines[i].length + 1 > cap) {
      used = i;
      out += `… (${lines.length - i} more lines not shown)\n`;
      return out;
    }
    out += lines[i] + "\n";
    used = i;
  }
  return out;
}

// Text used for cross-document matching: title + description + labels.
function signature(table, meta = {}) {
  const headers = headerLabels(table).filter(Boolean);
  const labelCol = (table.columns || []).findIndex((c) => c.type === "text");
  const rowLabels = labelCol >= 0
    ? (table.rows || []).filter((r) => r.kind !== "section").slice(0, 25).map((r) => cellText(r.cells[labelCol])).filter(Boolean)
    : [];
  return [meta.title, meta.description, `Columns: ${headers.join(", ")}`, rowLabels.length ? `Rows: ${rowLabels.join(", ")}` : null]
    .filter(Boolean)
    .join("\n")
    .slice(0, 2000);
}

// Exact rows for chart generation (mirrors buildSpreadsheetChartData).
function toChartData(table, meta = {}, rowCap = 200) {
  const headers = headerLabels(table);
  const rows = (table.rows || []).filter((r) => r.kind !== "section").slice(0, rowCap);
  const lines = rows.map((r) => headers.map((h, j) => {
    const c = r.cells[j];
    const col = table.columns[j];
    const v = col && col.type !== "text" && typeof c?.v === "number" ? c.v : cellText(c);
    return `${h}=${v}`;
  }).join(", "));
  return `Table: ${meta.title || "Table"}${table.tableUnit ? ` (units: ${table.tableUnit})` : ""}\nHeaders: ${headers.join(", ")}\n${lines.join("\n")}`.slice(0, 12000);
}

export {
  cellText,
  headerLabels,
  pageLabel,
  toChunkTexts,
  toMarkdown,
  toCSV,
  toTSV,
  toJSON,
  toContextBlock,
  toChartData,
  signature,
};
