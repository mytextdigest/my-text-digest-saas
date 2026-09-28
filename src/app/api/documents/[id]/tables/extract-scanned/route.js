import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import config from "@/lib/tables/config";
import { getTableSettings, pendingScannedPages } from "@/lib/tables/cleanup";
import { sessionEmail, ownedDocument, enqueueJob, unauthorized, notFound, fail } from "@/lib/tables/routeUtils";

const SCAN_BATCH_PAGES = 8; // worker/processTables.js SCAN_BATCH_PAGES

// desktop "extract-scanned-tables": reads the scanned pages the automatic
// run left unchecked (cost cap). The UI shows the estimate from the list
// route before calling this.
export async function POST(req, { params }) {
  const email = await sessionEmail();
  if (!email) return unauthorized();
  const { id: documentId } = await params;
  const doc = await ownedDocument(documentId, email);
  if (!doc) return notFound("Document not found");

  try {
    if (!doc.filePath) return NextResponse.json({ success: false, error: "The original file is no longer available." });
    const log = await prisma.tableExtractionLog.findUnique({ where: { documentId } });
    if (log?.status === "running") return NextResponse.json({ success: true, alreadyRunning: true });

    const key = await prisma.setting.findUnique({ where: { userId_key: { userId: doc.userId, key: "openai_api_key" } }, select: { value: true } });
    if (!key?.value) return NextResponse.json({ success: false, error: "Add an OpenAI API key in Settings to read scanned pages." });
    const settings = await getTableSettings(prisma, doc.userId);
    if (!settings.vision || !settings.llm) return NextResponse.json({ success: false, error: "Reading tables from images is turned off in settings." });

    const pending = pendingScannedPages(log?.visionJson).slice(0, config.VISION_MAX_PAGES_ON_DEMAND);
    if (!pending.length) return NextResponse.json({ success: true, pages: 0 });

    await prisma.tableExtractionLog.update({
      where: { documentId },
      data: {
        status: "running",
        completedAt: null,
        visionJson: { ...log.visionJson, progress: { done: 0, total: pending.length } },
      },
    });
    await enqueueJob({
      type: "tables-scan", docId: documentId, s3Key: doc.filePath, filename: doc.filename, auto: false,
      runStartedAt: log.startedAt.toISOString(),
      pages: pending.slice(0, SCAN_BATCH_PAGES), remaining: pending.slice(SCAN_BATCH_PAGES), done: 0, total: pending.length,
    });
    return NextResponse.json({ success: true, pages: pending.length });
  } catch (err) {
    console.error("extract-scanned-tables error:", err);
    return fail(err);
  }
}
