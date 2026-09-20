// src/app/api/slide-decks/[deckId]/route.js
// GET: get-slide-deck — full deck row + parsed outline, scoped to the
// requesting user's own document (a tampered deckId 404s).
// DELETE: delete-slide-deck — removes the DB row + its .pptx and
// hero-image S3 objects, best-effort (never blocks the DB delete on an S3
// cleanup failure).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { S3Client, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";

const s3 = new S3Client({ region: process.env.AWS_REGION });

async function loadOwnedDeck(deckId, userEmail, { withDocument = false } = {}) {
  return prisma.slideDeck.findFirst({
    where: { id: deckId, document: { user: { email: userEmail } } },
    include: withDocument ? { document: { select: { id: true, userId: true, projectId: true } } } : undefined,
  });
}

export async function GET(req, { params }) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { deckId } = await params;
    // Includes the parent document's userId/projectId — the editor's
    // Uploads panel needs both to presign a direct-to-S3 upload.
    const deck = await loadOwnedDeck(deckId, session.user.email, { withDocument: true });
    if (!deck) return NextResponse.json({ error: "Slide deck not found" }, { status: 404 });

    return NextResponse.json({ deck });
  } catch (err) {
    console.error("get-slide-deck error:", err);
    return NextResponse.json({ error: "Failed to load slide deck" }, { status: 500 });
  }
}

// Best-effort S3 cleanup — deletes the rendered .pptx plus every object
// under this deck's own hero-image prefix (slides/<deckId>/). Never blocks
// the DB delete; failures are logged only, matching the Figures spec's own
// "cleanup outside the transaction, best-effort" posture.
async function cleanupDeckObjects(deck) {
  const bucket = process.env.S3_BUCKET;
  try {
    if (deck.s3Key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: deck.s3Key }));
    }
    const prefix = `slides/${deck.id}/`;
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
    for (const obj of listed.Contents || []) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
    }
  } catch (err) {
    console.error(`⚠️  Best-effort S3 cleanup failed for deck ${deck.id}:`, err.message || err);
  }
}

export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { deckId } = await params;
    const deck = await loadOwnedDeck(deckId, session.user.email);
    if (!deck) return NextResponse.json({ error: "Slide deck not found" }, { status: 404 });

    await prisma.slideDeck.delete({ where: { id: deckId } });
    await cleanupDeckObjects(deck);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("delete-slide-deck error:", err);
    return NextResponse.json({ error: "Failed to delete slide deck" }, { status: 500 });
  }
}
