// src/lib/graph/resolver.js
// Cross-document entity resolution, scoped to one project. Exact
// normalized-name match first, then embedding cosine similarity against
// same-type candidates already in the project — mirrors the two-tier
// pattern validated for topic clustering (worker/cluster.js), but biased
// toward under-merging: there is no "assign to closest" middle zone here,
// only a single high-confidence threshold. Below it, a new entity is created
// rather than guessed into an existing one. Ported from the desktop app's
// electron/graph/resolver.js, swapping better-sqlite3 for Prisma.

export const THRESHOLDS = {
  STRONG_MATCH: 0.86, // cosine >= this -> confidently the same real-world entity
};

export function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .trim()
    .replace(/\s+/g, " ");
}

// Documents routinely refer to their own subject by a generic placeholder
// ("the Company", "the Corporation") after introducing it by proper name
// once — per-chunk extraction has no way to know these refer back to the
// same entity, and neither exact-name nor embedding similarity reliably
// catches it (the text is too different from the proper name + its
// description to clear STRONG_MATCH). Treated as a special case in
// resolveEntitiesBatch below rather than left to the general matcher.
export const GENERIC_ORG_REFERENCES = new Set([
  "the company", "company", "the corporation", "corporation",
  "the firm", "firm", "the organization", "the organisation",
  "the group", "the business", "the enterprise", "the parent company",
  "the issuer", "the registrant",
]);

export function isGenericOrgReference(name) {
  return GENERIC_ORG_REFERENCES.has(normalizeName(name));
}

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

// Loads every existing entity in the project once per document run, so
// resolution doesn't re-query the db per entity. Kept in sync in-place as
// new entities are created during the run (so later chunks in the same
// document see earlier chunks' new entities without a db round-trip).
export async function buildCache(projectId, prisma) {
  const rows = await prisma.entity.findMany({ where: { projectId } });

  const byKey = new Map(); // `${type}::${normalized_name}` -> candidate
  const byType = new Map(); // type -> candidate[]

  for (const r of rows) {
    const embedding = Array.isArray(r.embedding) ? r.embedding : null;
    const candidate = { id: r.id, name: r.name, description: r.description, embedding };
    byKey.set(`${r.type}::${r.normalizedName}`, candidate);
    if (!byType.has(r.type)) byType.set(r.type, []);
    byType.get(r.type).push(candidate);
  }

  return { byKey, byType };
}

