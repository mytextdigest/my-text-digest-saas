// src/lib/resolveDocumentName.js (ported from desktop electron/utils)
// Resolves a free-text document reference ("the 2024 annual report") to
// documents by filename. Shared by the compare_documents and compare_tables
// chat tools. Returns every plausible match from the strictest tier that
// matches anything; callers treat 0 or 2+ matches as "ask the user".

export function normalizeFilename(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const STOP = new Set(["the", "a", "an", "of", "doc", "document", "file", "pdf", "docx", "and"]);

function tokens(s) {
  return normalizeFilename(s).split(" ").filter((t) => t && !STOP.has(t));
}

export function resolveDocumentName(query, documents) {
  const q = normalizeFilename(query);
  if (!q) return [];
  const exact = documents.filter((d) => normalizeFilename(d.filename) === q);
  if (exact.length) return exact;
  const contains = documents.filter((d) => {
    const norm = normalizeFilename(d.filename);
    return norm.includes(q) || q.includes(norm);
  });
  if (contains.length) return contains;
  // Word-order-insensitive: every query word appears in the filename.
  const qt = tokens(query);
  if (!qt.length) return [];
  const subset = documents.filter((d) => {
    const dt = new Set(tokens(d.filename));
    return qt.every((t) => dt.has(t));
  });
  if (subset.length) return subset;
  // Loosest: all numbers (years) in the query match and at least half the words.
  const nums = qt.filter((t) => /\d/.test(t));
  return documents.filter((d) => {
    const dt = new Set(tokens(d.filename));
    const hits = qt.filter((t) => dt.has(t)).length;
    return nums.every((n) => dt.has(n)) && hits >= Math.ceil(qt.length / 2) && hits > 0 && (nums.length > 0 || hits >= 2);
  });
}
