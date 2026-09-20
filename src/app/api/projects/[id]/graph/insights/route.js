import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { getStoredInsights } from "@/lib/graph/narrativeInsights";

export async function GET(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: projectId } = await params;
  const project = await prisma.project.findFirst({
    where: { id: projectId, user: { email: session.user.email } },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const insights = await getStoredInsights(prisma, { projectId, documentId: null });
  return NextResponse.json({ success: true, insights });
}
