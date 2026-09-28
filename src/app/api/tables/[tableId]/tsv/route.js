import { NextResponse } from "next/server";
import { toTSV } from "@/lib/tables/serialize";
import { sessionEmail, ownedTable, fullTable, unauthorized, notFound, fail } from "@/lib/tables/routeUtils";

// desktop "copy-table": the TSV text; the client puts it on the clipboard.
export async function GET(req, { params }) {
  const email = await sessionEmail();
  if (!email) return unauthorized();
  const { tableId } = await params;
  if (!(await ownedTable(tableId, email))) return notFound("Table not found");

  try {
    const t = await fullTable(tableId);
    return new NextResponse(toTSV(t.effective), { headers: { "Content-Type": "text/tab-separated-values; charset=utf-8" } });
  } catch (err) {
    return fail(err);
  }
}
