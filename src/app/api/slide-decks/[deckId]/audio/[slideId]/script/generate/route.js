// src/app/api/slide-decks/[deckId]/audio/[slideId]/script/generate/route.js
// generate-narration-script — writes one slide's script from its talking
// points (with the number check's single retry), inline.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { prisma } from "@/lib/prisma";
import { getOpenAIForDocument } from "@/lib/openaiForDocument";
import { loadTalkingPoints } from "@/lib/slides/talkingPointsServer";
import { writeScripts, loadSlideAudio } from "@/lib/slides/narrationServer";
import { findActiveJob, runInlineJob } from "@/lib/slides/deckServer";
import { deckFromRequest, ok, fail, serverError, openAiKeyMessage } from "@/lib/slides/routeUtils";

export async function POST(req, { params }) {
  try {
    const ctx = await deckFromRequest(params);
    if (ctx.response) return ctx.response;
    const { deck, outline, deckId } = ctx;
    const { slideId } = await params;
    if (deck.status !== "ready") return fail("Wait for the current edit to finish first.", 409);
    const index = outline.slides.findIndex((s) => s.id === slideId);
    if (index < 0) return fail("That slide no longer exists.", 404);
    if (await findActiveJob(prisma, deckId, ["narration"])) return fail("Narration is already being generated.", 409);

    try {
      await runInlineJob(prisma, { deckId, kind: "narration", slideId }, async (job, signal) => {
        const openai = await getOpenAIForDocument(deck.documentId);
        await writeScripts(prisma, { deckId, outline, points: await loadTalkingPoints(prisma, deckId), indices: [index], openai, signal });
      });
      return ok({ audio: await loadSlideAudio(prisma, deckId) });
    } catch (err) {
      if (err.cancelled) return fail("Cancelled.", 409, { cancelled: true });
      console.error("❌ Error writing narration script:", err);
      return fail(openAiKeyMessage(err) || err.message || "Couldn't write the script.", 500);
    }
  } catch (err) {
    return serverError("generate-narration-script", err, "Couldn't write the script.");
  }
}
