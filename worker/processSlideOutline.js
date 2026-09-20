// worker/processSlideOutline.js
// SQS stage `type: "slide-outline"`: runs generateTextOutline (Step 1 of the
// two-LLM-call outline flow — decision 1 of the feature spec), writes
// SlideDeck.outlineJson (the transient plain-text {title, slides:[{title,
// body}]} shape) + status: "outline_review".
//
// Self-contained (own PrismaClient, catches every internal error itself and
// never throws) — mirrors worker/processFigures.js's shape. This is
// deliberate: worker/index.js's generic recordJobFailure() only knows how to
// update Document.status keyed by `docId`, but a slide-outline failure must
// update SlideDeck.status keyed by `deckId` instead, so this job must never
// let an error escape to that generic handler (see worker/index.js's
// "slide-outline"/"slide-build"/"slide-edit" recordJobFailure exclusions).

import { PrismaClient } from "@prisma/client";
import { generateTextOutline } from "../src/lib/slides/outline.js";
import { getOpenAIForDocument } from "./openai.js";

const prisma = new PrismaClient();

async function markError(deckId, err) {
  console.error(`❌ Slide outline job failed (deck ${deckId}): ${err?.message || err}`);
  try {
    await prisma.slideDeck.update({
      where: { id: deckId },
      data: { status: "error", errorMessage: String(err?.message || err).slice(0, 2000) },
    });
  } catch (updateErr) {
    console.error(`❌ Failed to record slide-outline error (deck ${deckId}): ${updateErr.message}`);
  }
}

// processSlideOutlineJob({ deckId, docId })
export async function processSlideOutlineJob(job) {
  const { deckId, docId } = job;

  try {
    console.log(`🟪 SLIDE OUTLINE JOB: ${deckId} (doc ${docId})`);

    const [deck, doc, chunks] = await Promise.all([
      prisma.slideDeck.findUnique({ where: { id: deckId } }),
      prisma.document.findUnique({ where: { id: docId } }),
      prisma.chunk.findMany({ where: { documentId: docId }, orderBy: { chunkIndex: "asc" } }),
    ]);

    if (!deck) throw new Error(`SlideDeck ${deckId} not found`);
    if (!doc) throw new Error(`Document ${docId} not found`);
    if (chunks.length === 0) throw new Error(`Document ${docId} has no chunks yet — generation must be gated on chunking having completed`);

    // Both outline calls concatenate Chunk.text ordered by chunkIndex with
    // "\n\n" — never re-reads the raw file, never a summary (decision 2).
    const documentText = chunks.map((c) => c.text || "").join("\n\n");

    const brandKit = deck.brandKitJson || {};
    const openai = await getOpenAIForDocument(docId);

    const outline = await generateTextOutline({
      openai,
      filename: doc.filename || "document",
      documentText,
      customPrompt: deck.customPrompt || "",
      presentationType: brandKit.presentationType || "",
    });

    if (!outline) {
      throw new Error("generateTextOutline returned no usable outline");
    }

    await prisma.slideDeck.update({
      where: { id: deckId },
      data: {
        title: outline.title,
        outlineJson: outline,
        status: "outline_review",
      },
    });

    console.log(`✅ Slide outline job complete: ${deckId} (${outline.slides.length} slides)`);
  } catch (err) {
    await markError(deckId, err);
  }
}
