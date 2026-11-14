// src/app/api/slide-decks/[deckId]/audio/[slideId]/script/route.js
// save-narration-script — hand-edited script, "Keep as is" (`markCurrent`)
// and "The numbers are correct" (`confirmNumbers`).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadTalkingPoints } from "@/lib/slides/talkingPointsServer";
import { saveNarrationScript } from "@/lib/slides/narrationServer";
import { deckFromRequest, fail, serverError } from "@/lib/slides/routeUtils";

export async function PUT(req, { params }) {
  try {
    const ctx = await deckFromRequest(params);
    if (ctx.response) return ctx.response;
    const { slideId } = await params;
    const { script, markCurrent, confirmNumbers } = await req.json().catch(() => ({}));
    const res = await saveNarrationScript(prisma, {
      deckId: ctx.deckId, outline: ctx.outline, points: await loadTalkingPoints(prisma, ctx.deckId),
      slideId, script, markCurrent: !!markCurrent, confirmNumbers: !!confirmNumbers,
    });
    if (!res.success) return fail(res.error, 404);
    return NextResponse.json(res);
  } catch (err) {
    return serverError("save-narration-script", err, "Could not save the script.");
  }
}
