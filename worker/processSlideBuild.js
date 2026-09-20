// worker/processSlideBuild.js
// SQS stage `type: "slide-build"`: runs generateStructuredOutline (Step 2)
// on the user-approved outline, optionally attaches AI-generated hero
// images (bounded concurrency, per-image failure isolated — never blocks
// the rest of the deck), then buildDeck() -> S3 upload, status: "ready" (or
// "error" on failure — decision 11 only protects slide-edit failures, not
// build failures, since a build failure has no prior "ready" deck to
// protect).
//
// Self-contained (own PrismaClient, catches every internal error itself and
// never throws) — see processSlideOutline.js's header comment for why.

import { PrismaClient } from "@prisma/client";
import pLimit from "p-limit";
import { generateStructuredOutline, buildDeckIntent } from "../src/lib/slides/outline.js";
import { resolveTheme } from "../src/lib/slides/theme.js";
import {
  IMAGE_ELIGIBLE_TYPES, buildDeckSubjectLine, buildImagePrompt, pickPeopleAllowedIndices,
  generateSlideImageBuffer, DEFAULT_GENERATE_IMAGE_SIZE,
} from "../src/lib/slides/imagePrompt.js";
import { buildDeck, uploadDeckToS3 } from "../src/lib/slides/buildDeck.js";
import { uploadImageBufferToS3, resolveSlideImageUrl } from "../src/lib/slides/imageStorage.js";
import { getOpenAIForDocument } from "./openai.js";

const prisma = new PrismaClient();
const IMAGE_CONCURRENCY = 2;

async function markError(deckId, err) {
  console.error(`❌ Slide build job failed (deck ${deckId}): ${err?.message || err}`);
  try {
    await prisma.slideDeck.update({
      where: { id: deckId },
      data: { status: "error", errorMessage: String(err?.message || err).slice(0, 2000) },
    });
  } catch (updateErr) {
    console.error(`❌ Failed to record slide-build error (deck ${deckId}): ${updateErr.message}`);
  }
}

// Which slides get an AI hero image, per the approved imageMode
// ("important" | "none" | "manual" — outline.js's IMAGE_MODES):
// "important" auto-picks IMAGE_ELIGIBLE_TYPES slides (title/section_header/
// closing/quote); "manual" only the user's own picks from outline review
// (already remapped onto the post-filter slide array by OutlineReview.jsx
// before confirm-outline persists them); "none" generates nothing.
function eligibleSlideIndices(outline, imageMode, imageSlideIndices) {
  if (imageMode === "none") return [];
  if (imageMode === "manual") {
    return Array.isArray(imageSlideIndices) ? imageSlideIndices.filter((i) => outline.slides[i]) : [];
  }
  return outline.slides.reduce((acc, slide, i) => {
    if (IMAGE_ELIGIBLE_TYPES.has(slide.type)) acc.push(i);
    return acc;
  }, []);
}

async function attachGeneratedImages(outline, { openai, deckId, imageMode, imageSlideIndices, presentationType, customPrompt, theme }) {
  const indices = eligibleSlideIndices(outline, imageMode, imageSlideIndices);
  if (indices.length === 0) return outline;

  const eligible = indices.map((index) => ({ slide: outline.slides[index], index }));
  const deckSubject = buildDeckSubjectLine(outline);
  const allowPeopleIndices = pickPeopleAllowedIndices(eligible);
  const limit = pLimit(IMAGE_CONCURRENCY);

  await Promise.all(eligible.map(({ slide, index }) => limit(async () => {
    try {
      const prompt = buildImagePrompt(slide, theme, presentationType, customPrompt, deckSubject, allowPeopleIndices.has(index));
      const buffer = await generateSlideImageBuffer(openai, prompt, DEFAULT_GENERATE_IMAGE_SIZE);
      const key = `slides/${deckId}/hero-${index}.png`;
      await uploadImageBufferToS3(buffer, key, "image/png");
      const url = await resolveSlideImageUrl(key);
      outline.slides[index].heroImage = { src: url };
    } catch (err) {
      // Per-image failure isolated — never blocks the rest of the deck
      // (a slide simply renders without its hero image).
      console.error(`⚠️  Hero image generation failed (deck ${deckId}, slide ${index}): ${err.message || err}`);
    }
  })));

  return outline;
}

