// src/lib/tables/align.js
// Row and column alignment between tables from different documents
// (FR-29–31). Deterministic passes first; an optional LLM pass only maps
// leftover labels to each other and is validated (each label used once,
// every label must exist). Pure apart from the injected openai client.
import { MODEL_QA } from "./config.js";
import { parsePeriod, periodSortKey } from "./clean.js";

const ABBREVIATIONS = {
  n: "north", s: "south", e: "east", w: "west", "n.": "north", "s.": "south",
  intl: "international", int: "international", "int'l": "international",
  ops: "operations", mgmt: "management", dev: "development", admin: "administrative",
  govt: "government", corp: "corporate", dept: "department", svcs: "services", svc: "service",
  apac: "asia pacific", latam: "latin america", amer: "americas", eur: "europe",
  mfg: "manufacturing", mktg: "marketing", r: "research", d: "development",
  "&": "and", "+": "and", us: "united states", usa: "united states", uk: "united kingdom",
  exp: "expenses", expense: "expenses", rev: "revenue", revenues: "revenue",
};
const TRAILING_NOISE = new Set(["region", "regions", "segment", "segments", "division", "total"]);

function normLabel(label) {
  let s = String(label || "").toLowerCase();
  s = s.replace(/\(([a-z]|\d{1,2})\)\s*$/, "").replace(/[*†‡§¹²³⁴⁵⁶⁷⁸⁹⁰]+/g, "");
  s = s.replace(/&/g, " & ").replace(/[^a-z0-9&+.'\s]/g, " ");
  const words = s.split(/\s+/).filter(Boolean).map((w) => w.replace(/\.$/, (m) => (ABBREVIATIONS[w] ? m : "")));
  const expanded = words.flatMap((w) => (ABBREVIATIONS[w] || w.replace(/\./g, "")).split(" ")).filter(Boolean);
  while (expanded.length > 1 && TRAILING_NOISE.has(expanded[expanded.length - 1])) expanded.pop();
  return expanded.join(" ").trim();
}

function jaccard(a, b) {
  const x = new Set(a.split(" ").filter(Boolean));
  const y = new Set(b.split(" ").filter(Boolean));
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter);
}

// rowsA/rowsB: [{ id, label, kind }]. Returns { pairs: [{ a, b, method }],
// unmatchedA, unmatchedB } where a/b are row objects.
function alignRowsDeterministic(rowsA, rowsB) {
  const usedB = new Set();
  const pairs = [];
  const normA = rowsA.map((r) => normLabel(r.label));
  const normB = rowsB.map((r) => normLabel(r.label));
  const matchedA = new Set();

  // Total rows pair with total rows regardless of wording.
  const totA = rowsA.findIndex((r) => r.kind === "total");
  const totB = rowsB.findIndex((r) => r.kind === "total");
  if (totA >= 0 && totB >= 0) { pairs.push({ a: rowsA[totA], b: rowsB[totB], method: "total" }); matchedA.add(totA); usedB.add(totB); }

  // Pass 1: exact normalised label.
  rowsA.forEach((r, i) => {
    if (matchedA.has(i) || !normA[i]) return;
    const j = normB.findIndex((n, k) => !usedB.has(k) && n === normA[i]);
    if (j >= 0) { pairs.push({ a: r, b: rowsB[j], method: "exact" }); matchedA.add(i); usedB.add(j); }
  });
  // Pass 2: token Jaccard ≥ 0.8, best-first.
  const cands = [];
  rowsA.forEach((_, i) => {
    if (matchedA.has(i)) return;
    rowsB.forEach((__, j) => {
      if (usedB.has(j)) return;
      const s = jaccard(normA[i], normB[j]);
      if (s >= 0.8) cands.push({ i, j, s });
    });
  });
  cands.sort((p, q) => q.s - p.s);
  for (const c of cands) {
    if (matchedA.has(c.i) || usedB.has(c.j)) continue;
    pairs.push({ a: rowsA[c.i], b: rowsB[c.j], method: "fuzzy" });
    matchedA.add(c.i); usedB.add(c.j);
  }
  return {
    pairs,
    unmatchedA: rowsA.filter((_, i) => !matchedA.has(i)),
    unmatchedB: rowsB.filter((_, j) => !usedB.has(j)),
  };
}

// Optional LLM pass over the leftovers. Only returns pairs whose labels
// exist and are each used once.
async function llmMapLabels(openai, leftA, leftB) {
  if (!openai || !leftA.length || !leftB.length || leftA.length > 60 || leftB.length > 60) return [];
  try {
    const resp = await openai.chat.completions.create({
      model: MODEL_QA,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Two tables from different documents list rows with slightly different labels. Map each label in list A to the label in list B that means " +
            "the same thing, or null if none does. Only map true equivalents (e.g. \"N. America\" ↔ \"North America\"); never map different items. " +
            "Respond with JSON: {\"pairs\":[[\"A label\",\"B label or null\"], ...]}.",
        },
        { role: "user", content: JSON.stringify({ A: leftA.map((r) => r.label), B: leftB.map((r) => r.label) }) },
      ],
    });
    const parsed = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
    const out = [];
    const usedA = new Set(), usedB = new Set();
    for (const p of parsed.pairs || []) {
      if (!Array.isArray(p) || p[1] == null) continue;
      const a = leftA.find((r) => r.label === p[0] && !usedA.has(r.id));
      const b = leftB.find((r) => r.label === p[1] && !usedB.has(r.id));
      if (!a || !b) continue;
      usedA.add(a.id); usedB.add(b.id);
      out.push({ a, b, method: "llm" });
    }
    return out;
  } catch (err) {
    console.warn("⚠️  [tables] LLM label mapping failed:", err.message || err);
    return [];
  }
}

async function alignRows(rowsA, rowsB, { openai = null, useLLM = true } = {}) {
  const det = alignRowsDeterministic(rowsA, rowsB);
  if (useLLM && openai && det.unmatchedA.length && det.unmatchedB.length) {
    const extra = await llmMapLabels(openai, det.unmatchedA, det.unmatchedB);
    for (const p of extra) {
      det.pairs.push(p);
      det.unmatchedA = det.unmatchedA.filter((r) => r.id !== p.a.id);
      det.unmatchedB = det.unmatchedB.filter((r) => r.id !== p.b.id);
    }
  }
  return det;
}

// The label column and row descriptors of a canonical table.
function rowDescriptors(table) {
  const labelCol = Math.max(0, (table.columns || []).findIndex((c) => c.type === "text"));
  return {
    labelCol,
    rows: (table.rows || [])
      .filter((r) => r.kind !== "section")
      .map((r) => ({ id: r.id, label: String(r.cells[labelCol]?.raw || "").trim(), kind: r.kind || "data", row: r }))
      .filter((r) => r.label),
  };
}

// Numeric columns that carry a period, latest first.
function periodColumns(table) {
  return (table.columns || [])
    .map((c, j) => ({ col: c, j, period: c.period || parsePeriod(c.label) }))
    .filter((x) => x.col.type !== "text" && x.period)
    .sort((a, b) => periodSortKey(b.period) - periodSortKey(a.period));
}

export { normLabel, jaccard, alignRows, alignRowsDeterministic, llmMapLabels, rowDescriptors, periodColumns };
