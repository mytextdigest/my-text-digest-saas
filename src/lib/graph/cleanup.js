// src/lib/graph/cleanup.js
// Removes all knowledge-graph data attributable to one document: its
// mentions/edges/entity-document links, and any entity that consequently has
// zero remaining linked documents (deleted outright — an entity can be
// shared across documents, so it's only removed once nothing references it
// anymore). Used by (a) the document/project delete cascade and (b) the
// graph "generate" route before re-extracting, so repeated Regenerate clicks
// don't pile up duplicate mentions/relationships — mirrors the desktop app's
// removeGraphDataForDocument (electron/main.js), ported to Prisma.
export async function removeGraphDataForDocument(prisma, documentId, { projectId } = {}) {
  const affected = await prisma.entityMention.findMany({
    where: { documentId },
    select: { entityId: true },
    distinct: ["entityId"],
  });
  const affectedIds = affected.map((r) => r.entityId);

  await prisma.entityMention.deleteMany({ where: { documentId } });
  await prisma.relationship.deleteMany({ where: { documentId } });
  await prisma.entityDocument.deleteMany({ where: { documentId } });

  for (const entityId of affectedIds) {
    const documentCount = await prisma.entityDocument.count({ where: { entityId } });
    if (documentCount === 0) {
      // Defensive: an entity that only ever appeared in this document should
      // have no relationships left pointing at it once the delete above ran,
      // but clear any anyway before deleting the row (source/target FKs are
      // RESTRICT, not CASCADE).
      await prisma.relationship.deleteMany({
        where: { OR: [{ sourceEntityId: entityId }, { targetEntityId: entityId }] },
      });
      await prisma.entity.delete({ where: { id: entityId } }).catch(() => {});
    } else {
      const mentionCount = await prisma.entityMention.count({ where: { entityId } });
      await prisma.entity.update({ where: { id: entityId }, data: { mentionCount, documentCount } });
    }
  }

  await prisma.graphExtractionLog.deleteMany({ where: { documentId } });

  // Insight cards cite specific entity/relationship ids — once this
  // document's graph data is gone, a card for this document (or a
  // project-level card that cited an entity this document contributed)
  // would point at rows that no longer exist. Clearing is cheap; both
  // regenerate on demand via the Insights panel's own button.
  await prisma.graphInsight.deleteMany({ where: { documentId } });

  let resolvedProjectId = projectId;
  if (!resolvedProjectId) {
    const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { projectId: true } });
    resolvedProjectId = doc?.projectId || null;
  }

  if (resolvedProjectId && affectedIds.length > 0) {
    const affectedSet = new Set(affectedIds);
    const projectLevelInsights = await prisma.graphInsight.findMany({
      where: { projectId: resolvedProjectId, documentId: null },
      select: { id: true, entityIds: true },
    });
    const staleIds = projectLevelInsights
      .filter((ins) => Array.isArray(ins.entityIds) && ins.entityIds.some((id) => affectedSet.has(id)))
      .map((ins) => ins.id);
    if (staleIds.length > 0) {
      await prisma.graphInsight.deleteMany({ where: { id: { in: staleIds } } });
    }
  }
}
