// src/app/api/slide-decks/[deckId]/edit/route.js
// edit-slide-deck — enqueues the slide-edit job (whole-deck or
// current-slide AI free-text edit). `status` flips to "generating" so the
// editor's polling (POLL_INTERVAL_MS=3000, same pattern as SlidesView) can
// pick up completion; the worker reverts to "ready" on failure, never
// "error" (decision 11).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { prisma } from "@/lib/prisma";

const sqs = new SQSClient({ region: process.env.AWS_REGION });

export async function POST(req, { params }) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { deckId } = await params;
    const deck = await prisma.slideDeck.findFirst({
      where: { id: deckId, document: { user: { email: session.user.email } } },
    });
    if (!deck) return NextResponse.json({ error: "Slide deck not found" }, { status: 404 });
    if (deck.status !== "ready") {
      return NextResponse.json({ error: "Slide deck is not ready to edit yet" }, { status: 409 });
    }

    const body = await req.json().catch(() => ({}));
    const mode = body.mode === "slide" ? "slide" : "whole-deck";
    const instruction = typeof body.instruction === "string" ? body.instruction.trim().slice(0, 2000) : "";
    if (!instruction) return NextResponse.json({ error: "Missing edit instruction" }, { status: 400 });

    const slideIndex = Number(body.slideIndex);
    if (mode === "slide" && (!Number.isInteger(slideIndex) || !deck.outlineJson?.slides?.[slideIndex])) {
      return NextResponse.json({ error: "Invalid slideIndex" }, { status: 400 });
    }

    await prisma.slideDeck.update({ where: { id: deckId }, data: { status: "generating" } });

    await sqs.send(new SendMessageCommand({
      QueueUrl: process.env.SQS_QUEUE_URL,
      MessageBody: JSON.stringify({
        type: "slide-edit", deckId, docId: deck.documentId, mode,
        slideIndex: mode === "slide" ? slideIndex : undefined,
        instruction,
      }),
    }));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("edit-slide-deck error:", err);
    return NextResponse.json({ error: "Failed to start slide edit" }, { status: 500 });
  }
}
