import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";

export async function PATCH(req, { params }) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const docId = params.id;
    if (!docId) {
      return NextResponse.json({ error: "Invalid document ID" }, { status: 400 });
    }

    // Get current document for this user
    const doc = await prisma.document.findFirst({
      where: {
        id: docId,
        user: { email: session.user.email },
      },
      select: { id: true, starred: true },
    });

    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const newStarred = doc.starred === 1 ? 0 : 1;

    // Toggle in DB
    await prisma.document.update({
      where: { id: doc.id },
      data: { starred: newStarred },
    });

    return NextResponse.json({ success: true, starred: newStarred });
  } catch (err) {
    console.error("Failed to toggle star:", err);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
