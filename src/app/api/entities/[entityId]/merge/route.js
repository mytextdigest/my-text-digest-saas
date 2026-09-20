import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

// The entity in the URL is the one being merged AWAY (disappears); body's
// mergeIntoId is the one that survives — mirrors EntityDetailModal's "merge
// into another entity" control, where the entity currently open in the
// panel is the one merging into the dropdown selection.
export async function POST(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { entityId: mergeId } = await params;
  const { mergeIntoId: keepId } = await req.json();

  if (!keepId || !mergeId || keepId === mergeId) {
    return NextResponse.json({ error: "Two distinct entity ids are required" }, { status: 400 });
  }

  const [merge, keep] = await Promise.all([
    prisma.entity.findFirst({ where: { id: mergeId, project: { user: { email: session.user.email } } } }),
    prisma.entity.findFirst({ where: { id: keepId, project: { user: { email: session.user.email } } } }),
  ]);
  if (!merge || !keep) return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  if (merge.projectId !== keep.projectId) {
    return NextResponse.json({ error: "Entities belong to different projects" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.entityMention.updateMany({ where: { entityId: mergeId }, data: { entityId: keepId } });

    // EntityDocument has a unique (entityId, documentId) constraint — only
    // move rows that don't already exist for keepId, drop the rest.
    const mergeDocs = await tx.entityDocument.findMany({ where: { entityId: mergeId } });
    for (const d of mergeDocs) {
      const exists = await tx.entityDocument.findUnique({
        where: { entityId_documentId: { entityId: keepId, documentId: d.documentId } },
      });
      if (!exists) {
        await tx.entityDocument.create({ data: { entityId: keepId, documentId: d.documentId, confidence: d.confidence } });
      }
    }
    await tx.entityDocument.deleteMany({ where: { entityId: mergeId } });

    await tx.relationship.updateMany({ where: { sourceEntityId: mergeId }, data: { sourceEntityId: keepId } });
    await tx.relationship.updateMany({ where: { targetEntityId: mergeId }, data: { targetEntityId: keepId } });
    // Drop any self-referencing edges the merge just created.
    await tx.relationship.deleteMany({ where: { sourceEntityId: keepId, targetEntityId: keepId } });

    const mentionCount = await tx.entityMention.count({ where: { entityId: keepId } });
    const documentCount = await tx.entityDocument.count({ where: { entityId: keepId } });
    await tx.entity.update({ where: { id: keepId }, data: { mentionCount, documentCount } });

    await tx.entity.delete({ where: { id: mergeId } });
  });

  return NextResponse.json({ success: true });
}
