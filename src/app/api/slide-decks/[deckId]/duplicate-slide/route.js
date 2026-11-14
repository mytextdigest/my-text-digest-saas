// src/app/api/slide-decks/[deckId]/duplicate-slide/route.js
// duplicate-slide — synchronous clone, inserted immediately after the
// source slide with a fresh id (freeform elements get fresh ids too, so a
// later per-element operation on the duplicate never collides with the
// original's). Talking points and the narration clip live outside the
// outline, keyed by slide id, so they're copied to the clone's new id (the
// clip's S3 object too, so replacing one never touches the other).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { withDeckRebuild } from "@/lib/slides/deckMutation.js";
import { copyTalkingPoints } from "@/lib/slides/talkingPointsServer";
import { copySlideAudio } from "@/lib/slides/narrationServer";

export async function POST(req, { params }) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { deckId } = await params;
    const body = await req.json().catch(() => ({}));
    const slideIndex = Number(body.slideIndex);
    let copied = null; // {from, to} slide ids

    const result = await withDeckRebuild({
      prisma, deckId, userEmail: session.user.email,
      mutateOutline: (outline) => {
        const source = outline.slides[slideIndex];
        if (!source) return outline;
        const clone = {
          ...structuredClone(source),
          id: crypto.randomUUID(),
          elements: (source.elements || []).map((el) => ({ ...el, id: crypto.randomUUID() })),
        };
        outline.slides.splice(slideIndex + 1, 0, clone);
        if (source.id) copied = { from: source.id, to: clone.id };
        return outline;
      },
    });

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    if (copied) {
      try {
        await copyTalkingPoints(prisma, deckId, copied.from, copied.to);
        await copySlideAudio(prisma, deckId, copied.from, copied.to);
      } catch (err) {
        console.error("⚠️  Could not copy talking points / narration to the duplicated slide:", err.message || err);
      }
    }
    return NextResponse.json({ success: true, deck: result.deck, outline: result.outline });
  } catch (err) {
    console.error("duplicate-slide error:", err);
    return NextResponse.json({ error: "Failed to duplicate slide" }, { status: 500 });
  }
}
