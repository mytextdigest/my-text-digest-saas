import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  sessionEmail, ownedTable, fullTable, refreshTableCounts, enqueueReembed, unauthorized, notFound,
} from "@/lib/tables/routeUtils";

// desktop "reset-table": drop the edited layer ("Reset to extracted version").
export async function POST(req, { params }) {
  const email = await sessionEmail();
  if (!email) return unauthorized();
  const { tableId } = await params;
  if (!(await ownedTable(tableId, email))) return notFound("Table not found");

  try {
    await prisma.documentTable.update({ where: { id: tableId }, data: { editedJson: Prisma.DbNull, editedAt: null } });
    await refreshTableCounts(tableId);
    await enqueueReembed(tableId);
    return NextResponse.json({ success: true, table: await fullTable(tableId) });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message });
  }
}
