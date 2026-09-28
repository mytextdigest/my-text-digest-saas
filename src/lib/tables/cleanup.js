// src/lib/tables/cleanup.js
// Table cascades, ported from the desktop's main.js helpers
// (deleteChunksAndReferences, removeTableChunks, removeDerivedTablesFor,
// removeTablesForDocument) onto Prisma. Every function takes a client `db`
// — pass the `tx` of an interactive transaction so the whole cascade is
// atomic. Postgres enforces the chunk foreign keys (EntityMention,
// Relationship, ComparisonFinding, Figure), so references go first.
// Also shared helpers for settings and scanned-page bookkeeping.

// Deletes chunks and everything that references them. Graph entities left
// with no mentions in this document lose their link to it, and are deleted
// outright once no document mentions them.
export async function deleteChunksAndReferences(db, chunkIds, docId) {
  if (!chunkIds.length) return;
  const inChunks = { in: chunkIds };

  await db.figure.updateMany({ where: { chunkId: inChunks }, data: { chunkId: null } });
  await db.documentTable.updateMany({ where: { chunkId: inChunks }, data: { chunkId: null } });
  // A comparison finding keeps its stored excerpt text; only the link goes.
  await db.comparisonFinding.updateMany({ where: { documentAChunkId: inChunks }, data: { documentAChunkId: null } });
  await db.comparisonFinding.updateMany({ where: { documentBChunkId: inChunks }, data: { documentBChunkId: null } });
  await db.relationship.deleteMany({ where: { chunkId: inChunks } });

  const affected = (await db.entityMention.findMany({
    where: { chunkId: inChunks },
    select: { entityId: true },
    distinct: ["entityId"],
  })).map((r) => r.entityId);
  if (affected.length) {
    await db.entityMention.deleteMany({ where: { chunkId: inChunks } });
    for (const entityId of affected) {
      const stillInDoc = await db.entityMention.count({ where: { entityId, documentId: docId } });
      if (!stillInDoc) await db.entityDocument.deleteMany({ where: { entityId, documentId: docId } });
      const documentCount = await db.entityDocument.count({ where: { entityId } });
      if (documentCount === 0) {
        await db.relationship.deleteMany({ where: { OR: [{ sourceEntityId: entityId }, { targetEntityId: entityId }] } });
        await db.entity.deleteMany({ where: { id: entityId } });
      } else {
        const mentionCount = await db.entityMention.count({ where: { entityId } });
        await db.entity.update({ where: { id: entityId }, data: { mentionCount, documentCount } });
      }
    }
  }
  await db.chunk.deleteMany({ where: { id: inChunks } });
}

// Deletes tables' synthetic chunks, including the exact graph facts
// (tables/toFacts.js) anchored on them.
export async function removeTableChunks(db, tableIds, docId) {
  if (!tableIds.length) return;
  const chunkIds = (await db.chunk.findMany({ where: { tableId: { in: tableIds } }, select: { id: true } })).map((c) => c.id);
  await deleteChunksAndReferences(db, chunkIds, docId);
}

// Derived (chat comparison) tables built from any of these tables are
// removed; chat messages that showed them degrade to their text answer.
export async function removeDerivedTablesFor(db, tableIds) {
  if (!tableIds.length) return;
  const derivedIds = (await db.derivedTable.findMany({
    where: { sourceTableIds: { hasSome: tableIds.map(String) } },
    select: { id: true },
  })).map((d) => d.id);
  if (!derivedIds.length) return;
  await db.message.updateMany({ where: { derivedTableId: { in: derivedIds } }, data: { derivedTableId: null } });
  await db.projectMessage.updateMany({ where: { derivedTableId: { in: derivedIds } }, data: { derivedTableId: null } });
  await db.derivedTable.deleteMany({ where: { id: { in: derivedIds } } });
}

// Cascade for delete-document / delete-project / re-extraction. `where`
// narrows which of the document's tables go (re-extract keeps edited ones
// until the worker has read them).
export async function removeTablesForDocument(db, docId, { keepLog = false, where = {} } = {}) {
  const tableIds = (await db.documentTable.findMany({ where: { documentId: docId, ...where }, select: { id: true } })).map((t) => t.id);
  await removeTableChunks(db, tableIds, docId);
  await removeDerivedTablesFor(db, tableIds);
  if (tableIds.length) await db.documentTable.deleteMany({ where: { id: { in: tableIds } } });
  if (!keepLog) await db.tableExtractionLog.deleteMany({ where: { documentId: docId } });
  return tableIds;
}

// Per-user feature switches (desktop getSetting keys). Absent = on.
export async function getTableSettings(db, userId) {
  const rows = await db.setting.findMany({
    where: { userId, key: { in: ["tables_enabled", "tables_llm_enabled", "tables_vision_enabled"] } },
    select: { key: true, value: true },
  });
  const off = (key) => rows.some((r) => r.key === key && r.value === "false");
  return { enabled: !off("tables_enabled"), llm: !off("tables_llm_enabled"), vision: !off("tables_vision_enabled") };
}

// Scanned pages the automatic run didn't reach.
export function pendingScannedPages(vision) {
  const checked = new Set(vision?.checkedPages || []);
  return (vision?.scannedPages || []).filter((p) => !checked.has(p));
}
