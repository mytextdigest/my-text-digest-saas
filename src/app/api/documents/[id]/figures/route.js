import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { generateSignedUrl } from "@/lib/s3SignedUrl";

export async function GET(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: documentId } = await params;
  if (!documentId) return NextResponse.json({ error: "Missing document id" }, { status: 400 });

  const doc = await prisma.document.findFirst({
    where: { id: documentId, user: { email: session.user.email } },
    select: { id: true },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const figures = await prisma.figure.findMany({
    where: { documentId },
    orderBy: { figureIndex: "asc" },
  });

  const withUrls = await Promise.all(
    figures.map(async (figure) => ({
      ...figure,
      imageUrl: await generateSignedUrl(figure.s3Key),
    }))
  );

  return NextResponse.json(withUrls);
}
