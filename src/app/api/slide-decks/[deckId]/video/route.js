// src/app/api/slide-decks/[deckId]/video/route.js
// export-deck-video — queues a `deck-video` job: the worker draws each slide
// in headless Chromium (/present/frame) and encodes the MP4 with ffmpeg,
// updating the job row's phase/done/total ("Drawing slides 3/10",
// "Encoding video 5/10"). The client polls, then downloads
// …/jobs/[jobId]/file.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { findActiveJob, startMediaJob } from "@/lib/slides/deckServer";
import { deckFromRequest, ok, fail, serverError } from "@/lib/slides/routeUtils";

export async function POST(req, { params }) {
  try {
    const ctx = await deckFromRequest(params);
    if (ctx.response) return ctx.response;
    const { deck, outline, deckId } = ctx;
    if (deck.status !== "ready") return fail("Wait for the current edit to finish first.", 409);
    if (!outline.slides.length) return fail("This deck has no slides.", 409);
    if (await findActiveJob(prisma, deckId, ["deck-video"])) return fail("A video is already being made.", 409);
    const job = await startMediaJob(prisma, { deckId, kind: "deck-video" });
    return ok({ jobId: job.id });
  } catch (err) {
    return serverError("export-deck-video", err, "Could not create the video.");
  }
}
