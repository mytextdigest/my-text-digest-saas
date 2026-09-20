// worker/compareWorker.js
// Orchestrates a full document-comparison run: deterministic alignment ->
// bounded LLM classification -> grounded overall summary -> precomputed
// compact insight -> storage. Used by both the create-comparison/
// regenerate-comparison API routes (picker UI) and the compare_documents
// chat tool (src/lib/compareQueryTool.js) — one implementation, two entry
// points, same as the desktop app's electron/compare/index.js.
//
// This is the single biggest architectural change in this port: the
// desktop's runComparison() ran synchronously inside one Electron IPC call
// (blocking up to "a minute for long documents"). That doesn't transfer to
// an HTTP request handler here, so this runs as an SQS-consumed job instead
// — the API routes enqueue and return immediately, the frontend polls
// DocumentComparison.status the same way GraphView.jsx/FiguresGallery.jsx
// already do.
import { PrismaClient } from "@prisma/client";
import pLimit from "p-limit";
import { alignChunks, selectForClassification, enforceCategory } from "../src/lib/compareAlignment.js";
import { classifyUnit, buildOverallSummary } from "../src/lib/compareClassify.js";
import { buildInsight } from "../src/lib/compareInsight.js";
import { getOpenAIForDocument } from "../src/lib/openaiForDocument.js";

const prisma = new PrismaClient();

// Cost-capped independent of document size — see compareClassify.js.
const SECTION_CAP = 40;
const CLASSIFY_CONCURRENCY = 3;

async function loadChunks(documentId) {
  const rows = await prisma.chunk.findMany({
    where: { documentId, embedding: { not: null }, text: { not: null } },
    orderBy: { chunkIndex: "asc" },
  });
  return rows.map((c) => ({ id: c.id, text: c.text, embedding: c.embedding }));
}

function excerptFor(chunk) {
  return chunk ? chunk.text.slice(0, 800) : null;
}

function buildFindingRow({ unit, category, result, byIdA, byIdB }) {
  const chunkA = unit.aId != null ? byIdA.get(unit.aId) : null;
  const chunkB = unit.bId != null ? byIdB.get(unit.bId) : null;
  return {
    category,
    sectionLabel: result?.sectionLabel || null,
    documentAChunkId: chunkA ? chunkA.id : null,
    documentAExcerpt: excerptFor(chunkA),
    documentBChunkId: chunkB ? chunkB.id : null,
    documentBExcerpt: excerptFor(chunkB),
    explanation: result?.explanation || null,
    similarity: unit.similarity ?? null,
  };
}

// processCompareJob({ comparisonId, documentAId, documentBId, projectId })
// The entire body is wrapped so no error escapes it — same posture as
// processFigureJob/processGraphJob; a per-comparison status/errorMessage
// mechanism already does the right user-facing thing, so this must never
// throw past its own handler (see the "compare" exclusion in
// worker/index.js's recordJobFailure).
export async function processCompareJob(job) {
  const { comparisonId, documentAId, documentBId } = job;

  try {
    const chunksA = await loadChunks(documentAId);
    const chunksB = await loadChunks(documentBId);
    if (!chunksA.length || !chunksB.length) {
      throw new Error("Both documents need to finish processing (with embeddings) before they can be compared.");
    }

    const byIdA = new Map(chunksA.map((c) => [c.id, c]));
    const byIdB = new Map(chunksB.map((c) => [c.id, c]));

    const alignment = alignChunks(chunksA, chunksB);
    const { toClassify, autoSame } = selectForClassification({ ...alignment, cap: SECTION_CAP });

    const openai = await getOpenAIForDocument(documentAId);
    const limit = pLimit(CLASSIFY_CONCURRENCY);

    const classified = await Promise.all(
      toClassify.map((unit) =>
        limit(async () => {
          try {
            const excerptA = unit.aId != null ? byIdA.get(unit.aId)?.text : null;
            const excerptB = unit.bId != null ? byIdB.get(unit.bId)?.text : null;
            const result = await classifyUnit({ openai, unitType: unit.type, excerptA, excerptB });
            return { unit, result };
          } catch (err) {
            // A single section's classification failure is isolated — it
            // still gets a row (enforced category, no label/explanation), it
            // does not fail the whole comparison.
            console.warn("⚠️  comparison section classification failed:", err.message);
            return { unit, result: null };
          }
        })
      )
    );

    const findings = [];
    for (const { unit, result } of classified) {
      findings.push(buildFindingRow({ unit, category: enforceCategory(unit.type, result?.category), result, byIdA, byIdB }));
    }
    for (const pair of autoSame) {
      findings.push(buildFindingRow({ unit: { type: "matched", ...pair }, category: "same", result: null, byIdA, byIdB }));
    }

    // Lowest-similarity (most likely to matter) first; unmatched (no
    // similarity value) findings sort to the front alongside them.
    findings.sort((a, b) => (a.similarity ?? 0) - (b.similarity ?? 0));

    await prisma.comparisonFinding.createMany({
      data: findings.map((f, i) => ({ comparisonId, ...f, sortOrder: i })),
    });

    const insertedFindings = await prisma.comparisonFinding.findMany({
      where: { comparisonId },
      orderBy: { sortOrder: "asc" },
    });
    const findingIds = insertedFindings.map((f) => f.id);

    let summary = [];
    try {
      summary = await buildOverallSummary({ openai, findings: insertedFindings, findingIds });
    } catch (err) {
      console.warn("⚠️  comparison overall summary failed:", err.message);
      summary = [];
    }

    // Compact insight (Insight tab's default view) is generated up front,
    // reusing the findings/summary already computed above — cheap, and
    // avoids an extra round trip the first time a user opens that tab.
    // Descriptive is intentionally NOT generated here — see the insight API
    // route, which generates it lazily on first request.
    let insightCompact = null;
    try {
      const [docA, docB] = await Promise.all([
        prisma.document.findUnique({ where: { id: documentAId }, select: { filename: true } }),
        prisma.document.findUnique({ where: { id: documentBId }, select: { filename: true } }),
      ]);
      insightCompact = await buildInsight({
        openai, findings: insertedFindings, summary, style: "compact",
        documentAName: docA?.filename, documentBName: docB?.filename,
      });
    } catch (err) {
      console.warn("⚠️  comparison compact insight failed:", err.message);
    }

    await prisma.documentComparison.update({
      where: { id: comparisonId },
      data: { status: "ready", summaryJson: summary, insightCompact, completedAt: new Date() },
    });

    console.log(`✅ Comparison job complete: ${comparisonId}`);
  } catch (err) {
    console.error(`❌ Comparison job failed (${comparisonId}):`, err?.message || err);
    try {
      await prisma.documentComparison.update({
        where: { id: comparisonId },
        data: { status: "error", errorMessage: String(err?.message || err).slice(0, 2000) },
      });
    } catch (updateErr) {
      console.error("❌ Failed to record comparison job failure:", updateErr.message);
    }
  }
}
