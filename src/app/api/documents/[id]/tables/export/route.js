import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { effectiveTableOf } from "@/lib/tables/schema";
import { exportAll } from "@/lib/tables/export";
import { toTableRecord } from "@/lib/tables/rows";
import { sessionEmail, ownedDocument, fileResponse, slugify, unauthorized, notFound, fail } from "@/lib/tables/routeUtils";

// desktop "export-all-tables": one XLSX workbook, an Index sheet plus one
// sheet per table.
export async function GET(req, { params }) {
  const email = await sessionEmail();
  if (!email) return unauthorized();
  const { id: documentId } = await params;
  const doc = await ownedDocument(documentId, email);
  if (!doc) return notFound("Document not found");

  try {
    const records = (await prisma.documentTable.findMany({
      where: { documentId, status: "ready" },
      orderBy: { tableIndex: "asc" },
    })).map(toTableRecord);
    if (!records.length) return NextResponse.json({ success: false, error: "No tables to export." }, { status: 404 });
    const data = exportAll(records.map((r) => ({
      table: effectiveTableOf(r), title: r.title, description: r.description,
      pageStart: r.page_start, pageEnd: r.page_end, sheetName: r.sheet_name, edited: !!r.edited_json,
    })), { docName: doc.filename });
    return fileResponse({ defaultName: slugify(`${doc.filename || "document"} tables`), format: "xlsx", data });
  } catch (err) {
    console.error("export-all-tables error:", err);
    return fail(err);
  }
}
