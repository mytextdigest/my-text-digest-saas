import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { getStoredInsights } from "@/lib/graph/narrativeInsights";

export async function GET(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: documentId } = await params;
  const doc = await prisma.document.findFirst({
    where: { id: documentId, user: { email: session.user.email } },
    select: { id: true, projectId: true },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const insights = await getStoredInsights(prisma, { projectId: doc.projectId, documentId });
  return NextResponse.json({ success: true, insights });
}
