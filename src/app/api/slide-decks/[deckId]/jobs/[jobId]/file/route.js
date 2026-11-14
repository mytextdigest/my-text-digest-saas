// src/app/api/slide-decks/[deckId]/jobs/[jobId]/file/route.js
// The finished file of a talking-points-pdf or deck-video job: a 302 to a
// short-lived signed URL with an attachment disposition (the existing
// download-route pattern), in place of desktop's native save dialog.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { s3SignedGetUrl } from "@/lib/slides/deckServer";
import { deckFromRequest, fail, serverError } from "@/lib/slides/routeUtils";

export async function GET(req, { params }) {
  try {
    const ctx = await deckFromRequest(params, { editable: false });
    if (ctx.response) return ctx.response;
    const { jobId } = await params;
    const job = await prisma.slideDeckJob.findFirst({ where: { id: jobId, deckId: ctx.deckId } });
    const key = job?.status === "done" ? job.result?.s3Key : null;
    if (!key) return fail("That file isn't ready.", 404);
    const url = await s3SignedGetUrl(key, { filename: job.result.filename || key.split("/").pop() });
    return NextResponse.redirect(url);
  } catch (err) {
    return serverError("get-slide-job-file", err, "Could not download the file.");
  }
}
