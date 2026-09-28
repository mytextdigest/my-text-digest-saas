import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { effectiveTableOf } from "@/lib/tables/schema";
import { applyAction } from "@/lib/tables/clean";
import { toTableRecord } from "@/lib/tables/rows";
import {
  sessionEmail, ownedTable, fullTable, refreshTableCounts, enqueueReembed, unauthorized, notFound,
} from "@/lib/tables/routeUtils";

// desktop "apply-table-action": transpose, promote header, set type/unit,
// remove rows/columns, set row kind. The result is saved as the edited layer.
export async function POST(req, { params }) {
  const email = await sessionEmail();
  if (!email) return unauthorized();
  const { tableId } = await params;
  const record = await ownedTable(tableId, email);
  if (!record) return notFound("Table not found");

  try {
    const { action, args = {} } = await req.json().catch(() => ({}));
    const next = applyAction(effectiveTableOf(toTableRecord(record)), action, args);
    await prisma.documentTable.update({ where: { id: tableId }, data: { editedJson: next, editedAt: new Date() } });
    await refreshTableCounts(tableId);
    await enqueueReembed(tableId);
    return NextResponse.json({ success: true, table: await fullTable(tableId) });
  } catch (err) {
    console.error("apply-table-action error:", err);
    return NextResponse.json({ success: false, error: err.message });
  }
}
