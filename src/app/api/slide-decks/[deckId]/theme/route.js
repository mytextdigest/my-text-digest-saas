// src/app/api/slide-decks/[deckId]/theme/route.js
// update-slide-deck-theme — synchronous, no LLM round-trip: applies
// immediately via withDeckRebuild. Also handles the pinned "Your Brand"
// palette toggle as its own variant, not an 11th palette-list entry.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { withDeckRebuild } from "@/lib/slides/deckMutation.js";
import { PALETTES, FONT_PAIRS } from "@/lib/slides/theme.js";

export async function POST(req, { params }) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { deckId } = await params;
    const body = await req.json().catch(() => ({}));
    const useBrand = !!body.useBrand;

    if (!useBrand) {
      if (body.paletteName !== undefined && !PALETTES[body.paletteName]) {
        return NextResponse.json({ error: "Unknown paletteName" }, { status: 400 });
      }
      if (body.fontPairName !== undefined && !FONT_PAIRS[body.fontPairName]) {
        return NextResponse.json({ error: "Unknown fontPairName" }, { status: 400 });
      }
    }

    const result = await withDeckRebuild({
      prisma, deckId, userEmail: session.user.email,
      mutateOutline: (outline) => {
        if (useBrand) {
          if (outline.brandKit) outline.brandKit = { ...outline.brandKit, active: true };
        } else {
          if (outline.brandKit) outline.brandKit = { ...outline.brandKit, active: false };
          if (body.paletteName) outline.paletteName = body.paletteName;
          if (body.fontPairName) outline.fontPairName = body.fontPairName;
        }
        return outline;
      },
    });

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, deck: result.deck, outline: result.outline });
  } catch (err) {
    console.error("update-slide-deck-theme error:", err);
    return NextResponse.json({ error: "Failed to update theme" }, { status: 500 });
  }
}
