// worker/processSlideEdit.js
// SQS stage `type: "slide-edit"`: whole-deck or single-slide AI edit
// (decisions 9-11 of the feature spec), buildDeck() -> S3 upload, status
// reverts to "ready" on ANY failure — NEVER "error" (decision 11). A failed
// edit never touches the last-good outline/rendered file, so
// Download/Preview/Edit must stay fully usable afterward.
//
// Self-contained (own PrismaClient, catches every internal error itself and
// never throws) — see processSlideOutline.js's header comment for why. This
// matters doubly here: even a *timeout* must resolve to "ready", not the
// generic "error" recordJobFailure() would otherwise apply, which is why
// "slide-edit" is also in worker/index.js's recordJobFailure exclusion list.

import { PrismaClient } from "@prisma/client";
import { detectColorIntent, generateWholeDeckEdit, generateSlideEdit, mergeFreeformIntoSlide } from "../src/lib/slides/edit.js";
import { buildDeck, uploadDeckToS3 } from "../src/lib/slides/buildDeck.js";
import { getOpenAIForDocument } from "./openai.js";

const prisma = new PrismaClient();

// Reverts to "ready" unconditionally (decision 11) — outlineJson/s3Key are
// left completely untouched, so the deck the user already has stays fully
// usable. `errorMessage` is still recorded for visibility even though
// status doesn't flip to "error".
async function revertToReady(deckId, err) {
  if (err) console.error(`❌ Slide edit job failed (deck ${deckId}): ${err?.message || err}`);
  try {
    await prisma.slideDeck.update({
      where: { id: deckId },
      data: { status: "ready", errorMessage: err ? String(err?.message || err).slice(0, 2000) : null },
    });
  } catch (updateErr) {
    console.error(`❌ Failed to revert slide-edit status (deck ${deckId}): ${updateErr.message}`);
  }
}

// Whole-deck edits can legitimately change slide count/order (the
// instruction may ask to add/remove/reorganize slides, and validateOutline's
// redundancy filtering can also drop a slide) — freeform data is merged by
// matching `id`, not index, so a slide that survives the edit keeps its
// manual work regardless of where it ends up, and a genuinely NEW slide
// (no matching id) simply keeps the fresh, empty freeform state
// validateSlide already gives it.
function mergeWholeDeckFreeform(preEditSlides, revisedSlides) {
  const byId = new Map(preEditSlides.map((s) => [s.id, s]));
  return revisedSlides.map((slide) => {
    const preEditSlide = byId.get(slide.id);
    return preEditSlide ? mergeFreeformIntoSlide(preEditSlide, slide) : slide;
  });
}

// processSlideEditJob({ deckId, docId, mode: "whole-deck"|"slide", slideIndex, instruction })
export async function processSlideEditJob(job) {
  const { deckId, docId, slideIndex, instruction } = job;
  let mode = job.mode;

  try {
    console.log(`🟪 SLIDE EDIT JOB: ${deckId} (mode ${mode})`);

    const deck = await prisma.slideDeck.findUnique({ where: { id: deckId } });
    if (!deck) throw new Error(`SlideDeck ${deckId} not found`);

    const outline = deck.outlineJson;
    if (!outline || !Array.isArray(outline.slides)) {
      throw new Error(`SlideDeck ${deckId} has no built outline to edit`);
    }

    const chunks = await prisma.chunk.findMany({ where: { documentId: docId }, orderBy: { chunkIndex: "asc" } });
    const documentText = chunks.map((c) => c.text || "").join("\n\n");
    const openai = await getOpenAIForDocument(docId);

    // Decision 9: a single-slide edit can never change deck-wide color/
    // palette/font — an instruction that asks for one always escalates to a
    // whole-deck edit instead, so the whole deck stays visually cohesive
    // rather than one slide breaking from the shared palette.
    if (mode === "slide" && detectColorIntent(instruction)) {
      mode = "whole-deck";
    }

    let revisedOutline = null;

    if (mode === "slide") {
      const revisedSlide = await generateSlideEdit({ openai, outline, slideIndex, instruction, documentText });
      if (revisedSlide) {
        const preEditSlide = outline.slides[slideIndex];
        const merged = mergeFreeformIntoSlide(preEditSlide, revisedSlide);
        revisedOutline = {
          ...outline,
          slides: outline.slides.map((s, i) => (i === slideIndex ? merged : s)),
        };
      }
    } else {
      const revised = await generateWholeDeckEdit({ openai, outline, instruction, documentText });
      if (revised) {
        revisedOutline = {
          ...outline,
          title: revised.title,
          paletteName: revised.paletteName,
          fontPairName: revised.fontPairName,
          slides: mergeWholeDeckFreeform(outline.slides, revised.slides),
        };
      }
    }

    if (!revisedOutline) {
      // generateSlideEdit/generateWholeDeckEdit already reject a rogue type
      // change or unparseable response outright (return null) rather than
      // partially applying it — nothing to build, just revert status.
      await revertToReady(deckId, new Error("Edit produced no usable revision"));
      return;
    }

    const { buffer, slideCount } = await buildDeck(revisedOutline);
    // Overwrite the same key — deck.s3Key was already assigned at build
    // time; keeping it stable means any cached signed download URL still
    // serves fresh content instead of a stale object.
    await uploadDeckToS3(buffer, deck.s3Key);

    await prisma.slideDeck.update({
      where: { id: deckId },
      data: {
        title: revisedOutline.title,
        theme: revisedOutline.paletteName,
        slideCount,
        outlineJson: revisedOutline,
        status: "ready",
        errorMessage: null,
      },
    });

    console.log(`✅ Slide edit job complete: ${deckId}`);
  } catch (err) {
    await revertToReady(deckId, err);
  }
}
