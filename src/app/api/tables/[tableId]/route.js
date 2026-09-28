import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateTable, effectiveTableOf } from "@/lib/tables/schema";
import { recleanEdited } from "@/lib/tables/clean";
import { toTableRecord } from "@/lib/tables/rows";
import { removeTableChunks, removeDerivedTablesFor } from "@/lib/tables/cleanup";
import {
  sessionEmail, ownedTable, fullTable, refreshTableCounts, enqueueReembed, unauthorized, notFound, fail,
} from "@/lib/tables/routeUtils";

// desktop "get-table"
export async function GET(req, { params }) {
  const email = await sessionEmail();
  if (!email) return unauthorized();
  const { tableId } = await params;
  if (!(await ownedTable(tableId, email))) return notFound("Table not found");
  const table = await fullTable(tableId);
  return table ? NextResponse.json({ success: true, table }) : notFound("Table not found");
}

// desktop "update-table": title/description and/or the whole edited grid.
export async function PATCH(req, { params }) {
  const email = await sessionEmail();
  if (!email) return unauthorized();
  const { tableId } = await params;
  const record = await ownedTable(tableId, email);
  if (!record) return notFound("Table not found");

  try {
    const { title, description, editedJson } = await req.json().catch(() => ({}));
    let contentChanged = false;
    if (title !== undefined || description !== undefined) {
      const newTitle = title !== undefined ? String(title).trim().slice(0, 120) || record.title : record.title;
      const newDescription = description !== undefined ? String(description).trim().slice(0, 500) || null : record.description;
      await prisma.documentTable.update({
        where: { id: tableId },
        data: { title: newTitle, description: newDescription, titleSource: "user" },
      });
      contentChanged = true;
    }
    if (editedJson !== undefined) {
      const validated = validateTable(typeof editedJson === "string" ? JSON.parse(editedJson) : editedJson);
      const edited = recleanEdited(validated, { previous: effectiveTableOf(toTableRecord(record)) });
      await prisma.documentTable.update({ where: { id: tableId }, data: { editedJson: edited, editedAt: new Date() } });
      await refreshTableCounts(tableId);
      contentChanged = true;
    }
    if (contentChanged) await enqueueReembed(tableId);
    return NextResponse.json({ success: true, table: await fullTable(tableId) });
  } catch (err) {
    console.error("update-table error:", err);
    return NextResponse.json({ success: false, error: err.message });
  }
}

// desktop "delete-table" ("Not a real table? Remove it.")
export async function DELETE(req, { params }) {
  const email = await sessionEmail();
  if (!email) return unauthorized();
  const { tableId } = await params;
  const record = await ownedTable(tableId, email);
  if (!record) return notFound("Table not found");

  try {
    await prisma.$transaction(async (tx) => {
      await removeTableChunks(tx, [tableId], record.documentId);
      await removeDerivedTablesFor(tx, [tableId]);
      await tx.documentTable.delete({ where: { id: tableId } });
      const remaining = await tx.documentTable.count({ where: { documentId: record.documentId } });
      await tx.tableExtractionLog.updateMany({ where: { documentId: record.documentId }, data: { tablesFound: remaining } });
    }, { timeout: 60000 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("delete-table error:", err);
    return fail(err);
  }
}
