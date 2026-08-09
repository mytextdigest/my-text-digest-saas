import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import s3Client from "@/lib/s3.mjs";

export async function DELETE(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: documentId, figureId } = await params;

  const doc = await prisma.document.findFirst({
    where: { id: documentId, user: { email: session.user.email } },
    select: { id: true },
  });
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const figure = await prisma.figure.findFirst({
    where: { id: figureId, documentId: doc.id },
  });
  if (!figure) return NextResponse.json({ error: "Figure not found" }, { status: 404 });

  // Best-effort, outside the transaction — matches how the desktop app
  // deletes the on-disk file before its DB transaction.
  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: figure.s3Key }));
  } catch (err) {
    console.error(`⚠️  Failed to delete figure S3 object (${figure.s3Key}):`, err.message);
  }

  await prisma.$transaction(async (tx) => {
    if (figure.chunkId) {
      await tx.chunk.deleteMany({ where: { id: figure.chunkId } });
    }
    await tx.figure.delete({ where: { id: figure.id } });
  });

  return NextResponse.json({ success: true });
}
