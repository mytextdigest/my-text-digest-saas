// src/lib/tables/pairing.js
// Pairs the tables of two documents for AI Document Comparison (FR-32) and
// summarises each pair: rows added/removed and the largest value changes.
// Deterministic (no LLM) so a comparison's table section is exact and cheap.
import { effectiveTableOf } from "./schema.js";
import { cosine } from "./match.js";
import { jaccard, normLabel } from "./align.js";
import { deriveComparison } from "./derive.js";
import { toTableRecord } from "./rows.js";

const PAIR_THRESHOLD = 0.8;
const TOP_CHANGES = 5;

async function loadTables(prisma, documentId) {
  const rows = await prisma.documentTable.findMany({ where: { documentId, status: "ready" }, orderBy: { tableIndex: "asc" } });
  return rows.map(toTableRecord).map((t) => {
    let emb = null;
    try { emb = typeof t.signature_embedding === "string" ? JSON.parse(t.signature_embedding) : t.signature_embedding; } catch (_) {}
    return { record: t, emb, table: effectiveTableOf(t) };
  });
}

async function loadDocument(prisma, id) {
  const d = await prisma.document.findUnique({ where: { id }, select: { id: true, filename: true, createdAt: true } });
  return d && { id: d.id, filename: d.filename, created_at: d.createdAt };
}

function similarity(a, b) {
  if (a.emb && b.emb) return cosine(a.emb, b.emb);
  // Without embeddings fall back to title + header words.
  const words = (x) => normLabel(`${x.record.title || ""} ${(x.table.columns || []).map((c) => c.label).join(" ")}`);
  return jaccard(words(a), words(b));
}

async function pairTablesForComparison({ prisma, documentAId, documentBId }) {
  const A = await loadTables(prisma, documentAId);
  const B = await loadTables(prisma, documentBId);
  if (!A.length || !B.length) return [];
  const docA = await loadDocument(prisma, documentAId);
  const docB = await loadDocument(prisma, documentBId);

  // Greedy best-first matching on similarity.
  const cands = [];
  A.forEach((a, i) => B.forEach((b, j) => {
    const s = similarity(a, b);
    if (s >= (a.emb && b.emb ? PAIR_THRESHOLD : 0.5)) cands.push({ i, j, s });
  }));
  cands.sort((p, q) => q.s - p.s);
  const usedA = new Set(), usedB = new Set();
  const pairs = [];
  for (const c of cands) {
    if (usedA.has(c.i) || usedB.has(c.j)) continue;
    usedA.add(c.i); usedB.add(c.j);
    pairs.push(c);
  }

  const out = [];
  for (const p of pairs.sort((x, y) => A[x.i].record.table_index - A[y.i].record.table_index)) {
    const a = A[p.i], b = B[p.j];
    const src = (doc, x) => ({
      documentId: doc.id, documentName: doc.filename, createdAt: doc.created_at,
      tableId: x.record.id, tableTitle: x.record.title, pageStart: x.record.page_start, table: x.table,
    });
    let derived = null;
    try {
      derived = await deriveComparison([src(docA, a), src(docB, b)], {}, { useLLM: false });
    } catch (_) {
      derived = null;
    }
    const summary = { onlyInA: [], onlyInB: [], topChanges: [] };
    if (derived) {
      for (const w of derived.warnings) {
        if (w.type === "unmatched_rows") {
          const list = w.message.replace(/^Only in [^:]+:\s*/, "").replace(/\.$/, "").split(/,\s*/);
          if (w.message.includes(docA.filename)) summary.onlyInA.push(...list);
          else summary.onlyInB.push(...list);
        }
      }
      const pctIdx = derived.table.columns.findIndex((c) => c.label === "Change %");
      if (pctIdx > 0) {
        summary.topChanges = derived.table.rows
          .filter((r) => r.kind === "data" && typeof r.cells[pctIdx].v === "number")
          .sort((x, y) => Math.abs(y.cells[pctIdx].v) - Math.abs(x.cells[pctIdx].v))
          .slice(0, TOP_CHANGES)
          .map((r) => ({
            label: r.cells[0].raw,
            from: r.cells[1]?.raw,
            to: r.cells[pctIdx - 2]?.raw,
            change: r.cells[pctIdx - 1]?.raw,
            changePct: r.cells[pctIdx].raw,
          }));
      }
    }
    out.push({
      tableA: { id: a.record.id, title: a.record.title, page: a.record.page_start, documentId: documentAId },
      tableB: { id: b.record.id, title: b.record.title, page: b.record.page_start, documentId: documentBId },
      similarity: Math.round(p.s * 100) / 100,
      derived: derived ? { title: derived.title, table: derived.table, warnings: derived.warnings } : null,
      summary,
    });
  }
  const unpairedA = A.filter((_, i) => !usedA.has(i)).map((x) => ({ id: x.record.id, title: x.record.title }));
  const unpairedB = B.filter((_, j) => !usedB.has(j)).map((x) => ({ id: x.record.id, title: x.record.title }));
  return { pairs: out, unpairedA, unpairedB };
}

export { pairTablesForComparison };
