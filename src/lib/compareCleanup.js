// src/lib/compareCleanup.js
// Removes every DocumentComparison (and its ComparisonFinding rows) that
// references a given document, on either side of the pair. Used by the
// document delete cascade — mirrors the desktop app's
// removeComparisonsForDocument (electron/main.js), ported to Prisma. Takes
// `prisma` as either the real client or a `$transaction` callback's `tx`, so
// it composes into the caller's own transaction.
export async function removeComparisonsForDocument(prisma, documentId) {
  const affected = await prisma.documentComparison.findMany({
    where: { OR: [{ documentAId: documentId }, { documentBId: documentId }] },
    select: { id: true },
  });
  if (affected.length === 0) return;

  const comparisonIds = affected.map((c) => c.id);
  await prisma.comparisonFinding.deleteMany({ where: { comparisonId: { in: comparisonIds } } });
  await prisma.documentComparison.deleteMany({ where: { id: { in: comparisonIds } } });
}
