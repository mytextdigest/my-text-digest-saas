// src/lib/tables/queryTool.js
// Chat tools (FR-29–31): find_tables lists/shows extracted tables;
// compare_tables builds a derived cross-document table whose numbers are all
// computed in code (derive.js). The narrative model call answers only from
// `resultText`. Receives `prisma`/`openai` as arguments.
import { resolveDocumentName, normalizeFilename } from "../resolveDocumentName.js";
import { findTables } from "./match.js";
import { deriveComparison, derivedToText } from "./derive.js";
import { effectiveTableOf } from "./schema.js";
import { toContextBlock } from "./serialize.js";
import { toTableRecord } from "./rows.js";

const FIND_TABLES_TOOL = {
  type: "function",
  function: {
    name: "find_tables",
    description:
      "List or show tables extracted from documents — e.g. 'what tables are in this report', 'show the operating expenses table', 'which document has a headcount table'. Returns table titles, pages and the exact contents of the best match.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What the table is about, or 'all' to list every table" },
        documents: { type: "array", items: { type: "string" }, description: "Optional filenames (or close matches) to limit the search" },
      },
      required: ["query"],
    },
  },
};

const COMPARE_TABLES_TOOL = {
  type: "function",
  function: {
    name: "compare_tables",
    description:
      "Build a comparison table from tables in two or more documents — e.g. 'compare revenue by region between the 2024 and 2025 annual reports'. Values and changes are computed exactly; use this instead of reading numbers from text whenever the user wants numbers side by side across documents.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to compare, e.g. 'revenue by region'" },
        documents: { type: "array", items: { type: "string" }, minItems: 2, description: "Two or more filenames (or close matches)" },
        periods: { type: "array", items: { type: "string" }, description: "Optional periods to include, e.g. ['2024','2025']" },
        row_filter: { type: "array", items: { type: "string" }, description: "Optional row labels to keep, e.g. ['Europe']" },
      },
      required: ["query", "documents"],
    },
  },
};

function resolveAll(names, documents) {
  const resolved = [];
  for (const name of names || []) {
    const matches = resolveDocumentName(name, documents);
    if (!matches.length) return { error: `I couldn't find a document matching "${name}".` };
    if (matches.length > 1) {
      // Several names may legitimately resolve into the same group ("the two
      // annual reports"); only complain when this name alone is ambiguous
      // and the other names didn't already pick one of them.
      return { error: `More than one document matches "${name}" (${matches.map((d) => d.filename).join(", ")}) — ask the user which one they meant.` };
    }
    if (!resolved.some((d) => d.id === matches[0].id)) resolved.push(matches[0]);
  }
  return { documents: resolved };
}

function pageText(t) {
  if (t.sheet_name) return `sheet "${t.sheet_name}"`;
  if (t.page_start == null) return null;
  return t.page_end && t.page_end !== t.page_start ? `pp. ${t.page_start}–${t.page_end}` : `p. ${t.page_start}`;
}

async function extractionStatus(prisma, docIds) {
  const logs = await prisma.tableExtractionLog.findMany({
    where: { documentId: { in: docIds } },
    select: { documentId: true, status: true, tablesFound: true },
  });
  return logs.map((l) => ({ document_id: l.documentId, status: l.status, tables_found: l.tablesFound }));
}

async function loadTable(prisma, id) {
  return toTableRecord(await prisma.documentTable.findUnique({ where: { id } }));
}

