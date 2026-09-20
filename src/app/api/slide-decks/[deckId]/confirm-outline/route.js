// src/app/api/slide-decks/[deckId]/confirm-outline/route.js
// confirm-slide-outline — persists the user-edited {title, slides,
// imageMode, imageSlideIndices} outline (still the transient plain-text
// shape at this point) and enqueues the slide-build job (Step 2).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { prisma } from "@/lib/prisma";
import { IMAGE_MODES, DEFAULT_IMAGE_MODE } from "@/lib/slides/outline.js";

const sqs = new SQSClient({ region: process.env.AWS_REGION });

function truncate(value, maxLen) {
  return typeof value === "string" ? value.trim().slice(0, maxLen) : "";
}

// Permissive shape-only sanitization (not content-quality gating — the
// user just approved this text, dropping/thinning it here would be data
// loss, same "human-direct-edit path" reasoning as content.js). Drops any
// slide whose title is empty on confirm, per OutlineReview.jsx's own
// behavior, and remaps manual-image indices onto the post-filter array.
function sanitizeApprovedOutline(raw) {
  const title = truncate(raw?.title, 100) || "Untitled Deck";
  const rawSlides = Array.isArray(raw?.slides) ? raw.slides : [];

  const keptIndexByOriginal = new Map();
  const slides = [];
  rawSlides.forEach((s, originalIndex) => {
    const slideTitle = truncate(s?.title, 100);
    if (!slideTitle) return;
    keptIndexByOriginal.set(originalIndex, slides.length);
    slides.push({ title: slideTitle, body: typeof s?.body === "string" ? s.body.slice(0, 4000) : "" });
  });

  const imageMode = IMAGE_MODES.includes(raw?.imageMode) ? raw.imageMode : DEFAULT_IMAGE_MODE;
  const imageSlideIndices = Array.isArray(raw?.imageSlideIndices)
    ? raw.imageSlideIndices.map((i) => keptIndexByOriginal.get(i)).filter((i) => i !== undefined)
    : [];

  return { title, slides, imageMode, imageSlideIndices };
}

export async function POST(req, { params }) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { deckId } = await params;
    const deck = await prisma.slideDeck.findFirst({
      where: { id: deckId, document: { user: { email: session.user.email } } },
    });
    if (!deck) return NextResponse.json({ error: "Slide deck not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const approved = sanitizeApprovedOutline(body);
    if (approved.slides.length === 0) {
      return NextResponse.json({ error: "Outline has no slides left after removing empty titles" }, { status: 400 });
    }

    await prisma.slideDeck.update({
      where: { id: deckId },
      data: { title: approved.title, outlineJson: approved, status: "generating" },
    });

    await sqs.send(new SendMessageCommand({
      QueueUrl: process.env.SQS_QUEUE_URL,
      MessageBody: JSON.stringify({ type: "slide-build", deckId, docId: deck.documentId }),
    }));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("confirm-slide-outline error:", err);
    return NextResponse.json({ error: "Failed to confirm outline" }, { status: 500 });
  }
}
