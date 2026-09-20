import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import OpenAI from "openai";
import { prisma } from "@/lib/prisma";
import { getUserOpenAIKey } from "@/utils/key_helper";
import { generateAndStoreInsights } from "@/lib/graph/narrativeInsights";

// Synchronous, direct-await route — project-scoped counterpart to the
// document insights generate route above.
export async function POST(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: projectId } = await params;
  const project = await prisma.project.findFirst({
    where: { id: projectId, user: { email: session.user.email } },
    select: { id: true, userId: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const apiKey = await getUserOpenAIKey(project.userId);
  if (!apiKey) return NextResponse.json({ success: false, error: "OPENAI_KEY_MISSING" }, { status: 400 });

  const openai = new OpenAI({ apiKey });

  const { insights, error } = await generateAndStoreInsights({
    prisma,
    openai,
    projectId,
    documentId: null,
  });

  if (error) return NextResponse.json({ success: false, error }, { status: 500 });
  return NextResponse.json({ success: true, insights });
}
