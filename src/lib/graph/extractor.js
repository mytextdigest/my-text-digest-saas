// src/lib/graph/extractor.js
// Per-chunk LLM entity/relationship extraction. Ported near-verbatim from the
// desktop app's electron/graph/extractor.js — gpt-4o-mini,
// response_format: { type: "json_object" }. Pure — no db access.

export const ENTITY_TYPES = ["person", "organization", "location", "product", "concept", "event", "date", "metric", "misc"];

const EXTRACTION_PROMPT = `Extract named entities and the relationships between them from the given text, which is one excerpt from a larger document.

Entity types (use exactly one per entity): ${ENTITY_TYPES.join(", ")}. Use "misc" only when nothing else fits.
- "metric" is for a specific quantified fact: a revenue figure, a growth rate, a margin, a headcount, a price — anything that is fundamentally a number with meaning. Give it "value" (e.g. "46.2", "18", "75") and "unit" (e.g. "%", "$M", "employees") pulled apart from the number itself, and "period" if the text ties it to a specific timeframe (e.g. "FY2022", "Q3 2022") — null if none is stated. Do not create a metric entity for a bare date by itself; that's "date". If the same metric could plausibly recur for a different period elsewhere in the document (e.g. this year's figure vs. last year's), put the period in the metric's "name" itself (e.g. "Gross margin (FY2022)", not just "Gross margin") so the two don't collide into one fact.

Do NOT extract document-structure labels as entities — section/table headings like "Cash Flow Summary", "Balance Sheet", "Executive Summary", "Table 3" are not real-world things. When you see one, extract the actual facts written under that heading instead of the heading itself.

Rules:
- Only extract entities and relationships that are explicitly stated in the text. Do not infer or invent facts.
- "description" is a short (one sentence) factual description grounded in this text.
- A relationship's "source" and "target" must each exactly match the "name" of one of the entities you extracted.
- "relation" is a short verb phrase, not a full sentence. Prefer a precise phrase over a vague one — when the text supports it, use language that names what kind of connection this is: comparative ("is the largest segment by revenue", "grew faster than", "is the fastest-growing") or causal ("contributed to", "resulted in", "drove the increase in") rather than just "related to". Use plain structural phrases ("located in", "acquired", "works at") when that's genuinely all the text supports — never force a causal or comparative phrase the text doesn't state.
- If the text contains no clear entities, return empty arrays.

Return strict JSON in this exact shape, nothing else:
{"entities": [{"name": string, "type": string, "description": string, "value": string|null, "unit": string|null, "period": string|null}], "relationships": [{"source": string, "relation": string, "target": string, "description": string}]}
("value"/"unit"/"period" only apply to "metric" entities — omit or null them for every other type.)`;

export async function extractEntitiesFromChunk(openai, chunkText) {
  if (!chunkText || !chunkText.trim()) return { entities: [], relationships: [] };

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: EXTRACTION_PROMPT },
      { role: "user", content: chunkText.slice(0, 8000) },
    ],
    temperature: 0,
    max_tokens: 1500,
    response_format: { type: "json_object" },
  });

  let parsed;
  try {
    parsed = JSON.parse(completion.choices[0].message.content || "{}");
  } catch (e) {
    return { entities: [], relationships: [] };
  }

  const rawEntities = Array.isArray(parsed.entities) ? parsed.entities : [];
  const entities = rawEntities
    .filter(e => e && typeof e.name === "string" && e.name.trim())
    .map(e => {
      const type = ENTITY_TYPES.includes(String(e.type || "").toLowerCase()) ? String(e.type).toLowerCase() : "misc";
      return {
        name: e.name.trim().slice(0, 200),
        type,
        description: typeof e.description === "string" ? e.description.trim().slice(0, 500) : null,
        // value/unit/period are meaningful only for type "metric" — dropped otherwise
        // so a stray null-ish string on a non-metric entity can't leak through.
        value: type === "metric" && typeof e.value === "string" ? e.value.trim().slice(0, 100) : null,
        unit: type === "metric" && typeof e.unit === "string" ? e.unit.trim().slice(0, 50) : null,
        period: type === "metric" && typeof e.period === "string" ? e.period.trim().slice(0, 100) : null,
      };
    });

  const entityNamesLower = new Set(entities.map(e => e.name.toLowerCase()));
  const rawRelationships = Array.isArray(parsed.relationships) ? parsed.relationships : [];
  const relationships = rawRelationships
    .filter(r =>
      r &&
      typeof r.source === "string" &&
      typeof r.target === "string" &&
      typeof r.relation === "string" &&
      r.relation.trim()
    )
    .filter(r =>
      entityNamesLower.has(r.source.trim().toLowerCase()) &&
      entityNamesLower.has(r.target.trim().toLowerCase())
    )
    .map(r => ({
      source: r.source.trim(),
      target: r.target.trim(),
      relation: r.relation.trim().slice(0, 200),
      description: typeof r.description === "string" ? r.description.trim().slice(0, 500) : null,
    }));

  return { entities, relationships };
}
