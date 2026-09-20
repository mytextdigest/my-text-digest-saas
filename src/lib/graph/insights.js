// src/lib/graph/insights.js
// Document-level synthesis pass, run once after per-chunk extraction and
// resolution finish for a document. Per-chunk extraction (extractor.js) only
// ever sees one chunk at a time, so it can never connect facts stated in
// different paragraphs (e.g. "gross margin improved" in one section, "the
// facility reached full production capacity" in another) or notice a
// comparison across entities that came from different chunks (e.g. which of
// three segments grew fastest). This pass looks at the document's full set
// of already-resolved entities and already-extracted relationships together,
// and asks for a small number of additional edges that make those
// connections explicit: comparative ("X is the fastest-growing segment") and
// causal ("X contributed to Y") insights.
//
// Every insight edge must connect two entities that already exist for this
// document — nothing new is invented, mirroring extractor.js's own
// grounding rule. Written with isInferred=true and an insightType, so the UI
// can visually and textually distinguish "the document states this" from "we
// connected this across the document". Must never throw in a way that breaks
// the caller — worker/processGraph.js catches around this call anyway, but
// this mirrors the desktop's own internal try/catch on the LLM call itself.
//
// Ported from the desktop app's electron/graph/insights.js, swapping
// better-sqlite3 for Prisma.

const MAX_ENTITIES_FOR_SYNTHESIS = 120; // keep the prompt small & cheap
const MIN_ENTITIES_TO_BOTHER = 4; // not enough material to synthesize anything useful below this
const MAX_INSIGHTS = 12;
const INSIGHT_TYPES = ["causal", "comparative", "trend"];

const SYNTHESIS_PROMPT = `You are looking at every entity and relationship already extracted from ONE document, taken as a whole. Find connections that only become visible once you see the whole document together — not ones a single passage already stated directly.

Two kinds of insight to look for:
- "comparative": a ranking or superlative across similar entities (e.g. which of several segments/products/regions is largest, fastest-growing, highest-margin) — only when the given values actually support the comparison.
- "causal": one fact plausibly explains or drove another, where the explanation and the result are stated in different relationships/entities but not directly connected to each other yet (e.g. a facility ramp-up and a margin improvement, a new contract and a revenue increase).
"trend" is for a plain change-over-time link between two metric entities that clearly represent the same measure at different periods (e.g. "Gross margin (FY2022)" vs "Gross margin (FY2021)").

Rules:
- Every "source" and "target" must exactly match the "name" of an entity in the provided list. Do not invent new entities or facts not supported by what's given.
- Do not restate a relationship that's already in the given relationship list — only add connections that are missing.
- "relation" is a short phrase stating the insight (e.g. "is the fastest-growing segment", "contributed to the improvement in").
- "description" is one sentence explaining the reasoning, grounded only in the given entities/relationships/descriptions — never outside knowledge.
- Prefer fewer, well-supported insights over many speculative ones. If nothing clears that bar, return an empty array.

Return strict JSON, nothing else:
{"insights": [{"source": string, "relation": string, "target": string, "insight_type": "causal"|"comparative"|"trend", "description": string}]}`;

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
    .map((r) => `- ${r.sourceEntity.name} ${r.relation} ${r.targetEntity.name}${r.description ? ` (${r.description})` : ""}`)
    .join("\n");
}

export async function synthesizeDocumentInsights(documentId, projectId, prisma, openai) {
  const entities = await prisma.entity.findMany({
    where: { entityDocuments: { some: { documentId } } },
    select: { id: true, name: true, type: true, description: true, value: true, unit: true, period: true },
  });

  if (entities.length < MIN_ENTITIES_TO_BOTHER) {
    return { insightsCreated: 0, skipped: true };
  }

  const trimmedEntities = entities.slice(0, MAX_ENTITIES_FOR_SYNTHESIS);
  const nameToId = new Map(trimmedEntities.map((e) => [e.name.toLowerCase(), e.id]));

  const relationships = await prisma.relationship.findMany({
    where: { documentId, isInferred: false },
    include: { sourceEntity: { select: { name: true } }, targetEntity: { select: { name: true } } },
  });

  // Keyed on (source, target, relation) rather than just (source, target) —
  // two entities can legitimately have more than one kind of connection (a
  // structural relation from per-chunk extraction AND a distinct causal or
  // comparative one from synthesis); only block a literal restatement of the
  // same relation, which is the actual failure mode this guards against.
  const existingTriples = new Set(
    relationships.map((r) => `${r.sourceEntity.name.toLowerCase()}::${r.targetEntity.name.toLowerCase()}::${r.relation.toLowerCase()}`)
  );

  const prompt =
    `Entities:\n${formatEntitiesForPrompt(trimmedEntities)}\n\n` +
    `Relationships already extracted:\n${relationships.length ? formatRelationshipsForPrompt(relationships) : "(none)"}`;

  let parsed;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYNTHESIS_PROMPT },
        { role: "user", content: prompt.slice(0, 12000) },
      ],
      temperature: 0.2,
      max_tokens: 1500,
      response_format: { type: "json_object" },
    });
    parsed = JSON.parse(completion.choices[0].message.content || "{}");
  } catch (err) {
    return { insightsCreated: 0, error: err.message || String(err) };
  }

  const rawInsights = Array.isArray(parsed.insights) ? parsed.insights : [];
  let insightsCreated = 0;

  for (const insight of rawInsights.slice(0, MAX_INSIGHTS)) {
    if (
      !insight ||
      typeof insight.source !== "string" ||
      typeof insight.target !== "string" ||
      typeof insight.relation !== "string" ||
      !insight.relation.trim()
    ) {
      continue;
    }

    const sourceKey = insight.source.trim().toLowerCase();
    const targetKey = insight.target.trim().toLowerCase();
    const sourceId = nameToId.get(sourceKey);
    const targetId = nameToId.get(targetKey);
    if (!sourceId || !targetId || sourceId === targetId) continue;

    const relationKey = insight.relation.trim().toLowerCase();
    const tripleKey = `${sourceKey}::${targetKey}::${relationKey}`;
    if (existingTriples.has(tripleKey)) continue; // literal restatement — don't duplicate

    const insightType = INSIGHT_TYPES.includes(String(insight.insight_type || "").toLowerCase())
      ? String(insight.insight_type).toLowerCase()
      : "comparative";

    await prisma.relationship.create({
      data: {
        projectId,
        sourceEntityId: sourceId,
        targetEntityId: targetId,
        relation: insight.relation.trim().slice(0, 200),
        description: typeof insight.description === "string" ? insight.description.trim().slice(0, 500) : null,
        documentId,
        chunkId: null,
        confidence: 0.75,
        isInferred: true,
        insightType,
      },
    });
    insightsCreated += 1;
    existingTriples.add(tripleKey);
  }

  return { insightsCreated };
}
