// src/lib/tables/rows.js
// Prisma DocumentTable / TableExtractionLog / DerivedTable rows → the
// desktop's snake_case record shapes. The ported pure modules (schema.js
// effectiveTableOf, pairing.js, toFacts.js, match.js) and the copied UI
// components read desktop field names; mapping once here keeps them
// unchanged. SaaS-only file (no desktop counterpart).

const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null);

// Full record, as `SELECT * FROM document_tables` returns it on desktop
// (JSON layers stay objects; effectiveTableOf accepts both).
export function toTableRecord(t) {
  if (!t) return null;
  return {
    id: t.id,
    document_id: t.documentId,
    table_index: t.tableIndex,
    page_start: t.pageStart ?? null,
    page_end: t.pageEnd ?? null,
    sheet_name: t.sheetName ?? null,
    source_type: t.sourceType,
    title: t.title ?? null,
    title_source: t.titleSource ?? null,
    description: t.description ?? null,
    caption: t.caption ?? null,
    confidence: t.confidence ?? null,
    row_count: t.rowCount ?? null,
    col_count: t.colCount ?? null,
    raw_json: t.rawJson ?? null,
    clean_json: t.cleanJson ?? null,
    edited_json: t.editedJson ?? null,
    edited_at: iso(t.editedAt),
    grounding_issues: t.groundingIssues ?? 0,
    signature: t.signature ?? null,
    signature_embedding: t.signatureEmbedding ?? null,
    chunk_id: t.chunkId ?? null,
    figure_id: t.figureId ?? null,
    status: t.status,
    error_message: t.errorMessage ?? null,
    created_at: iso(t.createdAt),
    updated_at: iso(t.updatedAt),
  };
}

// Prisma `select` for the desktop's TABLE_SUMMARY_FIELDS (list views).
export const TABLE_SUMMARY_SELECT = {
  id: true, documentId: true, tableIndex: true, pageStart: true, pageEnd: true, sheetName: true, sourceType: true,
  title: true, titleSource: true, description: true, caption: true, confidence: true, rowCount: true, colCount: true,
  groundingIssues: true, status: true, figureId: true, editedAt: true, createdAt: true,
};

// A TABLE_SUMMARY_SELECT row → the desktop list-tables row (with `edited`).
// `edited` needs editedJson presence; editedAt is set exactly when it is.
export function toTableSummary(t) {
  const { raw_json, clean_json, edited_json, signature, signature_embedding, chunk_id, error_message, updated_at, ...rest } = toTableRecord(t);
  return { ...rest, edited: !!t.editedAt };
}

export function toLogRecord(log) {
  if (!log) return null;
  return {
    document_id: log.documentId,
    status: log.status,
    tables_found: log.tablesFound,
    candidates_seen: log.candidatesSeen,
    skipped_low_conf: log.skippedLowConf,
    skipped_for_cap: log.skippedForCap,
    repaired_by_llm: log.repairedByLlm,
    vision_json: log.visionJson ?? null,
    error_message: log.errorMessage ?? null,
    started_at: iso(log.startedAt),
    completed_at: iso(log.completedAt),
  };
}

// desktop loadDerivedTable()
export function toDerived(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.projectId ?? null,
    documentId: row.documentId ?? null,
    kind: row.kind,
    title: row.title,
    request: row.requestJson ?? null,
    table: row.tableJson,
    sourceTableIds: row.sourceTableIds || [],
    warnings: row.warningsJson || [],
    createdAt: iso(row.createdAt),
  };
}
