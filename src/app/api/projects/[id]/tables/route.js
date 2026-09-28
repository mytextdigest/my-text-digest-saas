import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toTableSummary } from "@/lib/tables/rows";
import { sessionEmail, ownedProject, unauthorized, notFound } from "@/lib/tables/routeUtils";

// desktop "list-project-tables": every ready table in the project, filtered
// by ?q= over title, description, signature and document name.
export async function GET(req, { params }) {
  const email = await sessionEmail();
  if (!email) return unauthorized();
  const { id: projectId } = await params;
  if (!(await ownedProject(projectId, email))) return notFound("Project not found");

  try {
    const q = String(new URL(req.url).searchParams.get("q") || "").trim().toLowerCase();
    const rows = await prisma.documentTable.findMany({
      where: { status: "ready", document: { projectId } },
      select: {
        id: true, documentId: true, tableIndex: true, pageStart: true, pageEnd: true, sheetName: true, sourceType: true,
        title: true, titleSource: true, description: true, confidence: true, rowCount: true, colCount: true,
        groundingIssues: true, status: true, editedAt: true, signature: true,
        document: { select: { filename: true } },
      },
      orderBy: [{ document: { filename: "asc" } }, { tableIndex: "asc" }],
    });
    const tables = rows
      .filter((r) => !q || `${r.title || ""} ${r.description || ""} ${r.signature || ""} ${r.document.filename}`.toLowerCase().includes(q))
      .map((r) => ({ ...toTableSummary(r), document_name: r.document.filename }));
    return NextResponse.json({ success: true, tables });
  } catch (err) {
    console.error("list-project-tables error:", err);
    return NextResponse.json({ success: false, error: err.message, tables: [] }, { status: 500 });
  }
}
