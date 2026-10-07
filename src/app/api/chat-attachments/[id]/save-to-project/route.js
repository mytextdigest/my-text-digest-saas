// src/app/api/chat-attachments/[id]/save-to-project/route.js
// Adds a chat image to a project as a normal document (desktop
// save-chat-attachment-to-project), so it gets captioning, tables-from-
// images and so on: the object is copied into uploads/ and goes through
// the same createDocumentFromS3 as documents/ingest, storage limit
// included. Idempotent while the saved document still exists.
import { NextResponse } from "next/server";
import { S3Client, CopyObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { createDocumentFromS3 } from "@/lib/documents/createDocumentFromS3";
import { deleteS3Keys } from "@/lib/chatImages/server";
import { sessionUser, ownedAttachment, unauthorized, notFound, badRequest, fail } from "@/lib/chatImages/routeUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const s3 = new S3Client({ region: process.env.AWS_REGION });

function baseName(row) {
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  if (row.direction === "output") return `chat-image-${stamp}`;
  const base = String(row.originalName || "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[\\/:*?"<>|\r\n]+/g, "-")
    .trim()
    .slice(0, 120);
  return base || `chat-image-${stamp}`;
}

export async function POST(req, { params }) {
  try {
    const user = await sessionUser();
    if (!user) return unauthorized();
    const { id } = await params;
    const { projectId } = await req.json().catch(() => ({}));
    const row = await ownedAttachment(id, user.id);
    if (!row) return notFound("Image not found.");
    if (!projectId) return badRequest("No project to save to.");
    const project = await prisma.project.findFirst({ where: { id: String(projectId), userId: user.id }, select: { id: true } });
    if (!project) return notFound("Project not found.");

    if (row.savedDocumentId) {
      const existing = await prisma.document.findFirst({ where: { id: row.savedDocumentId, userId: user.id }, select: { id: true } });
      if (existing) return NextResponse.json({ success: true, documentId: existing.id, alreadySaved: true });
    }

    // The duplicate-filename rule: -2, -3, … on a clash in this project.
    const ext = row.mime === "image/webp" ? ".webp" : ".png";
    const base = baseName(row);
    let filename = `${base}${ext}`;
    for (let n = 2; await prisma.document.findFirst({ where: { projectId: project.id, filename }, select: { id: true } }); n++) {
      filename = `${base}-${n}${ext}`;
    }

    const s3Key = `uploads/${user.id}/${project.id}/${filename}`;
    await s3.send(new CopyObjectCommand({
      Bucket: process.env.S3_BUCKET,
      CopySource: `${process.env.S3_BUCKET}/${row.s3Key}`,
      Key: s3Key,
      ContentType: row.mime || "image/png",
      MetadataDirective: "REPLACE",
    }));

    const result = await createDocumentFromS3({ userId: user.id, projectId: project.id, s3Key, filename });
    if (!result.ok) {
      await deleteS3Keys([s3Key]);
      const error = result.status === 413
        ? "Not enough storage left on your plan to save this image."
        : result.body?.error || "Could not save the image.";
      return NextResponse.json({ success: false, ...result.body, error }, { status: result.status });
    }

    await prisma.chatAttachment.update({ where: { id: row.id }, data: { savedDocumentId: result.doc.id } });
    return NextResponse.json({ success: true, documentId: result.doc.id, filename });
  } catch (err) {
    console.error("❌ chat-attachments save-to-project:", err);
    return fail(new Error(err.message || "Could not save the image."));
  }
}
