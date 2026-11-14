// src/app/api/slide-decks/[deckId]/talking-points/[slideId]/route.js
// save-talking-points — one slide's hand-edited points (`html`) and/or
// `markCurrent` ("Keep as is" on the out-of-date banner).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { saveTalkingPoints } from "@/lib/slides/talkingPointsServer";
import { deckFromRequest, fail, serverError } from "@/lib/slides/routeUtils";
import { NextResponse } from "next/server";

export async function PUT(req, { params }) {
  try {
    const ctx = await deckFromRequest(params);
    if (ctx.response) return ctx.response;
    const { slideId } = await params;
    const body = await req.json().catch(() => ({}));
    const res = await saveTalkingPoints(prisma, {
      deckId: ctx.deckId, outline: ctx.outline, slideId, html: body.html, markCurrent: !!body.markCurrent,
    });
    if (!res.success) return fail(res.error, 404);
    return NextResponse.json(res);
  } catch (err) {
    return serverError("save-talking-points", err, "Could not save talking points.");
  }
}
