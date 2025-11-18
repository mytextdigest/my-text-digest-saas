import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

export async function POST(req) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { projectId } = await req.json();
    if (!projectId)
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

    // verify project belongs to user
    const project = await prisma.project.findFirst({
      where: { id: projectId, user: { email: session.user.email } },
    });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const conversations = await prisma.projectConversation.findMany({
      where: { projectId },
      select: { id: true },
    });

    if (!conversations.length) return NextResponse.json({ success: true });

    const ids = conversations.map((c) => c.id);

    await prisma.projectMessage.deleteMany({
      where: { conversationId: { in: ids } },
    });

    await prisma.projectConversation.deleteMany({
      where: { id: { in: ids } },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("❌ clear-project-chat:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
