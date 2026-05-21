import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";

async function verifyTopicOwnership(session, projectId, topicId) {
  const topic = await prisma.topic.findFirst({
    where: {
      id:      topicId,
      project: { id: projectId, user: { email: session.user.email } },
    },
  });
  return topic;
}

export async function PATCH(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId, topicId } = await params;
  const { name } = await req.json();

  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const topic = await verifyTopicOwnership(session, projectId, topicId);
  if (!topic) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.topic.update({
    where: { id: topicId },
    data:  { name: name.trim() },
    select: { id: true, name: true },
  });

  return NextResponse.json(updated);
}

export async function DELETE(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId, topicId } = await params;

  const topic = await verifyTopicOwnership(session, projectId, topicId);
  if (!topic) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Cascade deletes TopicDocument rows, documents become unassigned
  await prisma.topic.delete({ where: { id: topicId } });

  return NextResponse.json({ success: true });
}
