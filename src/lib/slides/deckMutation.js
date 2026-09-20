// src/lib/slides/deckMutation.js
// Shared shape for every SYNCHRONOUS slide-deck mutation route (theme,
// reorder, duplicate, delete-slide, restore-slide, layout, content patch):
// load the deck row (scoped to the requesting user, so a tampered `deckId`
// 404s) -> parse outlineJson -> mutate the in-memory outline -> rebuild the
// .pptx -> overwrite the same S3 key -> write back outlineJson + refreshed
// title/theme/slideCount -> return the updated deck + outline. Desktop's
// synchronous IPC handlers (update-slide-deck-theme, reorder, duplicate,
// etc.) all follow this exact same pattern inline; this is that pattern
// factored out once instead of duplicated across 7 route files.
//
// Takes `prisma` as an explicit param (not an internal singleton import) —
// same dependency-injection style as src/lib/figureChunk.js — so this stays
// usable from a worker context too, not just a Next.js route.

import { buildDeck, uploadDeckToS3 } from "./buildDeck.js";

// `mutateOutline(outline, deck)` may be async. It returns either the
// mutated outline directly, or `{ outline, extra }` when the route needs to
// hand extra data back to the client alongside the updated deck (e.g.
// delete-slide's `removedSlide`, for client-side undo).
export async function withDeckRebuild({ prisma, deckId, userEmail, mutateOutline }) {
  const deck = await prisma.slideDeck.findFirst({
    where: { id: deckId, document: { user: { email: userEmail } } },
  });
  if (!deck) return { ok: false, status: 404, error: "Slide deck not found" };

  const outline = deck.outlineJson;
  if (!outline || !Array.isArray(outline.slides)) {
    return { ok: false, status: 409, error: "Slide deck has no built outline yet" };
  }

  const result = await mutateOutline(outline, deck);
  const mutatedOutline = result && result.outline ? result.outline : result;
  const extra = result && result.outline ? result.extra : undefined;

  const { buffer, slideCount } = await buildDeck(mutatedOutline);
  // Overwrite the same key, not a fresh one — so any cached signed download
  // URL keeps serving fresh content instead of a stale object (the spec
  // explicitly requires being consistent about this, either scheme is fine
  // as long as every route agrees).
  await uploadDeckToS3(buffer, deck.s3Key);

  const updated = await prisma.slideDeck.update({
    where: { id: deckId },
    data: {
      outlineJson: mutatedOutline,
      title: mutatedOutline.title,
      theme: mutatedOutline.paletteName,
      slideCount,
    },
    // Keep the parent document's userId/projectId attached on every mutation
    // response, not just the initial GET — the editor's Uploads panel needs
    // both for every presigned-upload call, and it only ever reads `deck`
    // from whatever response last updated it (this mutation's result, or a
    // fresh GET), so dropping the relation here would silently break that
    // panel after the first theme/reorder/layout/etc. edit.
    include: { document: { select: { id: true, userId: true, projectId: true } } },
  });

  return { ok: true, deck: updated, outline: mutatedOutline, extra };
}
