// worker/processGraph.js
// Orchestrates knowledge-graph extraction for one document: runs per-chunk
// LLM extraction with bounded concurrency, resolves entities against the
// rest of the project, and writes entities/entity_mentions/entity_documents/
// relationships. Manually triggered only (see the document/project graph
// "generate" API routes) — must never throw past its own handler, same
// posture as worker/processFigures.js; see the "graph" exclusion in
// worker/index.js's recordJobFailure.
//
// Ported from the desktop app's electron/graph/index.js, swapping
// better-sqlite3 for Prisma and inlining the log-upsert/status transitions
// that main.js's IPC handlers used to drive.

import { PrismaClient } from "@prisma/client";
import pLimit from "p-limit";
import { extractEntitiesFromChunk } from "../src/lib/graph/extractor.js";
import { resolveEntitiesBatch, buildCache } from "../src/lib/graph/resolver.js";
import { synthesizeDocumentInsights } from "../src/lib/graph/insights.js";
import { getOpenAIForDocument } from "../src/lib/openaiForDocument.js";

const prisma = new PrismaClient();

export const CHUNK_CAP = 40; // bound LLM cost on very large documents, mirrors the figures job's cap
const CONCURRENCY = 5;

async function upsertLogStart(documentId, chunksTotal) {
  await prisma.graphExtractionLog.upsert({
    where: { documentId },
    create: { documentId, status: "extracting", chunksTotal, chunksDone: 0, startedAt: new Date() },
    update: { status: "extracting", chunksTotal, chunksDone: 0, errorMessage: null, startedAt: new Date(), completedAt: null },
  });
}

