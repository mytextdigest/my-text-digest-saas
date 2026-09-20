// src/lib/graph/shape.js
// The desktop app's graph UI components (ported near-verbatim into
// src/components/graph/) were built against SQLite rows shaped like
// `{ source_entity_id, is_inferred, mention_count, ... }`. Prisma returns the
// same data as camelCase JS objects. Rather than touch the ported frontend
// files, API routes shape their JSON responses through these helpers so the
// frontend stays byte-for-byte close to its desktop source.

export function shapeEntity(e) {
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    description: e.description,
    value: e.value,
    unit: e.unit,
    period: e.period,
    mention_count: e.mentionCount,
    document_count: e.documentCount,
  };
}

export function shapeRelationship(r) {
  return {
    id: r.id,
    source_entity_id: r.sourceEntityId,
    target_entity_id: r.targetEntityId,
    relation: r.relation,
    description: r.description,
    document_id: r.documentId,
    is_inferred: r.isInferred,
    insight_type: r.insightType,
    ...(r.document?.filename ? { filename: r.document.filename } : {}),
  };
}
