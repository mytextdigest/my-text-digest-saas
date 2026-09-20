// src/app/api/slide-decks/[deckId]/reorder/route.js
// reorder-slide — synchronous drag-to-reorder from the thumbnail rail.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { withDeckRebuild } from "@/lib/slides/deckMutation.js";

export async function POST(req, { params }) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { deckId } = await params;
    const body = await req.json().catch(() => ({}));
    const fromIndex = Number(body.fromIndex);
    const toIndex = Number(body.toIndex);

    const result = await withDeckRebuild({
      prisma, deckId, userEmail: session.user.email,
      mutateOutline: (outline) => {
        const slides = outline.slides;
        if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || !slides[fromIndex] || fromIndex === toIndex) {
          return outline;
        }
        const clamped = Math.max(0, Math.min(slides.length - 1, toIndex));
        const [moved] = slides.splice(fromIndex, 1);
        slides.splice(clamped, 0, moved);
        return outline;
      },
    });

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, deck: result.deck, outline: result.outline });
  } catch (err) {
    console.error("reorder-slide error:", err);
    return NextResponse.json({ error: "Failed to reorder slide" }, { status: 500 });
  }
}
