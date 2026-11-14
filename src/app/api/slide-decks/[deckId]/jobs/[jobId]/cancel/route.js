// src/app/api/slide-decks/[deckId]/jobs/[jobId]/cancel/route.js
// cancel-narration / cancel-deck-video — flips the row to "cancelled"; the
// worker (or the route running it inline) checks between steps and aborts
// its OpenAI / ffmpeg calls. `jobId` "active" with {kind} cancels whatever
// job of that kind is running for the deck.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { deckFromRequest, ok, serverError } from "@/lib/slides/routeUtils";

export async function POST(req, { params }) {
  try {
    const ctx = await deckFromRequest(params, { editable: false });
    if (ctx.response) return ctx.response;
    const { jobId } = await params;
    const body = await req.json().catch(() => ({}));
    const where = jobId === "active"
      ? { deckId: ctx.deckId, kind: String(body.kind || ""), status: { in: ["queued", "running"] } }
      : { id: jobId, deckId: ctx.deckId, status: { in: ["queued", "running"] } };
    await prisma.slideDeckJob.updateMany({ where, data: { status: "cancelled" } });
    return ok();
  } catch (err) {
    return serverError("cancel-slide-job", err, "Could not cancel.");
  }
}
