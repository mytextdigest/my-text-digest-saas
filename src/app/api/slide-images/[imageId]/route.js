// src/app/api/slide-images/[imageId]/route.js
// delete-slide-image — a flat (non document-nested) route since the id
// alone is enough to scope + verify ownership through the SlideImage's own
// documentId -> Document.userId chain (same two-step ownership pattern as
// every other slide route, just expressed as one query here).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";

const s3 = new S3Client({ region: process.env.AWS_REGION });

export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { imageId } = await params;
    const image = await prisma.slideImage.findFirst({
      where: { id: imageId, document: { user: { email: session.user.email } } },
    });
    if (!image) return NextResponse.json({ error: "Slide image not found" }, { status: 404 });

    await prisma.slideImage.delete({ where: { id: imageId } });
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: image.s3Key }));
    } catch (err) {
      console.error(`⚠️  Best-effort S3 cleanup failed for slide image ${imageId}:`, err.message || err);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("delete-slide-image error:", err);
    return NextResponse.json({ error: "Failed to delete slide image" }, { status: 500 });
  }
}
