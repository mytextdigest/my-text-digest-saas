import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";

export async function GET(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await params;

  // Verify project belongs to user
  const project = await prisma.project.findFirst({
    where: { id: projectId, user: { email: session.user.email } },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const topics = await prisma.topic.findMany({
    where: { projectId },
    select: {
      id:            true,
      name:          true,
      documentCount: true,
      createdAt:     true,
      updatedAt:     true,
    },
    orderBy: [{ documentCount: "desc" }, { createdAt: "asc" }],
  });

  return NextResponse.json(topics);
}
