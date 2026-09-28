import { NextResponse } from "next/server";
import { computeTableStats } from "@/lib/tables/stats";
import { sessionEmail, ownedTable, fullTable, unauthorized, notFound } from "@/lib/tables/routeUtils";

// desktop "get-table-stats": per-column statistics for Analyze.
export async function GET(req, { params }) {
  const email = await sessionEmail();
  if (!email) return unauthorized();
  const { tableId } = await params;
  if (!(await ownedTable(tableId, email))) return notFound("Table not found");

  try {
    const t = await fullTable(tableId);
    return NextResponse.json({ success: true, stats: computeTableStats(t.effective) });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message });
  }
}
