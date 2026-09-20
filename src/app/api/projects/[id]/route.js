// app/api/projects/[id]/route.js
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { removeGraphDataForDocument } from "@/lib/graph/cleanup";
import { removeComparisonsForDocument } from "@/lib/compareCleanup";

export async function GET(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await params;

  // console.log("project id: ", projectId)
  // console.log("Params ", params)

  if (!projectId) return NextResponse.json(null);

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      user: { email: session.user.email },
    },
    select: { id: true, name: true, description: true, createdAt: true },
  });

  if (!project) return NextResponse.json(null, { status: 404 });

  return NextResponse.json({
    ...project,
    created_at: project.createdAt.toISOString(),
  });
}

export async function PATCH(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await params;
  if (!projectId) return NextResponse.json({ error: "Missing project id" }, { status: 400 });

  const body = await req.json();
  const { name, description } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Project name is required" }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, user: { email: session.user.email } },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found or unauthorized" }, { status: 404 });
  }

  // Check for duplicate name (unique per user)
  const duplicate = await prisma.project.findFirst({
    where: {
      user: { email: session.user.email },
      name: name.trim(),
      NOT: { id: projectId },
    },
    select: { id: true },
  });
  if (duplicate) {
    return NextResponse.json({ error: "A project with that name already exists" }, { status: 409 });
  }

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: { name: name.trim(), description: description?.trim() ?? null },
    select: { id: true, name: true, description: true, createdAt: true },
  });

  return NextResponse.json({ ...updated, created_at: updated.createdAt.toISOString() });
}

export async function DELETE(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id:projectId } = await params;
  if (!projectId) return NextResponse.json({ success: false, error: "Invalid project id" }, { status: 400 });

  // Verify project belongs to user
  const project = await prisma.project.findFirst({
    where: { id: projectId, user: { email: session.user.email } },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ success: false, error: "Project not found or unauthorized" }, { status: 404 });
  }

  try {
    // Transactionally delete everything related to the project.
    // Order: document messages -> document conversations -> chunks -> documents
    // then project messages -> project conversations -> project
    await prisma.$transaction(async (prismaTx) => {
      // 1) find documents for this project
      const docs = await prismaTx.document.findMany({
        where: { projectId: projectId },
        select: { id: true },
      });

      const docIds = docs.map((d) => d.id);

      if (docIds.length > 0) {
        // Knowledge-graph data (entities/mentions/relationships/insights) is
        // project-scoped, not cascaded by any FK — clean it up per-document
        // before chunks are deleted below (EntityMention.chunkId references
        // Chunk with a RESTRICT FK).
        for (const docId of docIds) {
          await removeGraphDataForDocument(prismaTx, docId, { projectId });
          // Belt-and-suspenders pass — the document delete route already
          // does this per-document, but a project delete goes straight to
          // deleteMany on documents below, bypassing that route entirely.
          await removeComparisonsForDocument(prismaTx, docId);
        }

        // 2) document conversations for those documents
        const docConvos = await prismaTx.conversation.findMany({
          where: { documentId: { in: docIds } },
          select: { id: true },
        });
        const docConvoIds = docConvos.map((c) => c.id);

        if (docConvoIds.length > 0) {
          // delete messages for those conversations
          await prismaTx.message.deleteMany({
            where: { conversationId: { in: docConvoIds } },
          });
          // delete those conversations
          await prismaTx.conversation.deleteMany({
            where: { id: { in: docConvoIds } },
          });
        }

        // delete chunks for those documents
        await prismaTx.chunk.deleteMany({
          where: { documentId: { in: docIds } },
        });

        // delete documents
        await prismaTx.document.deleteMany({
          where: { id: { in: docIds } },
        });
      }

      // 3) project-level conversations & messages
      const projConvos = await prismaTx.projectConversation.findMany({
        where: { projectId: projectId },
        select: { id: true },
      });
      const projConvoIds = projConvos.map((c) => c.id);

      if (projConvoIds.length > 0) {
        await prismaTx.projectMessage.deleteMany({
          where: { conversationId: { in: projConvoIds } },
        });
        await prismaTx.projectConversation.deleteMany({
          where: { id: { in: projConvoIds } },
        });
      }

      // 4) delete the project itself
      await prismaTx.project.delete({
        where: { id: projectId },
      });
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Error deleting project tree:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
