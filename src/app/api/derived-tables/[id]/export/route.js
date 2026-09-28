import { NextResponse } from "next/server";
import { exportDerived } from "@/lib/tables/export";
import { toDerived } from "@/lib/tables/rows";
import { sessionEmail, ownedDerived, fileResponse, slugify, EXPORT_FORMATS, unauthorized, fail } from "@/lib/tables/routeUtils";

// desktop "export-derived-table": ?format=xlsx|csv|md|json (XLSX adds a
// Sources sheet with each value's document, table and page).
export async function GET(req, { params }) {
  const email = await sessionEmail();
  if (!email) return unauthorized();
  const { id } = await params;
  const row = await ownedDerived(id, email);
  if (!row) return NextResponse.json({ success: false, error: "This comparison table is no longer available." }, { status: 404 });

  try {
    const format = new URL(req.url).searchParams.get("format") || "xlsx";
    if (!EXPORT_FORMATS.has(format)) return NextResponse.json({ success: false, error: `Unsupported export format: ${format}` }, { status: 400 });
    const d = toDerived(row);
    const { data } = exportDerived(d.table, format, { title: d.title, warnings: d.warnings });
    return fileResponse({ defaultName: slugify(d.title || "comparison"), format, data });
  } catch (err) {
    console.error("export-derived-table error:", err);
    return fail(err);
  }
}
