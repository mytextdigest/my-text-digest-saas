import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

export async function POST(req, { params }) {
  try {
    // 1) Auth
    const session = await getServerSession();
    if (!session?.user?.email) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { id:documentId } = await params;

    // 2) Fetch the document (ensure ownership)
    const doc = await prisma.document.findFirst({
      where: {
        id: documentId,
        user: { email: session.user.email }
      },
      select: { selected: true }
    });

    if (!doc) {
      return NextResponse.json(
        { success: false, error: "Document not found" },
        { status: 404 }
      );
    }

    // 3) Toggle selected (same logic as your Electron IPC)
    const newStatus = doc.selected ? 0 : 1;

    await prisma.document.update({
      where: { id: documentId },
      data: { selected: newStatus }
    });

    // 4) Return the updated status
    return NextResponse.json({
      success: true,
      selected: newStatus
    });

  } catch (err) {
    console.error("toggle-document-selection API error:", err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
