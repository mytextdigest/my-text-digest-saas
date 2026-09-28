// src/lib/tables/toFacts.js
// Turns table cells into exact "metric" facts for the knowledge graph
// (FR-33), so graph metrics for tabulated numbers match the tables exactly
// instead of being re-read from text by the LLM extractor. Facts are linked
// to the table's synthetic chunk; removing the table removes them.
import { effectiveTableOf } from "./schema.js";
import { colLabel } from "./clean.js";
import { toTableRecord } from "./rows.js";

const MAX_FACTS_PER_TABLE = 60;
const MAX_FACTS_PER_DOCUMENT = 200;

function normalizeName(name) {
  return String(name || "").toLowerCase().replace(/[’']/g, "'").trim().replace(/\s+/g, " ");
}

// One fact per data row × numeric column. Name: "<row> <metric> (<period>)".
function tableToFacts(record, table = effectiveTableOf(record)) {
  if (!table) return [];
  const labelCol = table.columns.findIndex((c) => c.type === "text");
  if (labelCol < 0) return [];
  const facts = [];
  for (const row of table.rows || []) {
    if (row.kind === "section") continue;
    const label = String(row.cells[labelCol]?.raw || "").trim();
    if (!label) continue;
    table.columns.forEach((col, j) => {
      if (col.type === "text") return;
      const cell = row.cells[j];
      if (!cell || typeof cell.v !== "number") return;
      const parent = (col.headerPath || []).length > 1 ? col.headerPath[0] : null;
      const metric = parent || (col.period ? record.title : colLabel(col, j)) || record.title || "Value";
      const period = col.period || null;
      const name = `${label} ${metric}${period ? ` (${period})` : ""}`.replace(/\s+/g, " ").slice(0, 200);
      facts.push({
        name,
        type: "metric",
        value: String(cell.raw).trim(),
        unit: col.unit || table.tableUnit || null,
        period,
        description: `From table "${record.title || "Untitled"}"${record.page_start ? ` (p. ${record.page_start})` : ""}.`,
      });
    });
    if (facts.length >= MAX_FACTS_PER_TABLE) break;
  }
  return facts.slice(0, MAX_FACTS_PER_TABLE);
}

// Writes facts for every ready table of a document into the project graph.
// Exact-name resolution only (no embeddings): the names are specific enough
// ("Europe Revenue (2025)") that fuzzy merging would do more harm than good.
async function writeTableFactsToGraph({ prisma, docId, projectId }) {
  const tables = (await prisma.documentTable.findMany({
    where: { documentId: docId, status: "ready", chunkId: { not: null } },
    orderBy: { tableIndex: "asc" },
  })).map(toTableRecord);
  let created = 0, matched = 0, total = 0;
  await prisma.$transaction(async (tx) => {
    for (const t of tables) {
      if (total >= MAX_FACTS_PER_DOCUMENT) break;
      for (const f of tableToFacts(t)) {
        if (total >= MAX_FACTS_PER_DOCUMENT) break;
        total++;
        const normalized = normalizeName(f.name);
        let entity = await tx.entity.findFirst({ where: { projectId, type: "metric", normalizedName: normalized }, select: { id: true } });
        if (entity) matched++;
        else {
          entity = await tx.entity.create({
            data: {
              projectId, name: f.name, normalizedName: normalized, type: "metric", description: f.description,
              value: f.value, unit: f.unit, period: f.period, embedding: null, mentionCount: 0, documentCount: 0,
            },
            select: { id: true },
          });
          created++;
        }
        await tx.entityMention.create({
          data: { entityId: entity.id, documentId: docId, chunkId: t.chunk_id, mentionText: `${f.name}: ${f.value}${f.unit ? ` ${f.unit}` : ""}` },
        });
        await tx.entity.update({ where: { id: entity.id }, data: { mentionCount: { increment: 1 } } });
        const link = await tx.entityDocument.createMany({
          data: [{ entityId: entity.id, documentId: docId, confidence: 1.0 }],
          skipDuplicates: true,
        });
        if (link.count > 0) await tx.entity.update({ where: { id: entity.id }, data: { documentCount: { increment: 1 } } });
      }
    }
  }, { timeout: 60000 });
  return { factsCreated: created, factsMatched: matched };
}

export { tableToFacts, writeTableFactsToGraph };
