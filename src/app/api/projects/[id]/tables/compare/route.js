import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { effectiveTableOf } from "@/lib/tables/schema";
import { deriveComparison } from "@/lib/tables/derive";
import { toTableRecord, toDerived } from "@/lib/tables/rows";
import { getOpenAIForDocument } from "@/lib/openaiForDocument";
import { sessionEmail, ownedProject, unauthorized, notFound } from "@/lib/tables/routeUtils";

// desktop "compare-tables": the Project Tables view compares specific
// tables directly, without chat. Same engine as the compare_tables tool;
// every value comes from the source cells and changes are computed in code.
export async function POST(req, { params }) {
  const email = await sessionEmail();
  if (!email) return unauthorized();
  const { id: projectId } = await params;
  if (!(await ownedProject(projectId, email))) return notFound("Project not found");

  try {
    const { tableIds, periods } = await req.json().catch(() => ({}));
    if (!Array.isArray(tableIds) || tableIds.length < 2) return NextResponse.json({ success: false, error: "Select at least two tables." });
    const records = await prisma.documentTable.findMany({
      where: { id: { in: tableIds }, document: { projectId } },
      include: { document: { select: { id: true, filename: true, createdAt: true } } },
    });
    const byId = new Map(records.map((r) => [r.id, r]));
    const sources = tableIds.map((id) => {
      const r = byId.get(id);
      if (!r) throw new Error("One of the selected tables no longer exists.");
      return {
        documentId: r.document.id, documentName: r.document.filename, createdAt: r.document.createdAt,
        tableId: r.id, tableTitle: r.title, pageStart: r.pageStart, table: effectiveTableOf(toTableRecord(r)),
      };
    });
    let openai = null;
    try { openai = await getOpenAIForDocument(sources[0].documentId); } catch (_) {}
    const result = await deriveComparison(sources, { periods }, { openai, useLLM: !!openai });
    const row = await prisma.derivedTable.create({
      data: {
        projectId, kind: "compare", title: result.title,
        requestJson: { tableIds, periods: periods || null },
        tableJson: result.table,
        sourceTableIds: result.sourceTableIds.map(String),
        warningsJson: result.warnings,
      },
    });
    return NextResponse.json({ success: true, derived: toDerived(row) });
  } catch (err) {
    console.error("compare-tables error:", err);
    return NextResponse.json({ success: false, error: err.message });
  }
}
