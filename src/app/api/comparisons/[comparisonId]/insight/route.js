import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { getUserOpenAIKey } from "@/utils/key_helper";
import OpenAI from "openai";
import { buildInsight } from "@/lib/compareInsight";

// Compact insight is precomputed with every comparison; descriptive is
// generated lazily here, once, then cached on the comparison row — fast
// enough (one gpt-4o-mini call) to run synchronously in this route, same
// posture as the general-knowledge sub-call being a direct await, no queue
// needed.
export async function POST(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { comparisonId } = await params;
  const { style } = await req.json();
  if (style !== "compact" && style !== "descriptive") {
    return NextResponse.json({ error: "style must be 'compact' or 'descriptive'" }, { status: 400 });
  }

  const comparison = await prisma.documentComparison.findFirst({
    where: { id: comparisonId, project: { user: { email: session.user.email } } },
    include: {
      documentA: { select: { filename: true } },
      documentB: { select: { filename: true } },
    },
  });
  if (!comparison) return NextResponse.json({ error: "Comparison not found" }, { status: 404 });

  const field = style === "descriptive" ? "insightDescriptive" : "insightCompact";
  if (comparison[field]) {
    return NextResponse.json({ success: true, cached: true, insight: comparison[field] });
  }

  if (comparison.status !== "ready") {
    return NextResponse.json({ error: "Comparison must finish generating before an insight can be built." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
  const apiKey = await getUserOpenAIKey(user.id);
  if (!apiKey) return NextResponse.json({ error: "OPENAI_KEY_MISSING" }, { status: 400 });
  const openai = new OpenAI({ apiKey });

  const findings = await prisma.comparisonFinding.findMany({
    where: { comparisonId },
    orderBy: { sortOrder: "asc" },
  });

  const insight = await buildInsight({
    openai,
    findings,
    summary: comparison.summaryJson || [],
    style,
    documentAName: comparison.documentA.filename,
    documentBName: comparison.documentB.filename,
  });

  await prisma.documentComparison.update({
    where: { id: comparisonId },
    data: { [field]: insight },
  });

  return NextResponse.json({ success: true, insight });
}
