import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { generateSignedUrl } from "@/lib/s3SignedUrl";

export async function GET(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = params.id;
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


export async function DELETE(req, { params }) {
    const session = await getServerSession();
    if (!session?.user?.email)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
    const id = params.id;
    if (!id) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  
    const doc = await prisma.document.findFirst({
      where: { id, user: { email: session.user.email } },
    });
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  
    // Delete document and its relations
    await prisma.$transaction(async (tx) => {
      await tx.message.deleteMany({
        where: { conversation: { documentId: id } },
      });
      await tx.conversation.deleteMany({ where: { documentId: id } });
      await tx.chunk.deleteMany({ where: { documentId: id } });
      await tx.document.delete({ where: { id } });
    });
  
    return NextResponse.json({ success: true });
  }