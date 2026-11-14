// src/app/api/slide-decks/[deckId]/talking-points/pdf/route.js
// export-talking-points-pdf — queues a `talking-points-pdf` job: the
// worker's headless Chromium renders buildTalkingPointsPdfHtml() with
// page.pdf() (desktop: printToPDF), so the download is a real PDF. The
// client polls GET …/jobs/[jobId], then downloads …/jobs/[jobId]/file.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { loadTalkingPoints } from "@/lib/slides/talkingPointsServer";
import { findActiveJob, startMediaJob } from "@/lib/slides/deckServer";
import { deckFromRequest, ok, fail, serverError } from "@/lib/slides/routeUtils";

export async function POST(req, { params }) {
  try {
    const ctx = await deckFromRequest(params);
    if (ctx.response) return ctx.response;
    const { deckId, outline } = ctx;
    const points = await loadTalkingPoints(prisma, deckId);
    if (!outline.slides.some((s) => points[s.id]?.html)) return fail("Generate talking points first.", 409);
    if (await findActiveJob(prisma, deckId, ["talking-points-pdf"])) return fail("The PDF is already being made.", 409);
    const job = await startMediaJob(prisma, { deckId, kind: "talking-points-pdf" });
    return ok({ jobId: job.id });
  } catch (err) {
    return serverError("export-talking-points-pdf", err, "Could not create the PDF.");
  }
}
