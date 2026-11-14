// src/lib/slides/talkingPointsServer.js
// Port of desktop electron/main.js's talking-points block
// (TALKING_POINTS_ROADMAP.md): loadTalkingPoints, the save / generate
// handlers, and the deck-delete / duplicate-slide hooks. Shared by the
// routes (save, one slide's generation) and the worker (whole-deck
// generation, PDF export).
//
// Stored in slide_talking_points, keyed by slide id, never on outlineJson —
// these functions only ever read the outline, so nothing here races the
// read-buildDeck-write mutation routes (or an in-flight AI edit).

import { slideContentHash, sanitizeTalkingPointsHtml, generateTalkingPoints } from "./talkingPoints.js";
import { documentTextFor } from "./deckServer.js";

export async function loadTalkingPoints(prisma, deckId) {
  const rows = await prisma.slideTalkingPoint.findMany({ where: { deckId } });
  const points = {};
  rows.forEach((r) => {
    points[r.slideId] = {
      html: r.html,
      origin: r.origin,
      seconds: r.seconds,
      contentHash: r.contentHash,
      updatedAt: r.updatedAt,
    };
  });
  return points;
}

// Saves one slide's hand-edited points (`html`, marks origin 'user' but keeps
// the stored content_hash — editing the wording isn't the same as confirming
// it still matches a changed slide) and/or `markCurrent` ("Keep as is" on the
// out-of-date banner: re-stamps content_hash from the slide's current content).
export async function saveTalkingPoints(prisma, { deckId, outline, slideId, html, markCurrent }) {
  const slide = outline.slides.find((s) => s.id === slideId);
  if (!slide) return { success: false, error: "That slide no longer exists." };

  const existing = await prisma.slideTalkingPoint.findUnique({ where: { deckId_slideId: { deckId, slideId } } });
  const hasHtml = typeof html === "string";
  const nextHtml = hasHtml ? sanitizeTalkingPointsHtml(html) : (existing?.html || "");
  const nextOrigin = hasHtml ? "user" : (existing?.origin || "user");
  const nextHash = markCurrent || !existing ? slideContentHash(slide) : existing.contentHash;

  await prisma.slideTalkingPoint.upsert({
    where: { deckId_slideId: { deckId, slideId } },
    create: { deckId, slideId, html: nextHtml, origin: nextOrigin, seconds: null, contentHash: nextHash },
    update: { html: nextHtml, origin: nextOrigin, contentHash: nextHash },
  });
  return { success: true, points: await loadTalkingPoints(prisma, deckId) };
}

// Generates talking points for the whole deck (one LLM call, so transitions
// flow across slides) or for one slide (`slideId`, with its neighbours for
// context). Results are matched back by slide id against a FRESH read of the
// outline, and stamped with the hash of the content the model actually saw,
// so a slide edited mid-generation correctly comes back flagged as out of
// date. Returns {points, missing} or throws a user-facing error.
export async function generateAndStoreTalkingPoints(prisma, { deck, outline, slideId, openai, signal }) {
  const single = typeof slideId === "string" && slideId;
  const slideIndex = single ? outline.slides.findIndex((s) => s.id === slideId) : undefined;
  if (single && slideIndex < 0) throw new Error("That slide no longer exists.");

  const documentText = await documentTextFor(prisma, deck.documentId);
  const results = await generateTalkingPoints({ openai, outline, documentText, slideIndex, signal });

  const fresh = await prisma.slideDeck.findUnique({ where: { id: deck.id }, select: { outlineJson: true } });
  const liveIds = new Set((fresh?.outlineJson?.slides || outline.slides).map((s) => s.id));
  const writes = [];
  results.forEach(({ html, seconds }, idx) => {
    const seen = outline.slides[idx];
    if (!seen?.id || !liveIds.has(seen.id)) return; // deleted mid-generation
    const contentHash = slideContentHash(seen);
    writes.push(prisma.slideTalkingPoint.upsert({
      where: { deckId_slideId: { deckId: deck.id, slideId: seen.id } },
      create: { deckId: deck.id, slideId: seen.id, html, origin: "ai", seconds, contentHash },
      update: { html, origin: "ai", seconds, contentHash },
    }));
  });
  await prisma.$transaction(writes);

  const missing = single ? 0 : outline.slides.length - results.size;
  return { points: await loadTalkingPoints(prisma, deck.id), missing };
}

// duplicate-slide: talking points live outside the outline, keyed by slide
// id — carry them over to the clone's fresh id too.
export async function copyTalkingPoints(prisma, deckId, fromSlideId, toSlideId) {
  const row = await prisma.slideTalkingPoint.findUnique({ where: { deckId_slideId: { deckId, slideId: fromSlideId } } });
  if (!row) return;
  const { html, origin, seconds, contentHash } = row;
  await prisma.slideTalkingPoint.upsert({
    where: { deckId_slideId: { deckId, slideId: toSlideId } },
    create: { deckId, slideId: toSlideId, html, origin, seconds, contentHash },
    update: { html, origin, seconds, contentHash },
  });
}

export async function deleteDeckTalkingPoints(prisma, deckId) {
  await prisma.slideTalkingPoint.deleteMany({ where: { deckId } });
}
