// src/lib/graph/queryTool.js
// A second retrieval path for chat, additive to the existing chunk-similarity
// context: lets the model look up a named entity in the extracted knowledge
// graph and pull its 1-2 hop relationships, for questions shaped around how
// things connect rather than what a single passage says. Executed inline,
// unlike consult_general_knowledge — this only surfaces the document's/
// project's own already-extracted data, so it doesn't need the same
// explicit-consent gate used for reaching outside the document.
//
// Ported from the desktop app's electron/graph/queryTool.js, swapping
// better-sqlite3 for Prisma.
import { normalizeName } from "./resolver";

const MAX_EDGES = 30;

export const QUERY_KNOWLEDGE_GRAPH_TOOL = {
  type: "function",
  function: {
    name: "query_knowledge_graph",
    description:
      "Call this when the question is about how people, organizations, or other entities are " +
      "related or connected — e.g. 'How is X connected to Y?', 'Who does X work for?', 'What did " +
      "X acquire?', 'What companies are mentioned alongside X?'. This looks up the named entity in " +
      "a structured knowledge graph already extracted from the document(s) and returns its known " +
      "relationships, which may connect facts that live in different, non-adjacent parts of the " +
      "text. Do not call this for questions already answerable from the document context alone.",
    parameters: {
      type: "object",
      properties: {
        entity: {
          type: "string",
          description: "The name of the person, organization, or other entity to look up.",
        },
        maxHops: {
          type: "integer",
          description: "How many relationship hops to follow from the entity. 1 (direct connections) or 2 (connections of connections). Default 1.",
          enum: [1, 2],
        },
      },
      required: ["entity"],
    },
  },
};

async function findEntity(prisma, name, { documentId, projectId }) {
  const normalized = normalizeName(name);
  if (!normalized) return null;

  if (documentId) {
    const exact = await prisma.entity.findFirst({
      where: { normalizedName: normalized, entityDocuments: { some: { documentId } } },
    });
    if (exact) return exact;
    return prisma.entity.findFirst({
      where: { normalizedName: { contains: normalized }, entityDocuments: { some: { documentId } } },
      orderBy: { mentionCount: "desc" },
    });
  }

  if (projectId) {
    const exact = await prisma.entity.findFirst({ where: { projectId, normalizedName: normalized } });
    if (exact) return exact;
    return prisma.entity.findFirst({
      where: { projectId, normalizedName: { contains: normalized } },
      orderBy: { mentionCount: "desc" },
    });
  }

  return null;
}

async function getDirectEdges(prisma, entityId, { documentId, projectId }) {
  if (documentId) {
    const rows = await prisma.relationship.findMany({
      where: { documentId, OR: [{ sourceEntityId: entityId }, { targetEntityId: entityId }] },
      include: { sourceEntity: { select: { name: true } }, targetEntity: { select: { name: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      sourceEntityId: r.sourceEntityId,
      targetEntityId: r.targetEntityId,
      relation: r.relation,
      isInferred: r.isInferred,
      insightType: r.insightType,
      sourceName: r.sourceEntity.name,
      targetName: r.targetEntity.name,
      filename: null,
    }));
  }

  const rows = await prisma.relationship.findMany({
    where: { projectId, OR: [{ sourceEntityId: entityId }, { targetEntityId: entityId }] },
    include: {
      sourceEntity: { select: { name: true } },
      targetEntity: { select: { name: true } },
      document: { select: { filename: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    sourceEntityId: r.sourceEntityId,
    targetEntityId: r.targetEntityId,
    relation: r.relation,
    isInferred: r.isInferred,
    insightType: r.insightType,
    sourceName: r.sourceEntity.name,
    targetName: r.targetEntity.name,
    filename: r.document?.filename || null,
  }));
}

function formatEdge(edge) {
  const suffix = edge.filename ? ` (source: ${edge.filename})` : "";
  // Inferred edges were synthesized by connecting facts across the document
  // rather than read directly from one passage — flagged so the model
  // doesn't cite them as a direct quote.
  const inferredTag = edge.isInferred ? ` [inferred ${edge.insightType || "insight"}, not a direct quote]` : "";
  return `${edge.sourceName} ${edge.relation} ${edge.targetName}${suffix}${inferredTag}`;
}

// Returns a plain-text summary suitable for direct use as a tool-result
// message — never throws, degrades to a "not found" message instead, since
// this runs inline mid-chat-turn.
export async function runKnowledgeGraphQuery({ prisma, entity, maxHops, documentId, projectId }) {
  try {
    const matched = await findEntity(prisma, entity, { documentId, projectId });
    if (!matched) {
      return `No entity matching "${entity}" was found in the knowledge graph for this ${documentId ? "document" : "project"}.`;
    }

    const scope = { documentId, projectId };
    const visited = new Set([matched.id]);
    const edgesById = new Map();

    let frontier = [matched.id];
    const hops = maxHops === 2 ? 2 : 1;
    for (let hop = 0; hop < hops && edgesById.size < MAX_EDGES; hop++) {
      const nextFrontier = [];
      for (const id of frontier) {
        const edges = await getDirectEdges(prisma, id, scope);
        for (const edge of edges) {
          if (!edgesById.has(edge.id)) edgesById.set(edge.id, edge);
          const otherId = edge.sourceEntityId === id ? edge.targetEntityId : edge.sourceEntityId;
          if (!visited.has(otherId)) {
            visited.add(otherId);
            nextFrontier.push(otherId);
          }
        }
      }
      frontier = nextFrontier;
    }

    const edges = [...edgesById.values()].slice(0, MAX_EDGES);
    if (edges.length === 0) {
      return `"${matched.name}" was found in the knowledge graph, but no relationships to other entities were extracted for it.`;
    }

    return `Relationships found for "${matched.name}":\n` + edges.map(formatEdge).join("\n");
  } catch (err) {
    return `Knowledge graph lookup failed: ${err.message || err}`;
  }
}
