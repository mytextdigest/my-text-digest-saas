import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

export async function GET(req, { params }) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { projectId:projectId } = await params;
    if (!projectId)
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

    // verify project belongs to user
    const project = await prisma.project.findFirst({
      where: { id: projectId, user: { email: session.user.email } },
    });
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // latest conversation for project
    const conv = await prisma.projectConversation.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });

    if (!conv) return NextResponse.json({ success: true, messages: [] });

    const messages = await prisma.projectMessage.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: "asc" },
    });

    const mapped = messages.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      role: m.role,
      content: m.content,
      status: m.status,
      timestamp: m.createdAt,
    }));

    return NextResponse.json({ success: true, messages: mapped });
  } catch (err) {
    console.error("❌ get-project-messages:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
