// src/app/api/documents/[id]/slides/route.js
// POST: generate-slides — creates a SlideDeck row and enqueues the
// slide-outline job (Step 1 of the two-LLM-call flow). Gated on the
// document's chunks already existing (decision 2 — generation always reuses
// already-ingested chunks, never re-reads the raw file).
// GET: list-slide-decks — decks for this document, newest first.

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

    const { id: documentId } = await params;
    const doc = await prisma.document.findFirst({
      where: { id: documentId, user: { email: session.user.email } },
    });
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    // Chunking having completed is the actual gate (decision 2) — chunks
    // existing is the ground truth, not a specific status string, since
    // status continues past "chunked" (embedding/summarizing/ready) while
    // chunks stay present the whole time.
    const chunkCount = await prisma.chunk.count({ where: { documentId } });
    if (chunkCount === 0) {
      return NextResponse.json({ error: "Document is still being processed — try again once chunking has completed" }, { status: 409 });
    }

    const body = await req.json().catch(() => ({}));
    // `brandKit` is null when the modal was fully skipped (buildBrandKit()'s
    // own null-vs-{} distinction, preserved through to here) — customPrompt/
    // presentationType/visualStyle then just default to empty/unset below.
    const brandKit = body.brandKit || null;

    const deck = await prisma.slideDeck.create({
      data: {
        documentId,
        status: "generating",
        customPrompt: brandKit?.customPrompt || null,
        brandKitJson: brandKit || undefined,
      },
    });

    await sqs.send(new SendMessageCommand({
      QueueUrl: process.env.SQS_QUEUE_URL,
      MessageBody: JSON.stringify({ type: "slide-outline", deckId: deck.id, docId: documentId }),
    }));

    return NextResponse.json({ success: true, deckId: deck.id });
  } catch (err) {
    console.error("generate-slides error:", err);
    return NextResponse.json({ error: "Failed to start slide generation" }, { status: 500 });
  }
}

export async function GET(req, { params }) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: documentId } = await params;
    const doc = await prisma.document.findFirst({
      where: { id: documentId, user: { email: session.user.email } },
      select: { id: true },
    });
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const decks = await prisma.slideDeck.findMany({
      where: { documentId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ decks });
  } catch (err) {
    console.error("list-slide-decks error:", err);
    return NextResponse.json({ error: "Failed to list slide decks" }, { status: 500 });
  }
}
