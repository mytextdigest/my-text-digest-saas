import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { shapeEntity, shapeRelationship } from "@/lib/graph/shape";

// Full cross-document project graph, plus documentsTotal/documentsProcessed
// coverage counts — required, not optional (see decision in the feature
// spec: without it a partially-generated project graph is indistinguishable
// from a correctly-scoped one).
export async function GET(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: projectId } = await params;
  if (!projectId) return NextResponse.json({ error: "Missing project id" }, { status: 400 });

  const project = await prisma.project.findFirst({
    where: { id: projectId, user: { email: session.user.email } },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [entities, relationships, documentsTotal, documentsProcessed, documentsFailed] = await Promise.all([
    prisma.entity.findMany({ where: { projectId } }),
    prisma.relationship.findMany({ where: { projectId } }),
    prisma.document.count({ where: { projectId } }),
    prisma.graphExtractionLog.count({ where: { status: "ready", document: { projectId } } }),
    // Not part of the desktop app's original coverage banner (which only
    // ever showed ready-vs-total), but needed here since this port replaces
    // its IPC "generation complete" push with polling this same route: a
    // document whose graph job ended in 'error' would otherwise keep
    // documentsProcessed permanently below documentsTotal, and the frontend
    // would poll forever waiting for a completion signal that never comes.
    prisma.graphExtractionLog.count({ where: { status: "error", document: { projectId } } }),
  ]);

  return NextResponse.json({
    success: true,
    nodes: entities.map(shapeEntity),
    edges: relationships.map(shapeRelationship),
    documentsTotal,
    documentsProcessed,
    documentsFailed,
  });
}
