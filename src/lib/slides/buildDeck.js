// src/lib/slides/buildDeck.js
// Orchestrator: takes a validated outline (outline.js) and renders an actual
// .pptx buffer using the layout builders + theme.
//
// Ported from electron/slides/buildDeck.js, with the one change the feature
// spec calls for: the final step returns a Buffer (`pres.write("nodebuffer")`)
// instead of writing to local disk (`pres.writeFile`) — this repo has no
// filesystem to persist to. Uploading that buffer to S3 is deliberately kept
// OUT of this function (see uploadDeckToS3 below) so buildDeck stays a pure,
// testable outline->buffer transform; every call site (3 worker jobs + the 7
// synchronous mutation routes) uses the same uploadDeckToS3 helper afterward
// instead of duplicating a PutObjectCommand at each one.

import pptxgen from "pptxgenjs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { resolveTheme, SLIDE_W, SLIDE_H, MARGIN } from "./theme.js";
import { LAYOUT_BUILDERS } from "./layouts.js";

const s3 = new S3Client({
  requestHandler: new NodeHttpHandler({ connectionTimeout: 5000, requestTimeout: 60000 }),
});

// Draws a brand-kit logo in the bottom-right corner of a slide, sized from
// its real aspect ratio so a non-square logo is never squashed into a fixed
// box. Applied uniformly after every slide type (not just title/section/
// closing) via buildDeck's own loop below, so this needs zero changes to
// layouts.js's per-type builders. `logo.path` is an S3 HTTPS URL here (not a
// local file path) — pptxgenjs fetches http(s) `path` values itself.
function drawBrandLogo(slide, logo) {
  const maxH = 0.55;
  const maxW = 1.8;
  let w = maxH;
  let h = maxH;
  if (logo.width && logo.height) {
    const ratio = logo.width / logo.height;
    if (ratio >= 1) {
      w = Math.min(maxW, maxH * ratio);
      h = w / ratio;
    } else {
      h = maxH;
      w = h * ratio;
    }
  }
  slide.addImage({ path: logo.path, x: SLIDE_W - MARGIN - w, y: SLIDE_H - MARGIN - h, w, h });
}

// `outline.brandKit` (optional) — `{ colors, logoPath, logoWidth, logoHeight,
// active }`, set at generation time and mutated in place by later structural
// operations (theme-swap can toggle `active` on/off). Living inside the
// outline means every existing operation that round-trips outlineJson
// (reorder, LLM edit, theme-swap) carries it forward automatically, with no
// extra plumbing at each call site.
export async function buildDeck(outline) {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";
  pres.author = "MyTextDigest";
  pres.title = outline.title;

  const brandKit = outline.brandKit && outline.brandKit.active ? outline.brandKit : null;
  const theme = resolveTheme(outline.paletteName, outline.fontPairName, brandKit?.colors);
  if (brandKit?.logoPath) {
    theme.logo = { path: brandKit.logoPath, width: brandKit.logoWidth, height: brandKit.logoHeight };
  }
  // Unconditional (not nested in the logo check above) — a deck styled as
  // "pitch-deck"/"sales" should get the bolder layouts.js look regardless of
  // whether a logo was ever uploaded. Read by layouts.js/theme.js's
  // getStyle().
  theme.presentationType = outline.presentationType || null;

  let built = 0;
  for (let i = 0; i < outline.slides.length; i++) {
    const slideData = outline.slides[i];
    const builder = LAYOUT_BUILDERS[slideData.type];
    if (!builder) {
      // Every SLIDE_TYPES entry (outline.js) must have a matching
      // LAYOUT_BUILDERS entry — a mismatch means a new slide type was
      // registered in one but not the other. Fail loudly instead of
      // silently dropping the slide: a `continue` here would make a
      // half-wired new type manifest only as "fewer slides than expected in
      // the deck," with nothing pointing at the actual cause.
      throw new Error(`No layout builder registered for slide type "${slideData.type}" (slide ${i + 1} of ${outline.slides.length})`);
    }
    // Sequential, not Promise.all: PptxGenJS slide order must match outline
    // order, and icon rasterization is cheap/cached so parallelizing buys
    // little.
    const slide = await builder(pres, slideData, theme, i);
    if (theme.logo && slide) drawBrandLogo(slide, theme.logo);
    built += 1;
  }

  if (built === 0) {
    throw new Error("No slides could be rendered from the generated outline");
  }

  const buffer = await pres.write({ outputType: "nodebuffer" });

  return { buffer, slideCount: built, title: outline.title, paletteName: theme.paletteName };
}

// Shared by every buildDeck call site (3 worker jobs + the synchronous
// theme/reorder/duplicate/delete-slide/restore-slide/layout/content mutation
// routes) so a PutObjectCommand isn't duplicated 10 times over. Callers pass
// the same key back to overwrite (an in-place edit) or a fresh key for a
// brand-new deck — either is fine per the feature spec, this helper doesn't
// care which.
export async function uploadDeckToS3(buffer, key) {
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    })
  );
  return key;
}
