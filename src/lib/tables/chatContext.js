// src/lib/tables/chatContext.js
// Table context for chat (FR-27/FR-28), ported from the desktop's main.js
// buildTableContext / pickTableCitations / tableChartExtraData / tableMeta
// onto Prisma. When retrieval hits a table chunk, or the user asked about a
// specific table, the whole table goes into the context — exact extracted
// numbers beat a slice of chunk text.
import config from "./config.js";
import { effectiveTableOf } from "./schema.js";
import { toContextBlock, toChartData } from "./serialize.js";
import { computeTableStats, tableStatsText } from "./stats.js";
import { toTableRecord } from "./rows.js";

export function tableMeta(record, docName) {
  return {
    docName,
    tableIndex: record.table_index,
    title: record.title,
    description: record.description,
    pageStart: record.page_start,
    pageEnd: record.page_end,
    sheetName: record.sheet_name,
  };
}

// A ready table as a citation source { record, table, docName }, or null.
// `where` scopes the lookup (the caller's documents only).
export async function loadTableSource(prisma, id, where = {}) {
  const row = await prisma.documentTable.findFirst({
    where: { id, status: "ready", ...where },
    include: { document: { select: { filename: true } } },
  });
  if (!row) return null;
  const record = toTableRecord(row);
  const table = effectiveTableOf(record);
  return table ? { record, table, docName: row.document?.filename } : null;
}

// chunks: retrieved chunks carrying `tableId`. `where` limits which tables
// may be expanded (e.g. { documentId } or { document: { projectId } }).
export async function buildTableContext(prisma, chunks, { pinnedTableIds = [], where = {} } = {}) {
  const pinned = pinnedTableIds.filter(Boolean).map(String);
  const ids = [...new Set([
    ...pinned,
    ...chunks.map((c) => c.tableId).filter(Boolean),
  ])].slice(0, config.MAX_TABLES_IN_CONTEXT);
  const tables = [];
  const blocks = [];
  for (const id of ids) {
    const src = await loadTableSource(prisma, id, where);
    if (!src) continue;
    let block = toContextBlock(src.table, tableMeta(src.record, src.docName));
    if (pinned.includes(id)) block += "\n" + tableStatsText(computeTableStats(src.table), src.record.title);
    blocks.push(block);
    tables.push(src);
  }
  const text = blocks.length
    ? `TABLES (exact extracted data — prefer these numbers over any other text; cite the table title when you use it):\n${blocks.join("\n\n")}\n\n---\n\n`
    : "";
  return { text, tables, expandedIds: new Set(tables.map((t) => t.record.id)) };
}

function cite(t) {
  return { tableId: t.record.id, documentId: t.record.document_id, title: t.record.title, page: t.record.page_start, documentName: t.docName };
}

// Tables actually referred to in an answer (by title, "Table N" or page);
// falls back to every expanded table when the answer names none.
export function pickTableCitations(answer, tables) {
  if (!tables.length) return [];
  const a = String(answer || "").toLowerCase();
  const named = tables.filter((t) =>
    (t.record.title && a.includes(t.record.title.toLowerCase())) ||
    a.includes(`table ${t.record.table_index + 1}`) ||
    (t.record.page_start && new RegExp(`\\bp(age|\\.)?\\s*${t.record.page_start}\\b`).test(a)));
  return (named.length ? named : tables).map(cite);
}

// Every source, as when a derived table was built from them.
export function allTableCitations(tables) {
  return tables.map(cite);
}

export function tableChartExtraData(tables) {
  if (!tables.length) return null;
  return tables.map((t) => toChartData(t.table, { title: t.record.title })).join("\n\n").slice(0, 12000);
}

// Adds find_tables/compare_tables results to the citation sources.
export async function addToolCitations(prisma, sources, toolCitations, where = {}) {
  let out = sources;
  for (const c of toolCitations || []) {
    if (out.some((t) => t.record.id === c.tableId)) continue;
    const src = await loadTableSource(prisma, c.tableId, where);
    if (src) out = [...out, src];
  }
  return out;
}
