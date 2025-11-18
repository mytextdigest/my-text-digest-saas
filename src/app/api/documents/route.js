import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

export async function GET(req) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    if (!projectId) return NextResponse.json([], { status: 200 });

    // 🔹 Fetch the user record first
    const dbUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });

    if (!dbUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // 🔹 Now fetch documents by userId + projectId
    const documents = await prisma.document.findMany({
      where: {
        projectId,
        userId: dbUser.id, // ✅ use userId instead of email
      },
      select: {
        id: true,
        filename: true,
        createdAt: true,
        projectId: true,
        starred: true,
        selected: true,
      },
      orderBy: { createdAt: "desc" },
    });

    // 🔹 Format for frontend
    const formatted = documents.map((d) => ({
      ...d,
      created_at: d.createdAt.toISOString(),
    }));

    return NextResponse.json(formatted);
  } catch (err) {
    console.error("❌ Failed to fetch documents:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
