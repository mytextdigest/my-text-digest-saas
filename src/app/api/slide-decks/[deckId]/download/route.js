// src/app/api/slide-decks/[deckId]/download/route.js
// save-slide-deck — "Save" becomes a plain browser download of a
// server-generated file (decision 12): redirects to a signed S3 URL with
// `ResponseContentDisposition` set to force `attachment; filename="..."`,
// rather than streaming the object through this route.
//
// Talking points (slide_talking_points) aren't part of the outline the
// stored .pptx was built from, so the download is rendered fresh with them
// written into each slide's speaker notes (plain text — PowerPoint notes
// can't hold formatting), falling back to the outline's own short
// speakerNotes where a slide has none. The rendered copy is written under
// slide-exports/<deckId>/ (removed with the deck). Falls back to the
// stored file for a deck with no editable outline, or if the rebuild fails.
//
// `?format=json` answers {success, url, filename} instead of redirecting,
// so the editor's Export menu can show "Deck saved" or the error.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { buildDeck, uploadDeckToS3 } from "@/lib/slides/buildDeck.js";
import { talkingPointsToPlainText } from "@/lib/slides/talkingPoints";
import { loadTalkingPoints } from "@/lib/slides/talkingPointsServer";
import { slugify, s3SignedGetUrl, exportPrefix } from "@/lib/slides/deckServer";

async function buildWithTalkingPoints(deck) {
  const outline = deck.outlineJson;
  if (!outline || deck.status === "outline_review" || !Array.isArray(outline.slides)) return null;
  const points = await loadTalkingPoints(prisma, deck.id);
  const withNotes = {
    ...outline,
    slides: outline.slides.map((s) => {
      const notes = points[s.id]?.html ? talkingPointsToPlainText(points[s.id].html) : "";
      return notes ? { ...s, speakerNotes: notes } : s;
    }),
  };
  const { buffer } = await buildDeck(withNotes);
  const key = `${exportPrefix(deck.id)}${slugify(deck.title)}.pptx`;
  await uploadDeckToS3(buffer, key);
  return key;
}

export async function GET(req, { params }) {
  const json = new URL(req.url).searchParams.get("format") === "json";
  const failWith = (error, status) => NextResponse.json(json ? { success: false, error } : { error }, { status });
  try {
    const session = await getServerSession();
    if (!session?.user?.email) return failWith("Unauthorized", 401);

    const { deckId } = await params;
    const deck = await prisma.slideDeck.findFirst({
      where: { id: deckId, document: { user: { email: session.user.email } } },
    });
    if (!deck) return failWith("Slide deck not found", 404);

    let key = null;
    try {
      key = await buildWithTalkingPoints(deck);
    } catch (err) {
      console.error("❌ Error building deck with talking points, serving the stored file instead:", err);
    }
    key ||= deck.s3Key;
    if (!key) return failWith("Slide deck has no rendered file yet", 409);

    const filename = `${slugify(deck.title)}.pptx`;
    const url = await s3SignedGetUrl(key, { filename });
    if (json) return NextResponse.json({ success: true, url, filename });
    return NextResponse.redirect(url);
  } catch (err) {
    console.error("download-slide-deck error:", err);
    return failWith("Failed to download slide deck", 500);
  }
}
