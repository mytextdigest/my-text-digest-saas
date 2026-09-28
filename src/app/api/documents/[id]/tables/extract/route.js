import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { removeTablesForDocument } from "@/lib/tables/cleanup";
import { sessionEmail, ownedDocument, enqueueJob, unauthorized, notFound, fail } from "@/lib/tables/routeUtils";

// desktop "extract-tables" — backfill / re-run (FR-37). Tables the user
// edited or renamed stay until the worker has read them: it carries the
// edits over when the same table (same position and page/sheet) is found
// again, then replaces them. Figures are checked for tables again after
// the main run (the worker enqueues tables-figures).
// Same list as src/lib/tables/index.js supportsTables(), which isn't
// imported here: it pulls the PDF/OCR stack into the route bundle.
const TABLE_EXT = [".pdf", ".docx", ".xlsx", ".xls", ".csv", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"];
const supportsTables = (filename) => TABLE_EXT.some((e) => String(filename || "").toLowerCase().endsWith(e));

export async function POST(req, { params }) {
  const email = await sessionEmail();
  if (!email) return unauthorized();
  const { id: documentId } = await params;
  const doc = await ownedDocument(documentId, email);
  if (!doc) return notFound("Document not found");

  try {
    if (!supportsTables(doc.filename)) {
      return NextResponse.json({ success: false, error: "Tables can be extracted from PDF, Word, spreadsheet and image files." });
    }
    if (!doc.filePath) return NextResponse.json({ success: false, error: "The original file is no longer available." });
    const log = await prisma.tableExtractionLog.findUnique({ where: { documentId }, select: { status: true } });
    if (log?.status === "running") return NextResponse.json({ success: true, alreadyRunning: true });

    const preservedEdits = await prisma.documentTable.count({
      where: { documentId, OR: [{ editedAt: { not: null } }, { titleSource: "user" }] },
    });
    await prisma.$transaction(async (tx) => {
      await removeTablesForDocument(tx, documentId, {
        keepLog: true,
        where: { editedAt: null, NOT: { titleSource: "user" } },
      });
      await tx.figure.updateMany({ where: { documentId }, data: { tableScan: null } });
      await tx.tableExtractionLog.upsert({
        where: { documentId },
        create: { documentId, status: "running" },
        update: { status: "running", errorMessage: null, completedAt: null },
      });
    }, { timeout: 60000 });

    await enqueueJob({
      type: "tables", docId: documentId, s3Key: doc.filePath, filename: doc.filename,
      projectId: doc.projectId, userId: doc.userId, rerun: true,
    });
    return NextResponse.json({ success: true, preservedEdits });
  } catch (err) {
    console.error("extract-tables error:", err);
    return fail(err);
  }
}
