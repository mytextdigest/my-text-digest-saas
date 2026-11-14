// src/app/api/slide-decks/[deckId]/audio/route.js
// get-slide-audio — {audio, settings}: the slideId → clip/script map (each
// clip's `url` is GET /api/slide-audio/[deckId]/[slideId]/file) and the
// deck's voice / tone / pause settings.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { loadSlideAudio, loadSettings } from "@/lib/slides/narrationServer";
import { deckFromRequest, ok, serverError } from "@/lib/slides/routeUtils";

export async function GET(req, { params }) {
  try {
    const ctx = await deckFromRequest(params, { editable: false });
    if (ctx.response) return ctx.response;
    return ok({ audio: await loadSlideAudio(prisma, ctx.deckId), settings: await loadSettings(prisma, ctx.deckId) });
  } catch (err) {
    return serverError("get-slide-audio", err, "Could not load narration.");
  }
}
