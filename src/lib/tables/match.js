// src/lib/tables/match.js
// Finds the tables a request is about (FR-29): embedding similarity against
// each table's stored signature embedding (read from JSON, so it works even
// where sqlite-vec doesn't), keyword overlap, and a small bonus for periods
// the query names. Receives `prisma` as an argument, like compareQueryTool.js.

import { toTableRecord } from "./rows.js";

const STOP = new Set([
  "the", "a", "an", "of", "in", "on", "for", "and", "or", "to", "vs", "versus", "between", "across", "compare", "comparison",
  "show", "me", "what", "which", "table", "tables", "these", "those", "two", "both", "document", "documents", "report", "reports",
  "annual", "please", "from", "with", "is", "are", "how", "did", "does", "change", "changed", "give", "list", "all", "this", "that",
]);

function stem(t) {
  return t.length > 4 ? t.replace(/(ies)$/, "y").replace(/(es|s)$/, "") : t;
}

function queryTokens(query, excludeTokens = new Set()) {
  return String(query || "").toLowerCase().split(/[^a-z0-9&]+/)
    .filter((t) => t && t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t) && !excludeTokens.has(t))
    .map(stem);
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function keywordOverlap(tokens, signature) {
  if (!tokens.length) return 0;
  const sig = new Set(String(signature || "").toLowerCase().split(/[^a-z0-9&]+/).filter(Boolean).map(stem));
  return tokens.filter((t) => sig.has(t)).length / tokens.length;
}

async function embed(openai, text) {
  if (!openai) return null;
  try {
    const res = await openai.embeddings.create({ model: "text-embedding-3-small", input: String(text).slice(0, 8000) });
    return res?.data?.[0]?.embedding || null;
  } catch (err) {
    console.warn("⚠️  [tables] Query embedding failed; keyword matching only:", err.message || err);
    return null;
  }
}

// Returns { byDocument: Map(docId → [{ table, score }]), ambiguous: [{ documentId, titles }] }
async function findTables({ prisma, openai, query, documentIds, topPerDoc = 3, excludeTokens = [] }) {
  if (!documentIds?.length) return { byDocument: new Map(), ambiguous: [] };
  const tables = (await prisma.documentTable.findMany({
    where: { status: "ready", documentId: { in: documentIds } },
    select: {
      id: true, documentId: true, tableIndex: true, title: true, description: true, signature: true, signatureEmbedding: true,
      pageStart: true, pageEnd: true, sheetName: true, rowCount: true, colCount: true, sourceType: true, status: true,
    },
    orderBy: [{ documentId: "asc" }, { tableIndex: "asc" }],
  })).map(toTableRecord);

  const exclude = new Set(excludeTokens.map((t) => String(t).toLowerCase()));
  const tokens = queryTokens(query, exclude);
  const years = String(query || "").match(/\b(19|20)\d{2}\b/g) || [];
  const qEmb = tables.some((t) => t.signature_embedding) ? await embed(openai, query) : null;

  const byDocument = new Map();
  for (const t of tables) {
    let emb = null;
    try { emb = typeof t.signature_embedding === "string" ? JSON.parse(t.signature_embedding) : t.signature_embedding; } catch (_) {}
    const kw = keywordOverlap(tokens, `${t.title || ""} ${t.signature || ""}`);
    const titleKw = keywordOverlap(tokens, t.title || "");
    const pb = years.length && years.some((y) => String(t.signature || "").includes(y)) ? 1 : 0;
    const cos = qEmb && emb ? cosine(qEmb, emb) : null;
    const score = cos != null ? 0.6 * cos + 0.3 * Math.max(kw, titleKw) + 0.1 * pb : 0.85 * Math.max(kw, titleKw) + 0.15 * pb;
    if (!byDocument.has(t.document_id)) byDocument.set(t.document_id, []);
    byDocument.get(t.document_id).push({ table: t, score, kw: Math.max(kw, titleKw) });
  }
  const ambiguous = [];
  for (const [docId, list] of byDocument) {
    list.sort((a, b) => b.score - a.score);
    byDocument.set(docId, list.slice(0, topPerDoc));
    const [best, second] = list;
    if (best && second && best.score - second.score < 0.05 && (best.table.title || "") !== (second.table.title || "") && best.kw <= second.kw) {
      ambiguous.push({ documentId: docId, titles: [best.table.title, second.table.title] });
    }
  }
  return { byDocument, ambiguous, usedEmbeddings: !!qEmb };
}

export { findTables, queryTokens, cosine, keywordOverlap, embed };
