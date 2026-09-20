// src/lib/compareAlignment.js
// Deterministic section-alignment layer for Document Comparison. Pure
// functions only — no I/O, no LLM — operates purely on whatever Chunk rows
// ingestion already produced (this repo's chunkText()), not on any
// chunking/embedding of its own.
//
// Ported near-verbatim from the desktop app's electron/compare/alignment.js.

// Deliberately higher than topic clustering's own strong-match threshold and
// close to entity resolution's (0.86) — a false "same section" match is
// worse here than missing one (a missed match just falls through to
// onlyInA/onlyInB, still surfaced as added/removed rather than silently
// merged). Do not lower this to catch more matches.
export const THRESHOLDS = {
  STRONG_MATCH: 0.82,
};

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// For every item in `source`, finds its single highest-similarity item in
// `target`. Returns a Map(source.id -> { id, score } | null).
export function bestMatches(source, target) {
  const map = new Map();
  for (const s of source) {
    let bestId = null;
    let bestScore = -Infinity;
    if (Array.isArray(s.embedding)) {
      for (const t of target) {
        if (!Array.isArray(t.embedding)) continue;
        const score = cosineSimilarity(s.embedding, t.embedding);
        if (score > bestScore) {
          bestScore = score;
          bestId = t.id;
        }
      }
    }
    map.set(s.id, bestId !== null ? { id: bestId, score: bestScore } : null);
  }
  return map;
}

// Mutual-best-match alignment: chunk a and chunk b are matched only if each
// is the other's single best match, above STRONG_MATCH. Everything else
// falls into onlyInA (candidate 'removed') or onlyInB (candidate 'added').
export function alignChunks(chunksA, chunksB, { strongMatch = THRESHOLDS.STRONG_MATCH } = {}) {
  const bestForA = bestMatches(chunksA, chunksB);
  const bestForB = bestMatches(chunksB, chunksA);

  const matchedPairs = [];
  const matchedAIds = new Set();
  const matchedBIds = new Set();

  for (const a of chunksA) {
    const aBest = bestForA.get(a.id);
    if (!aBest || aBest.score < strongMatch) continue;
    const bBest = bestForB.get(aBest.id);
    if (bBest && bBest.id === a.id) {
      matchedPairs.push({ aId: a.id, bId: aBest.id, similarity: aBest.score });
      matchedAIds.add(a.id);
      matchedBIds.add(aBest.id);
    }
  }

  const onlyInA = chunksA.filter((c) => !matchedAIds.has(c.id)).map((c) => c.id);
  const onlyInB = chunksB.filter((c) => !matchedBIds.has(c.id)).map((c) => c.id);

  return { matchedPairs, onlyInA, onlyInB };
}

// Cap/prioritization: onlyInA/onlyInB are a required pass (they're
// structurally certain to be removed/added, not a judgment call), then the
// lowest-similarity matched pairs fill the remaining budget — those are the
// ones most likely to actually differ. Matched pairs that don't fit the cap
// are returned as `autoSame`: recorded from the alignment alone, no LLM call.
export function selectForClassification({ matchedPairs, onlyInA, onlyInB, cap }) {
  const required = [
    ...onlyInA.map((aId) => ({ type: "onlyInA", aId })),
    ...onlyInB.map((bId) => ({ type: "onlyInB", bId })),
  ];
  const sortedMatched = [...matchedPairs].sort((x, y) => x.similarity - y.similarity);
  const remaining = Math.max(0, cap - required.length);
  const toClassify = [
    ...required,
    ...sortedMatched.slice(0, remaining).map((p) => ({ type: "matched", ...p })),
  ];
  const autoSame = sortedMatched.slice(remaining);
  return { toClassify, autoSame };
}

// The model is only ever asked to classify a `matched` unit as same/changed
// — it is never trusted (and never even asked) to decide whether an
// onlyInA/onlyInB unit is "removed"/"added"; that's certain from the
// alignment step alone and enforced here, not by the model's response. This
// is the single most important invariant in the whole feature — preserve
// this gate exactly.
export function enforceCategory(unitType, modelCategory) {
  if (unitType === "onlyInA") return "removed";
  if (unitType === "onlyInB") return "added";
  return modelCategory === "changed" ? "changed" : "same";
}