export function matchAgainstCache(embedding, type, cache) {
  if (!embedding) return null;
  const candidates = cache.byType.get(type) || [];
  let best = null;
  let bestScore = -1;
  for (const cand of candidates) {
    if (!Array.isArray(cand.embedding)) continue;
    const score = cosineSimilarity(embedding, cand.embedding);
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best && bestScore >= THRESHOLDS.STRONG_MATCH ? { id: best.id, score: bestScore } : null;
}

async function insertNewEntity({ name, normalized, type, description, value, unit, period, embedding, projectId, prisma, cache }) {
  const created = await prisma.entity.create({
    data: {
      projectId,
      name,
      normalizedName: normalized,
      type,
      description: description || null,
      value: value || null,
      unit: unit || null,
      period: period || null,
      embedding: embedding || null,
    },
    select: { id: true },
  });
  const entityId = created.id;

  const newCandidate = { id: entityId, name, description, embedding };
  cache.byKey.set(`${type}::${normalized}`, newCandidate);
  if (!cache.byType.has(type)) cache.byType.set(type, []);
  cache.byType.get(type).push(newCandidate);

  return entityId;
}

// Resolves every distinct entity extracted from one chunk in a single pass.
// Exact-name matches are free (in-memory cache lookup, no API call). Anything
// left over is embedded in ONE batched OpenAI call (input: string[]) instead
// of one call per entity — this is the main cost driver for extraction
// latency, since a chunk can easily contain a dozen+ new entities and each
// round-trip is subject to the OpenAI SDK's own retry/backoff on rate limits.
//
// `primaryOrgId` is the document's current best guess at "the organization
// this document is about" — set by the caller (worker/processGraph.js) from
// an earlier chunk's resolution and threaded through call to call across one
// document's chunks. Generic self-references ("the Company") resolve
// straight to it instead of going through name/embedding matching, which
// can't reliably connect a placeholder phrase to a proper name. Returns
// `{ results, primaryOrgId }`: `results` is a Map keyed by lowercased
// original entity name -> { entityId, confidence, isNew }; `primaryOrgId` is
// the (possibly newly-established) anchor for the caller to pass into the
// next chunk.
export async function resolveEntitiesBatch(drafts, { projectId, prisma, openai, cache, primaryOrgId }) {
  const results = new Map();
  const needsEmbedding = [];
  const genericRefs = [];

  for (const draft of drafts) {
    const normalized = normalizeName(draft.name);
    if (!normalized) continue;

    if (draft.type === "organization" && isGenericOrgReference(draft.name)) {
      // Resolved in the second pass below, once every proper-named
      // organization in this same batch has already been resolved.
      genericRefs.push({ ...draft, normalized });
      continue;
    }

    const exact = cache.byKey.get(`${draft.type}::${normalized}`);
    if (exact) {
      results.set(draft.name.toLowerCase(), { entityId: exact.id, confidence: 1.0, isNew: false });
    } else {
      needsEmbedding.push({ ...draft, normalized });
    }
  }

  if (needsEmbedding.length > 0) {
    let embeddings = needsEmbedding.map(() => null);
    try {
      const inputs = needsEmbedding.map((d) => `${d.name}: ${d.description || ""}`.slice(0, 500));
      const res = await openai.embeddings.create({ model: "text-embedding-3-small", input: inputs });
      embeddings = res.data.map((d) => d.embedding);
    } catch (e) {
      // Degrade to name-only resolution (no embedding-based matching, every
      // unmatched entity becomes a new row) rather than failing the chunk.
    }

    for (let i = 0; i < needsEmbedding.length; i++) {
      const draft = needsEmbedding[i];
      const embedding = embeddings[i] || null;
      const matched = matchAgainstCache(embedding, draft.type, cache);
      if (matched) {
        results.set(draft.name.toLowerCase(), { entityId: matched.id, confidence: matched.score, isNew: false });
        continue;
      }
      const entityId = await insertNewEntity({
        name: draft.name,
        normalized: draft.normalized,
        type: draft.type,
        description: draft.description,
        value: draft.value,
        unit: draft.unit,
        period: draft.period,
        embedding,
        projectId,
        prisma,
        cache,
      });
      results.set(draft.name.toLowerCase(), { entityId, confidence: 1.0, isNew: true });
    }
  }

  let anchorId = primaryOrgId || null;

  if (genericRefs.length > 0) {
    // Prefer a proper-named organization resolved in THIS SAME batch (e.g.
    // "Solstice Robotics, Inc. ('the Company')" introduced in one sentence)
    // over the running document-level anchor carried in from earlier chunks.
    for (const draft of drafts) {
      if (draft.type !== "organization" || isGenericOrgReference(draft.name)) continue;
      const r = results.get(draft.name.toLowerCase());
      if (r) {
        anchorId = r.entityId;
        break;
      }
    }

    for (const ref of genericRefs) {
      if (anchorId) {
        results.set(ref.name.toLowerCase(), { entityId: anchorId, confidence: 0.95, isNew: false });
        continue;
      }
      // No proper-named organization established anywhere in the document
      // yet — fall back to ordinary name/embedding resolution rather than
      // silently dropping it (rare: only happens if a generic reference is
      // the very first organization mention in the document).
      const exact = cache.byKey.get(`organization::${ref.normalized}`);
      if (exact) {
        results.set(ref.name.toLowerCase(), { entityId: exact.id, confidence: 1.0, isNew: false });
        continue;
      }
      const entityId = await insertNewEntity({
        name: ref.name,
        normalized: ref.normalized,
        type: ref.type,
        description: ref.description,
        value: ref.value,
        unit: ref.unit,
        period: ref.period,
        embedding: null,
        projectId,
        prisma,
        cache,
      });
      results.set(ref.name.toLowerCase(), { entityId, confidence: 1.0, isNew: true });
    }
  }

  // Establish the document-level anchor for the caller's next chunk, if one
  // wasn't already known: the first proper-named organization resolved here.
  if (!anchorId) {
    for (const draft of drafts) {
      if (draft.type !== "organization" || isGenericOrgReference(draft.name)) continue;
      const r = results.get(draft.name.toLowerCase());
      if (r) {
        anchorId = r.entityId;
        break;
      }
    }
  }

  return { results, primaryOrgId: anchorId };
}
