import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import config from "@/lib/tables/config";
import { TABLE_SUMMARY_SELECT, toTableSummary, toLogRecord } from "@/lib/tables/rows";
import { getTableSettings, pendingScannedPages } from "@/lib/tables/cleanup";
import { sessionEmail, ownedDocument, unauthorized, notFound, fail } from "@/lib/tables/routeUtils";

// desktop "list-tables": summary rows, the extraction log, and the scanned
// pages the automatic run didn't reach with a rough cost for checking them
// (the pre-screen skips non-table pages, so it's a ceiling).
export async function GET(req, { params }) {
  const email = await sessionEmail();
  if (!email) return unauthorized();
  const { id: documentId } = await params;
  const doc = await ownedDocument(documentId, email);
  if (!doc) return notFound("Document not found");

  try {
    const [logRow, rows] = await Promise.all([
      prisma.tableExtractionLog.findUnique({ where: { documentId } }),
      prisma.documentTable.findMany({ where: { documentId }, select: TABLE_SUMMARY_SELECT, orderBy: { tableIndex: "asc" } }),
    ]);
    const log = toLogRecord(logRow);
    let vision = null;
    if (log?.vision_json) {
      const v = log.vision_json;
      const pending = pendingScannedPages(v);
      const settings = await getTableSettings(prisma, doc.userId);
      vision = {
        scannedPages: (v.scannedPages || []).length,
        pendingPages: pending.length,
        estimatedCostUsd: +(Math.min(pending.length, config.VISION_MAX_PAGES_ON_DEMAND) * config.VISION_COST_PER_CALL_USD).toFixed(2),
        enabled: settings.vision && settings.llm,
      };
    }
    return NextResponse.json({ success: true, log, tables: rows.map(toTableSummary), vision });
  } catch (err) {
    console.error("list-tables error:", err);
    return NextResponse.json({ success: false, error: err.message, tables: [] }, { status: 500 });
  }
}
