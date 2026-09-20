import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { renderInsightPdf } from "@/lib/compareInsightPdf";

// Server-rendered and streamed, not a native save dialog — replaces the
// desktop's dialog.showSaveDialog + fs.writeFileSync with a Response
// carrying Content-Disposition: attachment, letting the browser's own
// download UI do what the native dialog did on desktop.
export async function GET(req, { params }) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { comparisonId } = await params;
  const { searchParams } = new URL(req.url);
  const style = searchParams.get("style") === "descriptive" ? "descriptive" : "compact";

  const comparison = await prisma.documentComparison.findFirst({
    where: { id: comparisonId, project: { user: { email: session.user.email } } },
    include: {
      documentA: { select: { filename: true } },
      documentB: { select: { filename: true } },
    },
  });
  if (!comparison) return NextResponse.json({ error: "Comparison not found" }, { status: 404 });

  const insight = style === "descriptive" ? comparison.insightDescriptive : comparison.insightCompact;
  if (!insight) {
    return NextResponse.json({ error: "Generate this version first." }, { status: 400 });
  }

  const buffer = await renderInsightPdf({
    comparison: {
      documentAFilename: comparison.documentA.filename,
      documentBFilename: comparison.documentB.filename,
      createdAt: comparison.createdAt,
    },
    insight,
    style,
  });

  const safeName = (s) => (s || "document").replace(/[^a-z0-9._-]+/gi, "_");
  const filename = `${safeName(comparison.documentA.filename)}-vs-${safeName(comparison.documentB.filename)}-${style}-insight.pdf`;

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
