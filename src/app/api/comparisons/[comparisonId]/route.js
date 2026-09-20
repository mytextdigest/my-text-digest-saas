import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

// Every comparison/finding is reached only through routes that first verify
// the comparison's project.userId against the session — a tampered
// comparisonId 404s, same shape as every other route in this app.
async function loadOwnedComparison(comparisonId, email) {
  return prisma.documentComparison.findFirst({
    where: { id: comparisonId, project: { user: { email } } },
    include: {
      documentA: { select: { id: true, filename: true } },
      documentB: { select: { id: true, filename: true } },
    },
  });
}

export async function GET(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { comparisonId } = await params;
  const comparison = await loadOwnedComparison(comparisonId, session.user.email);
  if (!comparison) return NextResponse.json({ error: "Comparison not found" }, { status: 404 });

  // chunkIndex is joined in so Document View can re-sort findings into each
  // document's original reading order (not similarity/sortOrder), replacing
  // the desktop version's two LEFT JOIN chunks.
  const findings = await prisma.comparisonFinding.findMany({
    where: { comparisonId },
    orderBy: { sortOrder: "asc" },
    include: {
      documentAChunk: { select: { chunkIndex: true } },
      documentBChunk: { select: { chunkIndex: true } },
    },
  });

  return NextResponse.json({
    success: true,
    comparison: {
      id: comparison.id,
      projectId: comparison.projectId,
      documentAId: comparison.documentAId,
      documentBId: comparison.documentBId,
      documentAFilename: comparison.documentA.filename,
      documentBFilename: comparison.documentB.filename,
      status: comparison.status,
      summary: comparison.summaryJson || [],
      errorMessage: comparison.errorMessage,
      insightCompact: comparison.insightCompact || null,
      insightDescriptive: comparison.insightDescriptive || null,
      createdAt: comparison.createdAt,
      completedAt: comparison.completedAt,
    },
    findings: findings.map((f) => ({
      id: f.id,
      category: f.category,
      sectionLabel: f.sectionLabel,
      documentAChunkId: f.documentAChunkId,
      documentAExcerpt: f.documentAExcerpt,
      documentAChunkIndex: f.documentAChunk?.chunkIndex ?? null,
      documentBChunkId: f.documentBChunkId,
      documentBExcerpt: f.documentBExcerpt,
      documentBChunkIndex: f.documentBChunk?.chunkIndex ?? null,
      explanation: f.explanation,
      similarity: f.similarity,
      sortOrder: f.sortOrder,
    })),
  });
}

// $transaction: delete ComparisonFinding rows then the DocumentComparison row.
export async function DELETE(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { comparisonId } = await params;
  const comparison = await loadOwnedComparison(comparisonId, session.user.email);
  if (!comparison) return NextResponse.json({ error: "Comparison not found" }, { status: 404 });

  await prisma.$transaction([
    prisma.comparisonFinding.deleteMany({ where: { comparisonId } }),
    prisma.documentComparison.delete({ where: { id: comparisonId } }),
  ]);

  return NextResponse.json({ success: true });
}
