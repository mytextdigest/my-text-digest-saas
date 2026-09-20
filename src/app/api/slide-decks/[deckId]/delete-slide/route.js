// src/app/api/slide-decks/[deckId]/delete-slide/route.js
// delete-slide — refuses on the deck's last slide; returns `removedSlide`
// so the client can push a structural undo entry with the exact slide the
// route hands back (restore-slide is its counterpart).

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
    const slideIndex = Number(body.slideIndex);

    const result = await withDeckRebuild({
      prisma, deckId, userEmail: session.user.email,
      mutateOutline: (outline) => {
        if (!outline.slides[slideIndex]) {
          throw Object.assign(new Error("Invalid slideIndex"), { statusCode: 400 });
        }
        if (outline.slides.length <= 1) {
          throw Object.assign(new Error("Cannot delete the deck's last slide"), { statusCode: 409 });
        }
        const [removedSlide] = outline.slides.splice(slideIndex, 1);
        return { outline, extra: { removedSlide } };
      },
    });

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, deck: result.deck, outline: result.outline, removedSlide: result.extra?.removedSlide });
  } catch (err) {
    if (err?.statusCode) return NextResponse.json({ error: err.message }, { status: err.statusCode });
    console.error("delete-slide error:", err);
    return NextResponse.json({ error: "Failed to delete slide" }, { status: 500 });
  }
}
