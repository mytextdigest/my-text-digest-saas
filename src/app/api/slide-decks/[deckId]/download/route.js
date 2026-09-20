// src/app/api/slide-decks/[deckId]/download/route.js
// save-slide-deck — "Save" becomes a plain browser download of a
// server-generated file (decision 12): redirects to a signed S3 URL with
// `ResponseContentDisposition` set to force `attachment; filename="..."`,
// rather than streaming the object through this route.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { prisma } from "@/lib/prisma";
import s3Client from "@/lib/s3.mjs";

function slugify(title) {
  return (title || "presentation")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "presentation";
}

export async function GET(req, { params }) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { deckId } = await params;
    const deck = await prisma.slideDeck.findFirst({
      where: { id: deckId, document: { user: { email: session.user.email } } },
    });
    if (!deck) return NextResponse.json({ error: "Slide deck not found" }, { status: 404 });
    if (!deck.s3Key) return NextResponse.json({ error: "Slide deck has no rendered file yet" }, { status: 409 });

    const filename = `${slugify(deck.title)}.pptx`;
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: deck.s3Key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    });
    const url = await getSignedUrl(s3Client, command, { expiresIn: 300 });

    return NextResponse.redirect(url);
  } catch (err) {
    console.error("download-slide-deck error:", err);
    return NextResponse.json({ error: "Failed to download slide deck" }, { status: 500 });
  }
}
