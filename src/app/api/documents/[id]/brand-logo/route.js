// src/app/api/documents/[id]/brand-logo/route.js
// upload-brand-logo — the client already uploaded the raw file straight to
// S3 via the existing presigned-POST flow (/api/s3/upload); this route is
// the "record" step: verifies the object exists under this document's own
// upload prefix, decodes it server-side (never trusts client-supplied
// dimensions) to get real width/height + dominant colors, and hands back a
// signed URL + swatch colors for the BrandKitModal to pre-fill (still
// editable — the 3 color swatches are "auto-filled... but always
// editable").

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { prisma } from "@/lib/prisma";
import { decodeImageBuffer, extractDominantColors } from "@/lib/slides/imageAnalysis.js";
import { resolveSlideImageUrl } from "@/lib/slides/imageStorage.js";

const s3 = new S3Client({ requestHandler: new NodeHttpHandler({ connectionTimeout: 5000, requestTimeout: 30000 }) });

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const MIME_BY_EXT = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

export async function POST(req, { params }) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: documentId } = await params;
    const doc = await prisma.document.findFirst({ where: { id: documentId, user: { email: session.user.email } } });
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const { key } = body;
    // Defense in depth: the key must actually live under this user/
    // document's own upload prefix — a client can't point this route at
    // someone else's already-uploaded object.
    const expectedPrefix = `uploads/${doc.userId}/${doc.projectId}/${documentId}/`;
    if (typeof key !== "string" || !key.startsWith(expectedPrefix)) {
      return NextResponse.json({ error: "Invalid key" }, { status: 400 });
    }

    const ext = key.split(".").pop()?.toLowerCase();
    const contentType = MIME_BY_EXT[ext];
    if (!contentType) return NextResponse.json({ error: "Unsupported image type" }, { status: 400 });

    const object = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    const buffer = await streamToBuffer(object.Body);

    const { width, height, data } = decodeImageBuffer(buffer, contentType);
    const colors = extractDominantColors(data, 3);
    const url = await resolveSlideImageUrl(key);

    return NextResponse.json({
      logoKey: key, logoUrl: url, width, height,
      colors: { primary: colors[0] || null, secondary: colors[1] || null, accent: colors[2] || null },
    });
  } catch (err) {
    console.error("upload-brand-logo error:", err);
    return NextResponse.json({ error: "Failed to process brand logo" }, { status: 500 });
  }
}