// processSlideBuildJob({ deckId, docId })
export async function processSlideBuildJob(job) {
  const { deckId, docId } = job;

  try {
    console.log(`🟪 SLIDE BUILD JOB: ${deckId} (doc ${docId})`);

    const [deck, doc] = await Promise.all([
      prisma.slideDeck.findUnique({ where: { id: deckId } }),
      prisma.document.findUnique({ where: { id: docId } }),
    ]);
    if (!deck) throw new Error(`SlideDeck ${deckId} not found`);
    if (!doc) throw new Error(`Document ${docId} not found`);

    // outlineJson at this point is the user-approved transient shape
    // ({title, slides:[{title,body}], imageMode, imageSlideIndices}) written
    // by the confirm-outline route — never re-sent the source document from
    // here on (decision 8): structuring only reorganizes/reformats material
        // already in the approved outline.
    const approved = deck.outlineJson;
    if (!approved || !Array.isArray(approved.slides)) {
      throw new Error(`SlideDeck ${deckId} has no approved outline to structure`);
    }

    const brandKitInput = deck.brandKitJson || {};
    const presentationType = brandKitInput.presentationType || "";
    const customPrompt = deck.customPrompt || "";
    const visualStyle = brandKitInput.visualStyle || "";
    const imageMode = approved.imageMode || "important";

    const openai = await getOpenAIForDocument(docId);

    const structured = await generateStructuredOutline({
      openai,
      title: approved.title,
      slides: approved.slides,
      excludePaletteNames: [],
      presentationType,
      customPrompt,
      visualStyle,
    });

    if (!structured) {
      throw new Error("generateStructuredOutline returned no usable outline");
    }

    // deckIntent/brandKit live INSIDE outlineJson from here on (never hoisted
    // into separate DB columns) — every later operation that round-trips
    // outlineJson (reorder, edit, theme-swap, layout patch) carries them
    // forward with zero extra plumbing.
    const deckIntent = buildDeckIntent({
      presentationType,
      customPrompt,
      generateImages: imageMode !== "none",
      visualStyle,
      imageMode,
    });
    structured.deckIntent = deckIntent;
    structured.presentationType = deckIntent.presentationType;

    const hasBrandColors = !!(brandKitInput.colors?.primary && brandKitInput.colors?.secondary && brandKitInput.colors?.accent);
    structured.brandKit = (hasBrandColors || brandKitInput.logoKey)
      ? {
          colors: hasBrandColors ? brandKitInput.colors : null,
          logoPath: brandKitInput.logoKey ? await resolveSlideImageUrl(brandKitInput.logoKey) : null,
          logoWidth: brandKitInput.logoWidth || null,
          logoHeight: brandKitInput.logoHeight || null,
          active: true,
        }
      : null;

    const theme = resolveTheme(structured.paletteName, structured.fontPairName, structured.brandKit?.colors);
    theme.presentationType = structured.presentationType;

    if (imageMode !== "none") {
      await attachGeneratedImages(structured, {
        openai, deckId, imageMode, imageSlideIndices: approved.imageSlideIndices,
        presentationType, customPrompt, theme,
      });
    }

    const { buffer, slideCount } = await buildDeck(structured);
    const s3Key = `decks/${doc.userId}/${doc.projectId || "no-project"}/${docId}/${deckId}.pptx`;
    await uploadDeckToS3(buffer, s3Key);

    await prisma.slideDeck.update({
      where: { id: deckId },
      data: {
        title: structured.title,
        theme: structured.paletteName,
        slideCount,
        s3Key,
        outlineJson: structured,
        status: "ready",
        errorMessage: null,
      },
    });

    console.log(`✅ Slide build job complete: ${deckId} (${slideCount} slides)`);
  } catch (err) {
    await markError(deckId, err);
  }
}
