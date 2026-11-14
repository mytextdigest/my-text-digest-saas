// src/app/api/slide-decks/[deckId]/talking-points/generate/route.js
// generate-talking-points — one slide (`slideId`, with its neighbours for
// context) runs here; the whole deck (one long LLM call, often over a
// minute) becomes a `talking-points` job on the media queue and returns
// {jobId} for the client to poll.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { prisma } from "@/lib/prisma";
import { getOpenAIForDocument } from "@/lib/openaiForDocument";
import { generateAndStoreTalkingPoints } from "@/lib/slides/talkingPointsServer";
import { findActiveJob, runInlineJob, startMediaJob } from "@/lib/slides/deckServer";
import { deckFromRequest, ok, fail, serverError, openAiKeyMessage } from "@/lib/slides/routeUtils";

export async function POST(req, { params }) {
  try {
    const ctx = await deckFromRequest(params);
    if (ctx.response) return ctx.response;
    const { deck, outline, deckId } = ctx;
    if (deck.status !== "ready") return fail("Wait for the current edit to finish first.", 409);

    const body = await req.json().catch(() => ({}));
    const single = typeof body.slideId === "string" && body.slideId ? body.slideId : null;
    if (single && !outline.slides.some((s) => s.id === single)) return fail("That slide no longer exists.", 404);

    // One whole-deck generation at a time per deck (a second click while one
    // is running would only race it); a slide can't regenerate during it.
    const active = await findActiveJob(prisma, deckId, ["talking-points"]);
    const busy = single ? active && (!active.slideId || active.slideId === single) : !!active;
    if (busy) return fail("Talking points are already being generated.", 409);

    if (!single) {
      const job = await startMediaJob(prisma, { deckId, kind: "talking-points" });
      return ok({ jobId: job.id });
    }

    try {
      const result = await runInlineJob(prisma, { deckId, kind: "talking-points", slideId: single }, async (job, signal) => {
        const openai = await getOpenAIForDocument(deck.documentId);
        return generateAndStoreTalkingPoints(prisma, { deck, outline, slideId: single, openai, signal });
      });
      return ok({ points: result.points, missing: 0 });
    } catch (err) {
      console.error("❌ Error generating talking points:", err);
      return fail(openAiKeyMessage(err) || err.message || "Couldn't generate talking points.", 500);
    }
  } catch (err) {
    return serverError("generate-talking-points", err, "Couldn't generate talking points.");
  }
}
