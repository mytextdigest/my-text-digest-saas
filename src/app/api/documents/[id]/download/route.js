// src/app/api/documents/[id]/download/route.js
// The document viewers' Download button (the desktop's save-document-copy):
// redirects to a short-lived signed S3 URL whose ResponseContentDisposition
// makes the browser save the file under its original name. A plain
// <a download> can't do this because the signed URL is on another origin.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { prisma } from "@/lib/prisma";
import s3Client from "@/lib/s3.mjs";

// Quoted-string fallback for old clients (ASCII, no quotes or backslashes) plus
// the RFC 5987 form, which carries the exact name including non-ASCII characters.
function contentDisposition(filename) {
  const name = (filename || "document").replace(/[\\/:*?"<>|\x00-\x1f]/g, "-");
  const ascii = name.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(req, { params }) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const doc = await prisma.document.findFirst({
      where: { id, user: { email: session.user.email } },
      select: { filename: true, filePath: true },
    });
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    if (!doc.filePath) return NextResponse.json({ error: "Document file not found" }, { status: 404 });

    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: doc.filePath,
      ResponseContentDisposition: contentDisposition(doc.filename),
    });
    const url = await getSignedUrl(s3Client, command, { expiresIn: 300 });

    return NextResponse.redirect(url);
  } catch (err) {
    console.error("download-document error:", err);
    return NextResponse.json({ error: "Failed to download document" }, { status: 500 });
  }
}
