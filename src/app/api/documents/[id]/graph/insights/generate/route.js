import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { getOpenAIForDocument } from "@/lib/openaiForDocument";
import { generateAndStoreInsights } from "@/lib/graph/narrativeInsights";

// Synchronous, direct-await route — one LLM call, a few seconds — same
// posture as the comparison insight route in the sibling document-comparison
// spec; no queue needed.
export async function POST(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: documentId } = await params;
  const doc = await prisma.document.findFirst({
    where: { id: documentId, user: { email: session.user.email } },
    select: { id: true, projectId: true },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let openai;
  try {
    openai = await getOpenAIForDocument(documentId);
  } catch (err) {
    return NextResponse.json({ success: false, error: "OPENAI_KEY_MISSING" }, { status: 400 });
  }

  const { insights, error } = await generateAndStoreInsights({
    prisma,
    openai,
    projectId: doc.projectId,
    documentId,
  });

  if (error) return NextResponse.json({ success: false, error }, { status: 500 });
  return NextResponse.json({ success: true, insights });
}
