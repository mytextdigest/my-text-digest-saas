// src/app/api/slide-decks/[deckId]/audio/generate/route.js
// generate-narration-audio — AI narration for one slide (`slideId`) or the
// whole deck (see planNarrationAudio for which slides a run touches). One
// slide whose script already exists is voiced here; anything that needs
// scripts written first, or the whole deck, becomes a `narration` job on
// the media queue and returns {jobId}.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOpenAIForDocument } from "@/lib/openaiForDocument";
import { loadTalkingPoints } from "@/lib/slides/talkingPointsServer";
import { planNarrationAudio, generateNarrationAudio, friendlyTtsError, loadSlideAudio } from "@/lib/slides/narrationServer";
import { findActiveJob, runInlineJob, startMediaJob } from "@/lib/slides/deckServer";
import { deckFromRequest, ok, fail, serverError } from "@/lib/slides/routeUtils";

export async function POST(req, { params }) {
  try {
    const ctx = await deckFromRequest(params);
    if (ctx.response) return ctx.response;
    const { deck, outline, deckId } = ctx;
    if (deck.status !== "ready") return fail("Wait for the current edit to finish first.", 409);
    if (await findActiveJob(prisma, deckId, ["narration"])) return fail("Narration is already being generated.", 409);

    const body = await req.json().catch(() => ({}));
    const slideId = typeof body.slideId === "string" && body.slideId ? body.slideId : undefined;
    const rewriteScript = !!body.rewriteScript;
    const redoAll = !!body.redoAll;
    const points = await loadTalkingPoints(prisma, deckId);
    const plan = await planNarrationAudio(prisma, { deckId, outline, points, slideId, rewriteScript, redoAll });
    if (plan.error) return fail(plan.error, 404);
    if (plan.skipped) return ok({ audio: plan.audio, generated: 0, failed: 0, skipped: true });

    if (!plan.single || plan.needsScript.length) {
      const phase = plan.needsScript.length ? "script" : "audio";
      const total = plan.needsScript.length || plan.targets.length;
      const job = await startMediaJob(prisma, {
        deckId, kind: "narration", slideId: slideId || null, payload: { rewriteScript, redoAll }, phase, total,
      });
      return ok({ jobId: job.id, phase, total });
    }

    let result;
    try {
      result = await runInlineJob(prisma, { deckId, kind: "narration", slideId }, async (job, signal) => {
        const openai = await getOpenAIForDocument(deck.documentId);
        return generateNarrationAudio(prisma, { deckId, outline, points, plan, openai, signal });
      });
    } catch (err) {
      console.error("❌ Error generating narration:", err);
      return fail(friendlyTtsError(err.message), 500, { audio: await loadSlideAudio(prisma, deckId) });
    }
    // A refused or failed run is a result (desktop's IPC shape), not a
    // transport error — the client reads `success` / `error`.
    return NextResponse.json(result);
  } catch (err) {
    return serverError("generate-narration-audio", err, "Couldn't create the narration.");
  }
}
