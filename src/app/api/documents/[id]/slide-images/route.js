// src/app/api/documents/[id]/slide-images/route.js
// GET: list-slide-images — resolves signed URLs for this document's
// Uploaded/Generated image pool (the Uploads panel's ImageGrid).
// POST: upload-slide-image — records an already-S3-uploaded file (same
// presigned-POST round-trip as brand-logo) as a `source: "upload"`
// SlideImage row.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { prisma } from "@/lib/prisma";
import { decodeImageBuffer } from "@/lib/slides/imageAnalysis.js";
import { resolveSlideImageUrl } from "@/lib/slides/imageStorage.js";

const s3 = new S3Client({ requestHandler: new NodeHttpHandler({ connectionTimeout: 5000, requestTimeout: 30000 }) });
const MIME_BY_EXT = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function GET(req, { params }) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: documentId } = await params;
    const doc = await prisma.document.findFirst({ where: { id: documentId, user: { email: session.user.email } }, select: { id: true } });
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const images = await prisma.slideImage.findMany({ where: { documentId }, orderBy: { createdAt: "desc" } });
    const withUrls = await Promise.all(images.map(async (img) => ({ ...img, url: await resolveSlideImageUrl(img.s3Key) })));

    return NextResponse.json({ images: withUrls });
  } catch (err) {
    console.error("list-slide-images error:", err);
    return NextResponse.json({ error: "Failed to list slide images" }, { status: 500 });
  }
}

export async function POST(req, { params }) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: documentId } = await params;
    const doc = await prisma.document.findFirst({ where: { id: documentId, user: { email: session.user.email } } });
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const { key } = body;
    const expectedPrefix = `uploads/${doc.userId}/${doc.projectId}/${documentId}/`;
    if (typeof key !== "string" || !key.startsWith(expectedPrefix)) {
      return NextResponse.json({ error: "Invalid key" }, { status: 400 });
    }

    const ext = key.split(".").pop()?.toLowerCase();
    const contentType = MIME_BY_EXT[ext];
    if (!contentType) return NextResponse.json({ error: "Unsupported image type" }, { status: 400 });

    const object = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    const buffer = await streamToBuffer(object.Body);
    const { width, height } = decodeImageBuffer(buffer, contentType);

    const image = await prisma.slideImage.create({
      data: { documentId, s3Key: key, width, height, format: ext, source: "upload" },
    });

    return NextResponse.json({ image: { ...image, url: await resolveSlideImageUrl(key) } });
  } catch (err) {
    console.error("upload-slide-image error:", err);
    return NextResponse.json({ error: "Failed to record slide image" }, { status: 500 });
  }
}
