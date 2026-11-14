// src/app/api/slide-decks/[deckId]/talking-points/route.js
// get-talking-points — the deck's slideId → {html, origin, seconds,
// contentHash, updatedAt} map (slide_talking_points).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { loadTalkingPoints } from "@/lib/slides/talkingPointsServer";
import { deckFromRequest, ok, serverError } from "@/lib/slides/routeUtils";

export async function GET(req, { params }) {
  try {
    const ctx = await deckFromRequest(params, { editable: false });
    if (ctx.response) return ctx.response;
    return ok({ points: await loadTalkingPoints(prisma, ctx.deckId) });
  } catch (err) {
    return serverError("get-talking-points", err, "Could not load talking points.");
  }
}
