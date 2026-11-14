// src/app/api/slide-audio/[deckId]/[slideId]/file/route.js
// A slide's narration clip for <audio>: a 302 to a short-lived signed URL
// (spec D6). The page keeps this same-origin URL, so it keeps working across
// reloads; the `v` query (set by loadSlideAudio) changes with the clip.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { s3SignedGetUrl } from "@/lib/slides/deckServer";
import { sessionEmail, fail, serverError } from "@/lib/slides/routeUtils";

export async function GET(req, { params }) {
  try {
    const email = await sessionEmail();
    if (!email) return fail("Unauthorized", 401);
    const { deckId, slideId } = await params;
    const deck = await prisma.slideDeck.findFirst({ where: { id: deckId, document: { user: { email } } }, select: { id: true } });
    if (!deck) return fail("Deck not found.", 404);
    const row = await prisma.slideAudio.findUnique({ where: { deckId_slideId: { deckId, slideId } } });
    if (!row?.s3Key) return fail("This slide has no audio.", 404);
    const url = await s3SignedGetUrl(row.s3Key, { contentType: row.mime || undefined, expiresIn: 3600 });
    return NextResponse.redirect(url);
  } catch (err) {
    return serverError("get-slide-audio-file", err, "Could not load the audio.");
  }
}