// The entire body is wrapped so no error escapes it (mirrors
// processFigureJob) — an uncaught throw here would still trip SQS's
// redrive/DLQ machinery for what are individually-recoverable extraction
// failures, for a subsystem that isn't supposed to be able to fail the
// document.
export async function processGraphJob(job) {
  const { documentId, projectId } = job;

  try {
    if (!projectId) {
      // Resolution is project-scoped (mirrors topics); without a project
      // there's nowhere to resolve entities against, so skip rather than
      // half-implement.
      console.log(`⚪ [graph:${documentId}] Skipped — no projectId`);
      return;
    }

    console.log(`🕸️  GRAPH JOB: ${documentId}`);

    const allChunks = await prisma.chunk.findMany({
      where: { documentId },
      orderBy: { chunkIndex: "asc" },
    });

    const chunks = allChunks.slice(0, CHUNK_CAP);
    const skippedForCap = allChunks.length - chunks.length;

    await upsertLogStart(documentId, chunks.length);

    const openai = await getOpenAIForDocument(documentId);
    const limit = pLimit(CONCURRENCY);
    let chunksDone = 0;

    const perChunkResults = await Promise.all(
      chunks.map((chunk) =>
        limit(async () => {
          try {
            const result = await extractEntitiesFromChunk(openai, chunk.text);
            return { chunk, ...result };
          } catch (err) {
            console.error(`   ❌ [graph:${documentId}] Chunk ${chunk.chunkIndex} extraction failed:`, err.message || err);
            return { chunk, entities: [], relationships: [] };
          } finally {
            chunksDone += 1;
            await prisma.graphExtractionLog.update({ where: { documentId }, data: { chunksDone } });
          }
        })
      )
    );

    await prisma.graphExtractionLog.update({ where: { documentId }, data: { status: "resolving" } });

    const cache = await buildCache(projectId, prisma);
    let entitiesCreated = 0;
    let entitiesMatched = 0;
    let relationshipsCreated = 0;
    // Document-scoped anchor for "the organization this document is about" —
    // lets a later chunk's generic self-reference ("the Company") resolve to
    // the same entity as the proper name introduced in an earlier chunk,
    // instead of becoming its own disconnected node. See resolver.js.
    let primaryOrgId = null;

    for (const { chunk, entities, relationships } of perChunkResults) {
      if (!entities.length) continue;

      // Dedupe within this chunk by type+normalized-name before resolving.
      const seen = new Map();
      for (const e of entities) {
        const dedupeKey = `${e.type}::${e.name.toLowerCase()}`;
        if (!seen.has(dedupeKey)) seen.set(dedupeKey, e);
      }
      const drafts = [...seen.values()];

      let resolvedMap;
      try {
        const resolution = await resolveEntitiesBatch(drafts, { projectId, prisma, openai, cache, primaryOrgId });
        resolvedMap = resolution.results;
        primaryOrgId = resolution.primaryOrgId;
      } catch (err) {
        console.error(`   ❌ [graph:${documentId}] Resolution failed for chunk ${chunk.chunkIndex}:`, err.message || err);
        continue;
      }

      // This chunk's raw entity names -> resolved entity id, used to wire up
      // this chunk's relationships below (endpoints must resolve within the
      // same chunk's extraction pass, per the extractor's own filtering).
      const nameToEntityId = new Map();

      for (const draft of drafts) {
        const resolved = resolvedMap.get(draft.name.toLowerCase());
        if (!resolved) continue;

        if (resolved.isNew) entitiesCreated += 1;
        else entitiesMatched += 1;

        nameToEntityId.set(draft.name.toLowerCase(), resolved.entityId);

        await prisma.entityMention.create({
          data: { entityId: resolved.entityId, documentId, chunkId: chunk.id, mentionText: draft.name },
        });
        await prisma.entity.update({
          where: { id: resolved.entityId },
          data: { mentionCount: { increment: 1 } },
        });

        try {
          await prisma.entityDocument.create({
            data: { entityId: resolved.entityId, documentId, confidence: resolved.confidence },
          });
          await prisma.entity.update({
            where: { id: resolved.entityId },
            data: { documentCount: { increment: 1 } },
          });
        } catch (err) {
          // Unique constraint (entityId, documentId) already exists — this
          // entity was already linked to this document by an earlier chunk.
        }
      }

      for (const r of relationships) {
        const sourceId = nameToEntityId.get(r.source.toLowerCase());
        const targetId = nameToEntityId.get(r.target.toLowerCase());
        if (!sourceId || !targetId || sourceId === targetId) continue;

        await prisma.relationship.create({
          data: {
            projectId,
            sourceEntityId: sourceId,
            targetEntityId: targetId,
            relation: r.relation,
            description: r.description,
            documentId,
            chunkId: chunk.id,
            confidence: 1.0,
          },
        });
        relationshipsCreated += 1;
      }
    }

    // One extra pass over this document's full (already-committed) entity/
    // relationship set — per-chunk extraction above can never connect facts
    // stated in different chunks, so without this the graph stays a literal
    // transcription of individual sentences rather than a synthesized view
    // of the document. Runs after everything else is committed so it has
    // the complete picture to reason over.
    let insightsCreated = 0;
    try {
      const result = await synthesizeDocumentInsights(documentId, projectId, prisma, openai);
      insightsCreated = result.insightsCreated || 0;
    } catch (err) {
      console.error(`   ❌ [graph:${documentId}] Insight synthesis failed:`, err.message || err);
    }

    await prisma.graphExtractionLog.update({
      where: { documentId },
      data: {
        status: "ready",
        completedAt: new Date(),
        errorMessage: skippedForCap > 0 ? `Skipped ${skippedForCap} chunk(s) beyond the ${CHUNK_CAP}-chunk cap` : null,
      },
    });

    console.log(
      `✅ [graph:${documentId}] Done — ${entitiesCreated} new entities, ${entitiesMatched} matched, ` +
      `${relationshipsCreated} relationships, ${insightsCreated} inferred insights`
    );
  } catch (err) {
    console.error(`❌ Graph job failed (doc ${documentId}):`, err?.message || err);
    try {
      await prisma.graphExtractionLog.update({
        where: { documentId },
        data: { status: "error", errorMessage: String(err?.message || err).slice(0, 2000), completedAt: new Date() },
      });
    } catch (updateErr) {
      console.error(`❌ Failed to record graph job failure (doc ${documentId}):`, updateErr.message);
    }
  }
}

// Batch-generates graphs for every document in a project that doesn't
// already have a ready one. Runs documents SEQUENTIALLY, not in parallel —
// mirrors the desktop's explicit choice, avoiding recreating decision 1's
// (per-entity-call) contention by stacking N documents' own internal
// chunk-extraction concurrency on top of each other. This is its own worker
// job (rather than the API route blocking on the full batch) because of this
// repo's request-timeout constraints; the frontend polls per-document status
// the same way it already does for single-document generation.
export async function processGraphBatchJob(job) {
  const { projectId } = job;
  if (!projectId) return;

  try {
    const docs = await prisma.document.findMany({
      where: { projectId },
      select: { id: true },
    });

    for (const doc of docs) {
      const log = await prisma.graphExtractionLog.findUnique({ where: { documentId: doc.id } });
      if (log?.status === "ready") continue;
      await processGraphJob({ documentId: doc.id, projectId });
    }
  } catch (err) {
    console.error(`❌ Graph batch job failed (project ${projectId}):`, err?.message || err);
  }
}
