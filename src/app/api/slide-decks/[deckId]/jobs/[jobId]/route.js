// src/app/api/slide-decks/[deckId]/jobs/[jobId]/route.js
// Progress of a media-queue job (talking points, narration, PDF, video) —
// polled by src/lib/slidesApi.js where desktop listened for IPC progress
// events. A job that stopped updating long past the worker's watchdog is
// reported as failed so the client stops waiting.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { ACTIVE_JOB_WINDOW_MS, jobToClient, updateJob } from "@/lib/slides/deckServer";
import { deckFromRequest, ok, fail, serverError } from "@/lib/slides/routeUtils";

export async function GET(req, { params }) {
  try {
    const ctx = await deckFromRequest(params, { editable: false });
    if (ctx.response) return ctx.response;
    const { jobId } = await params;
    let job = await prisma.slideDeckJob.findFirst({ where: { id: jobId, deckId: ctx.deckId } });
    if (!job) return fail("Job not found.", 404);
    if ((job.status === "queued" || job.status === "running") && Date.now() - job.updatedAt.getTime() > ACTIVE_JOB_WINDOW_MS) {
      job = (await updateJob(prisma, job.id, { status: "error", error: "The job stopped responding. Please try again." })) || job;
    }
    return ok({ job: jobToClient(job) });
  } catch (err) {
    return serverError("get-slide-job", err, "Could not load the job.");
  }
}
