// src/app/api/slide-decks/[deckId]/content/route.js
// update-slide-content — direct (non-AI) edits to a slide's own template
// content fields (title, bullets, item labels, stat values, ...). Kept
// SEPARATE from the layout-patch route so AI-owned content and the human
// freeform overlay stay independently addressable, same as desktop.
// Validated via content.js's validateContentPatch — permissive shape-only
// caps, never rejects for thinness (this is the human-direct-edit path).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { withDeckRebuild } from "@/lib/slides/deckMutation.js";
import { validateContentPatch } from "@/lib/slides/content.js";

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
        const patch = validateContentPatch(slide.type, body.patch);
        Object.assign(slide, patch);
        return outline;
      },
    });

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, deck: result.deck, outline: result.outline });
  } catch (err) {
    if (err?.statusCode) return NextResponse.json({ error: err.message }, { status: err.statusCode });
    console.error("update-slide-content error:", err);
    return NextResponse.json({ error: "Failed to update slide content" }, { status: 500 });
  }
}
