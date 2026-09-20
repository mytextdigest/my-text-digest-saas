import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { normalizeName } from "@/lib/graph/resolver";
import { shapeEntity } from "@/lib/graph/shape";

// Every entity/relationship/insight is reached only through routes that
// first verify the owning project's userId against the session — a
// tampered entityId 404s, same shape as every other route in this app.
async function loadOwnedEntity(entityId, email) {
  return prisma.entity.findFirst({
    where: { id: entityId, project: { user: { email } } },
  });
}

export async function GET(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { entityId } = await params;
  const entity = await loadOwnedEntity(entityId, session.user.email);
  if (!entity) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

  const [mentions, documents, sourceEdges, targetEdges] = await Promise.all([
    prisma.entityMention.findMany({
      where: { entityId },
      orderBy: { createdAt: "asc" },
      include: { document: { select: { filename: true } } },
    }),
    prisma.entityDocument.findMany({
      where: { entityId },
      include: { document: { select: { id: true, filename: true } } },
    }),
    prisma.relationship.findMany({
      where: { sourceEntityId: entityId },
      include: {
        sourceEntity: { select: { name: true, type: true } },
        targetEntity: { select: { name: true, type: true } },
      },
    }),
    prisma.relationship.findMany({
      where: { targetEntityId: entityId },
      include: {
        sourceEntity: { select: { name: true, type: true } },
        targetEntity: { select: { name: true, type: true } },
      },
    }),
  ]);

  const shapeEdge = (r) => ({
    id: r.id,
    source_entity_id: r.sourceEntityId,
    target_entity_id: r.targetEntityId,
    relation: r.relation,
    description: r.description,
    document_id: r.documentId,
    is_inferred: r.isInferred,
    insight_type: r.insightType,
    source_name: r.sourceEntity.name,
    source_type: r.sourceEntity.type,
    target_name: r.targetEntity.name,
    target_type: r.targetEntity.type,
  });

  return NextResponse.json({
    success: true,
    entity: shapeEntity(entity),
    mentions: mentions.map((m) => ({
      id: m.id,
      mention_text: m.mentionText,
      filename: m.document.filename,
      page_number: null,
    })),
    documents: documents.map((d) => ({ id: d.document.id, filename: d.document.filename, confidence: d.confidence })),
    edges: [...sourceEdges, ...targetEdges].map(shapeEdge),
  });
}

export async function PATCH(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { entityId } = await params;
  const entity = await loadOwnedEntity(entityId, session.user.email);
  if (!entity) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

  const { name } = await req.json();
  const trimmed = (name || "").trim();
  if (!trimmed) return NextResponse.json({ error: "Name required" }, { status: 400 });

  await prisma.entity.update({
    where: { id: entityId },
    data: { name: trimmed, normalizedName: normalizeName(trimmed) },
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { entityId } = await params;
  const entity = await loadOwnedEntity(entityId, session.user.email);
  if (!entity) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

  await prisma.$transaction([
    prisma.entityMention.deleteMany({ where: { entityId } }),
    prisma.entityDocument.deleteMany({ where: { entityId } }),
    prisma.relationship.deleteMany({ where: { OR: [{ sourceEntityId: entityId }, { targetEntityId: entityId }] } }),
    prisma.entity.delete({ where: { id: entityId } }),
  ]);

  return NextResponse.json({ success: true });
}