// scope: { projectId } or { documentId }
async function runFindTablesTool({ prisma, openai, scope, query, documents: names }) {
  const docs = await prisma.document.findMany({
    where: scope.projectId ? { projectId: scope.projectId } : { id: scope.documentId },
    select: { id: true, filename: true },
  });
  let inScope = docs;
  if (names?.length) {
    const r = resolveAll(names, docs);
    if (r.error) return { error: r.error };
    inScope = r.documents;
  }
  const ids = inScope.map((d) => d.id);
  if (!ids.length) return { error: "There are no documents to search." };
  const nameOf = new Map(inScope.map((d) => [d.id, d.filename]));

  const listAll = /^(all|any|every|list|\*)?$/i.test(String(query || "").trim()) || /\b(what|which|list|all)\b.*\btables?\b/i.test(query || "");
  if (listAll) {
    const rows = (await prisma.documentTable.findMany({
      where: { status: "ready", documentId: { in: ids } },
      select: { id: true, documentId: true, tableIndex: true, title: true, pageStart: true, pageEnd: true, sheetName: true, rowCount: true, colCount: true },
      orderBy: [{ documentId: "asc" }, { tableIndex: "asc" }],
    })).map(toTableRecord);
    if (!rows.length) {
      const pending = (await extractionStatus(prisma, ids)).filter((s) => s.status === "running");
      return { resultText: pending.length ? "Tables are still being extracted — try again in a moment." : "No tables were found in these documents.", tableIds: [] };
    }
    const lines = [];
    for (const id of ids) {
      const ts = rows.filter((r) => r.document_id === id);
      if (!ts.length) continue;
      lines.push(`${nameOf.get(id)} — ${ts.length} table${ts.length === 1 ? "" : "s"}:`);
      for (const t of ts) lines.push(`  Table ${t.table_index + 1}: ${t.title || "Untitled"}${pageText(t) ? ` (${pageText(t)})` : ""}, ${t.row_count}×${t.col_count}`);
    }
    return { resultText: lines.join("\n"), tableIds: [] };
  }

  const { byDocument } = await findTables({ prisma, openai, query, documentIds: ids, topPerDoc: 3 });
  const all = [...byDocument.values()].flat().sort((a, b) => b.score - a.score);
  if (!all.length) return { resultText: "No extracted tables match that request.", tableIds: [] };
  const best = all.slice(0, 2).filter((c, i) => i === 0 || c.score >= all[0].score - 0.1);
  const blocks = [];
  const citations = [];
  for (const c of best) {
    const full = await loadTable(prisma, c.table.id);
    const eff = effectiveTableOf(full);
    blocks.push(toContextBlock(eff, {
      docName: nameOf.get(full.document_id), tableIndex: full.table_index, title: full.title,
      pageStart: full.page_start, pageEnd: full.page_end, sheetName: full.sheet_name,
    }));
    citations.push({ tableId: full.id, documentId: full.document_id, title: full.title, page: full.page_start });
  }
  const others = all.slice(best.length, 6).map((c) => `- ${c.table.title} (${nameOf.get(c.table.document_id)}${pageText(c.table) ? `, ${pageText(c.table)}` : ""})`);
  return {
    resultText: `Best matching table${best.length > 1 ? "s" : ""} (exact extracted data):\n\n${blocks.join("\n\n")}${others.length ? `\n\nOther candidates:\n${others.join("\n")}` : ""}`,
    tableIds: citations.map((c) => c.tableId),
    tableCitations: citations,
  };
}

// userId scopes the no-project case (document chat) to the user's own
// documents; the desktop app is single-user and reads every document.
async function runCompareTablesTool({ prisma, openai, projectId, documentId = null, userId, query, documents: names, periods, rowFilter }) {
  const docs = (await prisma.document.findMany({
    where: projectId ? { projectId } : { userId },
    select: { id: true, filename: true, createdAt: true },
  })).map((d) => ({ id: d.id, filename: d.filename, created_at: d.createdAt }));
  if (!Array.isArray(names) || names.length < 2) return { error: "Name at least two documents to compare." };
  const r = resolveAll(names, docs);
  if (r.error) return { error: r.error };
  const chosen = r.documents;
  if (chosen.length < 2) return { error: "Those names resolve to the same document — I need two different documents to compare." };

  const status = await extractionStatus(prisma, chosen.map((d) => d.id));
  for (const d of chosen) {
    const s = status.find((x) => x.document_id === d.id);
    if (!s) return { error: `Tables haven't been extracted from "${d.filename}" yet — open it and use Extract tables on its Tables tab.` };
    if (s.status === "running") return { error: `Tables in "${d.filename}" are still being extracted — try again in a moment.` };
  }

  // Filename words ("annual", "report", "2024") shouldn't count as table keywords.
  const nameTokens = chosen.flatMap((d) => normalizeFilename(d.filename).split(" "));
  const { byDocument, ambiguous } = await findTables({ prisma, openai, query, documentIds: chosen.map((d) => d.id), topPerDoc: 3, excludeTokens: nameTokens });
  if (ambiguous.length) {
    const a = ambiguous[0];
    const doc = chosen.find((d) => d.id === a.documentId);
    return { error: `In "${doc.filename}" both "${a.titles[0]}" and "${a.titles[1]}" could match — ask the user which table they mean.` };
  }
  const sources = [];
  for (const d of chosen) {
    const best = (byDocument.get(d.id) || [])[0];
    if (!best || best.score < 0.2) return { error: `I couldn't find a table about "${query}" in "${d.filename}".` };
    const full = await loadTable(prisma, best.table.id);
    sources.push({
      documentId: d.id,
      documentName: d.filename,
      createdAt: d.created_at,
      tableId: full.id,
      tableTitle: full.title,
      pageStart: full.page_start,
      table: effectiveTableOf(full),
    });
  }

  let result;
  try {
    result = await deriveComparison(sources, { periods, rowFilter }, { openai, useLLM: !!openai });
  } catch (err) {
    return { error: err.message || String(err) };
  }
  const derived = await prisma.derivedTable.create({
    data: {
      projectId: projectId || null,
      documentId: documentId || null,
      kind: "compare",
      title: result.title,
      requestJson: { query, documents: chosen.map((d) => d.filename), periods: periods || null, rowFilter: rowFilter || null },
      tableJson: result.table,
      sourceTableIds: result.sourceTableIds.map(String),
      warningsJson: result.warnings,
    },
  });
  return {
    derivedTableId: derived.id,
    resultText: derivedToText(result),
    tableCitations: sources.map((s) => ({ tableId: s.tableId, documentId: s.documentId, title: s.tableTitle, page: s.pageStart })),
  };
}

export { FIND_TABLES_TOOL, COMPARE_TABLES_TOOL, runFindTablesTool, runCompareTablesTool };
