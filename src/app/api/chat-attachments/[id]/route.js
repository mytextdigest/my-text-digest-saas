// src/app/api/chat-attachments/[id]/route.js
// Removing a chip in the composer (desktop discard-chat-attachment) — only
// staged (unsent) uploads can go.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteS3Keys } from "@/lib/chatImages/server";
import { sessionUser, ownedAttachment, unauthorized, notFound, fail } from "@/lib/chatImages/routeUtils";

export const runtime = "nodejs";

export async function DELETE(req, { params }) {
  try {
    const user = await sessionUser();
    if (!user) return unauthorized();
    const { id } = await params;
    const row = await ownedAttachment(id, user.id);
    if (!row) return notFound("Image not found.");
    if (row.messageId) return NextResponse.json({ success: true });
    await prisma.chatAttachment.delete({ where: { id: row.id } });
    await deleteS3Keys([row.s3Key]);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("❌ chat-attachments discard:", err);
    return fail(err);
  }
}
