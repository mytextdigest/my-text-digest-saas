// src/lib/graph/narrativeInsights.js
// Generates a small set of human-readable "insight cards" from a document's
// (or a whole project's) already-extracted knowledge graph — distinct from
// insights.js, which synthesizes individual graph EDGES (one comparative or
// causal connection between two entities). This is a level up: each card
// names a handful of supporting entities/relationships and concrete
// evidence, matching the "Insight -> supporting graph connections -> source
// evidence" shape the Insights panel needs. Reuses the exact same
// entities/relationships tables — no new extraction, nothing rebuilt.
//
// Grounding is enforced the same way as everywhere else in this pipeline:
// the model can only cite entity names and relationship triples that are
// literally in the data it was given, and every citation is validated
// against that same data before being stored — nothing the model says is
// trusted at face value.
//
// Ported from the desktop app's electron/graph/narrativeInsights.js,
// swapping better-sqlite3 for Prisma. Note: unlike the desktop's SQLite
// chunks table, this codebase's Chunk model doesn't track a page number for
// ordinary text chunks (only Figure rows do) — evidence quotes here always
// carry `pageNumber: null`, which the UI already renders conditionally.

const MAX_ENTITIES = 150;
const MAX_RELATIONSHIPS = 200;
const MIN_ENTITIES_TO_BOTHER = 4;
const MAX_INSIGHTS = 7;
const MAX_EVIDENCE_PER_INSIGHT = 6;
export const CATEGORIES = ["Growth", "Financial", "Operations", "Risk", "Market", "Strategic", "Other"];

const INSIGHTS_PROMPT = `You are analyzing the entities, metrics, and relationships already extracted from a document (or a set of documents), taken as a whole. Produce between 3 and 7 high-value insights a reader would actually want to know — not a restatement of individual facts, but the handful of things that matter most: standout growth or decline, notable financial results, operational drivers, risks, or strategic moves.

Rules:
- Every insight must be grounded ONLY in the given entities and relationships. Do not invent facts, numbers, or claims not present below.
- "supporting_entities" and "supporting_relationships" are how a reader traces the insight back to the graph — list every entity name and every relationship (source/relation/target triple) that back up this insight. Every name and every triple must exactly match one given below. An insight with no real support in the data should not be produced.
- "category" must be exactly one of: ${CATEGORIES.join(", ")}.
- "title" is a short, specific headline (under 12 words), not a generic label. "explanation" is 1-2 plain-language sentences grounded in the given data.
- Prefer fewer, well-supported insights over padding to reach 7 — if the material only clearly supports 1 or 2, return that many.

Return strict JSON, nothing else:
{"insights": [{
  "title": string,
  "explanation": string,
  "category": string,
  "supporting_entities": [string],
  "supporting_relationships": [{"source": string, "relation": string, "target": string}]
}]}`;

function formatEntitiesForPrompt(entities) {
  return entities
    .map((e) => {
      const value = e.value ? ` = ${e.value}${e.unit || ""}${e.period ? ` (${e.period})` : ""}` : "";
      const desc = e.description ? ` — ${e.description}` : "";
      return `- [${e.type}] ${e.name}${value}${desc}`;
    })
    .join("\n");
}

function formatRelationshipsForPrompt(relationships) {
  return relationships
    .map((r) => {
      const tag = r.isInferred ? ` [inferred ${r.insightType || "insight"}]` : "";
      return `- ${r.sourceName} ${r.relation} ${r.targetName}${tag}${r.description ? ` (${r.description})` : ""}`;
    })
    .join("\n");
}

async function loadDocumentGraph(prisma, documentId) {
  const entities = await prisma.entity.findMany({
    where: { entityDocuments: { some: { documentId } } },
    select: { id: true, name: true, type: true, description: true, value: true, unit: true, period: true },
  });

  const rels = await prisma.relationship.findMany({
    where: { documentId },
    include: { sourceEntity: { select: { name: true } }, targetEntity: { select: { name: true } } },
  });

  const relationships = rels.map((r) => ({
    id: r.id,
    relation: r.relation,
    description: r.description,
    isInferred: r.isInferred,
    insightType: r.insightType,
    sourceName: r.sourceEntity.name,
    targetName: r.targetEntity.name,
  }));

  return { entities, relationships };
}

