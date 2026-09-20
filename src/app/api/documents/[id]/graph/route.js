import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { shapeEntity, shapeRelationship } from "@/lib/graph/shape";

// GraphView.jsx's poll target — returns this document's own extracted graph
// plus the extraction log's status/errorMessage.
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

  const [entities, relationships, log] = await Promise.all([
    prisma.entity.findMany({ where: { entityDocuments: { some: { documentId } } } }),
    prisma.relationship.findMany({ where: { documentId } }),
    prisma.graphExtractionLog.findUnique({ where: { documentId } }),
  ]);

  return NextResponse.json({
    success: true,
    nodes: entities.map(shapeEntity),
    edges: relationships.map(shapeRelationship),
    status: log?.status || "pending",
    errorMessage: log?.errorMessage || null,
  });
}
