import { NextResponse } from "next/server";
import { exportTable } from "@/lib/tables/export";
import {
  sessionEmail, ownedTable, fullTable, fileResponse, slugify, EXPORT_FORMATS, unauthorized, notFound, fail,
} from "@/lib/tables/routeUtils";

// desktop "export-table": ?format=xlsx|csv|md|json
export async function GET(req, { params }) {
  const email = await sessionEmail();
  if (!email) return unauthorized();
  const { tableId } = await params;
  if (!(await ownedTable(tableId, email))) return notFound("Table not found");

  try {
    const format = new URL(req.url).searchParams.get("format") || "xlsx";
    if (!EXPORT_FORMATS.has(format)) return NextResponse.json({ success: false, error: `Unsupported export format: ${format}` }, { status: 400 });
    const t = await fullTable(tableId);
    const { data } = exportTable(t.effective, format, { title: t.title, description: t.description });
    return fileResponse({ defaultName: slugify(`${t.documentName || "document"} ${t.title || `table ${t.table_index + 1}`}`), format, data });
  } catch (err) {
    console.error("export-table error:", err);
    return fail(err);
  }
}