async function loadProjectGraph(prisma, projectId) {
  const entities = await prisma.entity.findMany({
    where: { projectId },
    select: { id: true, name: true, type: true, description: true, value: true, unit: true, period: true },
  });

  const rels = await prisma.relationship.findMany({
    where: { projectId },
    include: { sourceEntity: { select: { name: true } }, targetEntity: { select: { name: true } } },
  });

  const relationships = rels.map((r) => ({
    id: r.id,
    relation: r.relation,
    description: r.description,
    isInferred: r.isInferred,
    insightType: r.insightType,
    sourceName: r.sourceEntity.name,
    targetName: r.targetEntity.name,
  }));

  return { entities, relationships };
}

// Concrete provenance for a card: real document/page/quote pulled from the
// same tables the Entity panel already uses (EntityMention, Relationship's
// own document link) — never asked of the LLM, so evidence can't be
// hallucinated even if a citation elsewhere were wrong.
async function buildEvidence(prisma, entityIds, relationshipIds) {
  const evidence = [];
  const seen = new Set();

  if (entityIds.length > 0) {
    const rows = await prisma.entityMention.findMany({
      where: { entityId: { in: entityIds } },
      orderBy: { createdAt: "asc" },
      include: { document: { select: { id: true, filename: true } } },
    });
    for (const r of rows) {
      const key = `${r.document.id}:${r.mentionText}`;
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push({ documentId: r.document.id, filename: r.document.filename, pageNumber: null, quote: r.mentionText });
      if (evidence.length >= MAX_EVIDENCE_PER_INSIGHT) return evidence;
    }
  }

  if (relationshipIds.length > 0) {
    const rows = await prisma.relationship.findMany({
      where: { id: { in: relationshipIds } },
      include: { document: { select: { id: true, filename: true } } },
    });
    for (const r of rows) {
      const key = `${r.document.id}:${r.relation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push({
        documentId: r.document.id,
        filename: r.document.filename,
        pageNumber: null,
        quote: r.description || r.relation,
      });
      if (evidence.length >= MAX_EVIDENCE_PER_INSIGHT) return evidence;
    }
  }

  return evidence;
}

// documentId set = document-scope; documentId omitted/null = project-scope
// (every entity/relationship in the project, cross-document).
export async function generateInsights({ prisma, openai, projectId, documentId }) {
  const { entities, relationships } = documentId
    ? await loadDocumentGraph(prisma, documentId)
    : await loadProjectGraph(prisma, projectId);

  if (entities.length < MIN_ENTITIES_TO_BOTHER) {
    return { insights: [], skipped: true };
  }

  const trimmedEntities = entities.slice(0, MAX_ENTITIES);
  const trimmedRelationships = relationships.slice(0, MAX_RELATIONSHIPS);

  const nameToEntity = new Map(trimmedEntities.map((e) => [e.name.toLowerCase(), e]));
  const relByTriple = new Map();
  const relByPair = new Map(); // fallback when the model paraphrases the relation phrase
  for (const r of trimmedRelationships) {
    relByTriple.set(`${r.sourceName.toLowerCase()}::${r.relation.toLowerCase()}::${r.targetName.toLowerCase()}`, r);
    const pairKey = [r.sourceName.toLowerCase(), r.targetName.toLowerCase()].sort().join("::");
    if (!relByPair.has(pairKey)) relByPair.set(pairKey, []);
    relByPair.get(pairKey).push(r);
  }

  const prompt =
    `Entities:\n${formatEntitiesForPrompt(trimmedEntities)}\n\n` +
    `Relationships:\n${trimmedRelationships.length ? formatRelationshipsForPrompt(trimmedRelationships) : "(none)"}`;

  let parsed;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: INSIGHTS_PROMPT },
        { role: "user", content: prompt.slice(0, 14000) },
      ],
      temperature: 0.3,
      max_tokens: 2000,
      response_format: { type: "json_object" },
    });
    parsed = JSON.parse(completion.choices[0].message.content || "{}");
  } catch (err) {
    return { insights: [], error: err.message || String(err) };
  }

  const raw = Array.isArray(parsed.insights) ? parsed.insights : [];
  const results = [];

  for (const item of raw.slice(0, MAX_INSIGHTS)) {
    if (!item || typeof item.title !== "string" || !item.title.trim() || typeof item.explanation !== "string") {
      continue;
    }

    const category = CATEGORIES.includes(item.category) ? item.category : "Other";

    const entityIds = [];
    for (const name of Array.isArray(item.supporting_entities) ? item.supporting_entities : []) {
      if (typeof name !== "string") continue;
      const e = nameToEntity.get(name.trim().toLowerCase());
      if (e && !entityIds.includes(e.id)) entityIds.push(e.id);
    }

    const relationshipIds = [];
    for (const rel of Array.isArray(item.supporting_relationships) ? item.supporting_relationships : []) {
      if (!rel || typeof rel.source !== "string" || typeof rel.relation !== "string" || typeof rel.target !== "string") {
        continue;
      }
      const tripleKey = `${rel.source.trim().toLowerCase()}::${rel.relation.trim().toLowerCase()}::${rel.target.trim().toLowerCase()}`;
      let match = relByTriple.get(tripleKey);
      if (!match) {
        const pairKey = [rel.source.trim().toLowerCase(), rel.target.trim().toLowerCase()].sort().join("::");
        const candidates = relByPair.get(pairKey);
        if (candidates && candidates.length) match = candidates[0];
      }
      if (match && !relationshipIds.includes(match.id)) relationshipIds.push(match.id);
    }

    // Ungrounded — the model named something but none of it resolved against
    // real data. Drop rather than store a card with nothing to show on the
    // graph.
    if (entityIds.length === 0 && relationshipIds.length === 0) continue;

    results.push({
      title: item.title.trim().slice(0, 150),
      explanation: item.explanation.trim().slice(0, 600),
      category,
      entityIds,
      relationshipIds,
      evidence: await buildEvidence(prisma, entityIds, relationshipIds),
    });
  }

  return { insights: results };
}

async function storeInsights(prisma, { projectId, documentId, insights }) {
  await prisma.$transaction(async (tx) => {
    if (documentId) {
      await tx.graphInsight.deleteMany({ where: { documentId } });
    } else {
      await tx.graphInsight.deleteMany({ where: { projectId, documentId: null } });
    }
    for (const ins of insights) {
      await tx.graphInsight.create({
        data: {
          projectId,
          documentId: documentId || null,
          title: ins.title,
          explanation: ins.explanation,
          category: ins.category,
          entityIds: ins.entityIds,
          relationshipIds: ins.relationshipIds,
          evidence: ins.evidence,
        },
      });
    }
  });
}

// Generates fresh insights and replaces whatever was previously stored for
// this scope — mirrors the desktop's clear-then-write posture on regenerate.
// Leaves existing stored insights untouched on a hard error (API failure)
// rather than wiping them out for nothing; a "skipped" (too little material)
// result still clears+stores an empty set, since that's a real answer too.
export async function generateAndStoreInsights({ prisma, openai, projectId, documentId }) {
  const { insights, skipped, error } = await generateInsights({ prisma, openai, projectId, documentId });
  if (!error) await storeInsights(prisma, { projectId, documentId, insights });
  return { insights, skipped, error };
}

export async function getStoredInsights(prisma, { projectId, documentId }) {
  const rows = documentId
    ? await prisma.graphInsight.findMany({ where: { documentId }, orderBy: { createdAt: "asc" } })
    : await prisma.graphInsight.findMany({ where: { projectId, documentId: null }, orderBy: { createdAt: "asc" } });

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    explanation: r.explanation,
    category: r.category,
    entityIds: Array.isArray(r.entityIds) ? r.entityIds : [],
    relationshipIds: Array.isArray(r.relationshipIds) ? r.relationshipIds : [],
    evidence: Array.isArray(r.evidence) ? r.evidence : [],
    createdAt: r.createdAt,
  }));
}
