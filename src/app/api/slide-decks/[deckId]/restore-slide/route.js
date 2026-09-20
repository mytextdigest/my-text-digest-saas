// src/app/api/slide-decks/[deckId]/restore-slide/route.js
// restore-slide — undo's counterpart to delete-slide: "add a slide back"
// can't be expressed as a layout patch, so this is its own dedicated route,
// reinserting the exact slide object the delete route handed back.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { withDeckRebuild } from "@/lib/slides/deckMutation.js";
import { validateSlide } from "@/lib/slides/outline.js";

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
        // Re-validated through the same shape-only path fresh generation
        // uses, rather than trusted verbatim — it's still client-supplied
        // data, even though it originated from this same deck moments ago.
        const restored = validateSlide(body.slide);
        if (!restored) {
          throw Object.assign(new Error("Invalid slide payload"), { statusCode: 400 });
        }
        // validateSlide resets elements/backgroundColor/layoutOverrides to
        // empty (it has no way to know this is a restore, not fresh AI
        // content) — put the removed slide's own freeform data back so an
        // undo doesn't quietly drop manual editor work the deletion itself
        // never touched.
        restored.elements = body.slide.elements || [];
        restored.backgroundColor = body.slide.backgroundColor ?? null;
        restored.layoutOverrides = body.slide.layoutOverrides || {};
        restored.heroImage = body.slide.heroImage ?? undefined;
        const insertAt = Math.max(0, Math.min(outline.slides.length, slideIndex));
        outline.slides.splice(insertAt, 0, restored);
        return outline;
      },
    });

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, deck: result.deck, outline: result.outline });
  } catch (err) {
    if (err?.statusCode) return NextResponse.json({ error: err.message }, { status: err.statusCode });
    console.error("restore-slide error:", err);
    return NextResponse.json({ error: "Failed to restore slide" }, { status: 500 });
  }
}
