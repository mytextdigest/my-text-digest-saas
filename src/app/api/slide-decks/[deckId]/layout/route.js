// src/app/api/slide-decks/[deckId]/layout/route.js
// update-slide-layout — the freeform (Canva-style) overlay + backgroundColor
// + layoutOverrides + heroImage persistence funnel. Every discrete gesture-
// end (drag/resize/rotate-end, color-picker mouseup, add/delete/duplicate)
// fires a real request here immediately — no debounce at this layer
// (decision 18). Validated via elements.js, never trusted verbatim.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { withDeckRebuild } from "@/lib/slides/deckMutation.js";
import { validateElements, validateBackgroundColor, validateLayoutOverrides, validateHeroImage } from "@/lib/slides/elements.js";

export async function POST(req, { params }) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { deckId } = await params;
    const body = await req.json().catch(() => ({}));
    const slideIndex = Number(body.slideIndex);

    const result = await withDeckRebuild({
      prisma, deckId, userEmail: session.user.email,
      mutateOutline: (outline) => {
        const slide = outline.slides[slideIndex];
        if (!slide) {
          throw Object.assign(new Error("Invalid slideIndex"), { statusCode: 400 });
        }
        if (body.elements !== undefined) slide.elements = validateElements(body.elements);
        if (body.backgroundColor !== undefined) slide.backgroundColor = validateBackgroundColor(body.backgroundColor);
        if (body.layoutOverrides !== undefined) slide.layoutOverrides = validateLayoutOverrides(body.layoutOverrides);
        if (body.heroImage !== undefined) slide.heroImage = validateHeroImage(body.heroImage);
        return outline;
      },
    });

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, deck: result.deck, outline: result.outline });
  } catch (err) {
    if (err?.statusCode) return NextResponse.json({ error: err.message }, { status: err.statusCode });
    console.error("update-slide-layout error:", err);
    return NextResponse.json({ error: "Failed to update slide layout" }, { status: 500 });
  }
}
