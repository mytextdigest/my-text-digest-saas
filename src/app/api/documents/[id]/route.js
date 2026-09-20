import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { generateSignedUrl } from "@/lib/s3SignedUrl";
import { computeDocumentEmbedding, adjustTopicOnDocumentRemoval } from "@/lib/topicUtils";
import { removeGraphDataForDocument } from "@/lib/graph/cleanup";
import s3Client from "@/lib/s3.mjs";

export async function GET(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: id } = await params;

  if (!id) return NextResponse.json(null, { status: 400 });

  const doc = await prisma.document.findFirst({
    where: { id, user: { email: session.user.email } },
    include: { chunks: { orderBy: { chunkIndex: "asc" } } },
  });

  if (!doc) return NextResponse.json(null, { status: 404 });

  let signedUrl = null;
  if (doc.filePath) {
    signedUrl = await generateSignedUrl(doc.filePath);
  }

  return NextResponse.json({
    ...doc,
    fileUrl: signedUrl,
    created_at: doc.createdAt.toISOString(),
  });
}


export async function PATCH(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing document id" }, { status: 400 });

  const body = await req.json();
  const { filename } = body;

  if (!filename?.trim()) {
    return NextResponse.json({ error: "Filename is required" }, { status: 400 });
  }

  const doc = await prisma.document.findFirst({
    where: { id, user: { email: session.user.email } },
    select: { id: true },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.document.update({
    where: { id },
    data: { filename: filename.trim() },
    select: { id: true, filename: true },
  });

  return NextResponse.json({ success: true, ...updated });
}

export async function DELETE(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  const doc = await prisma.document.findFirst({
    where: { id, user: { email: session.user.email } },
    include: {
      topicDocument: { include: { topic: true } },
      figures: { select: { s3Key: true } },
      slideDecks: { select: { id: true, s3Key: true } },
      slideImages: { select: { s3Key: true } },
    },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Adjust topic centroid before deleting (topic may be deleted if this was last doc)
  if (doc.topicDocument) {
    try {
      const docEmbedding = await computeDocumentEmbedding(id);
      await adjustTopicOnDocumentRemoval(
        doc.topicDocument.topicId,
        docEmbedding,
        null
      );
    } catch (err) {
      console.error("Failed to adjust topic centroid on document delete:", err.message);
    }
  }

  // Best-effort S3 cleanup for the document's figure image objects — new
  // usage this feature introduces, so it needs cleanup even though the
  // document's own S3 object isn't deleted here either (pre-existing gap).
  await Promise.all(
    doc.figures.map((figure) =>
      s3Client
        .send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: figure.s3Key }))
        .catch((err) => console.error(`⚠️  Failed to delete figure S3 object (${figure.s3Key}):`, err.message))
    )
  );

  // Same best-effort posture for every SlideDeck's rendered .pptx + its own
  // hero-image prefix (slides/<deckId>/), and every document-scoped
  // SlideImage (the Uploads panel's upload/generate pool) — outside the
  // transaction below, same as the figures cleanup above.
  await Promise.all(
    doc.slideDecks.map(async (deck) => {
      try {
        if (deck.s3Key) {
          await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: deck.s3Key }));
        }
        const prefix = `slides/${deck.id}/`;
        const listed = await s3Client.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: prefix }));
        await Promise.all(
          (listed.Contents || []).map((obj) =>
            s3Client.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: obj.Key }))
          )
        );
      } catch (err) {
        console.error(`⚠️  Failed to delete slide deck S3 objects (deck ${deck.id}):`, err.message);
      }
    })
  );
  await Promise.all(
    doc.slideImages.map((image) =>
      s3Client
        .send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: image.s3Key }))
        .catch((err) => console.error(`⚠️  Failed to delete slide image S3 object (${image.s3Key}):`, err.message))
    )
  );

  // Delete document and its relations. Figures and graph data must be
  // removed before chunks — Figure.chunkId/EntityMention.chunkId reference
  // Chunk, so deleting chunks first would leave a dangling FK.
  await prisma.$transaction(async (tx) => {
    await tx.message.deleteMany({ where: { conversation: { documentId: id } } });
    await tx.conversation.deleteMany({ where: { documentId: id } });
    await tx.figure.deleteMany({ where: { documentId: id } });
    await removeGraphDataForDocument(tx, id, { projectId: doc.projectId });
    await tx.chunk.deleteMany({ where: { documentId: id } });
    await tx.slideDeck.deleteMany({ where: { documentId: id } });
    await tx.slideImage.deleteMany({ where: { documentId: id } });
    await tx.document.delete({ where: { id } });
  });

  return NextResponse.json({ success: true });
}