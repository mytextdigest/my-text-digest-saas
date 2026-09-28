// src/lib/tables/routeUtils.js
// Shared plumbing for the table API routes (the desktop's IPC handlers):
// session + ownership checks, the desktop's fullTable/refreshTableCounts,
// file download responses and SQS enqueueing. Server-only.
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { prisma } from "@/lib/prisma";
import { generateSignedUrl } from "@/lib/s3SignedUrl";
import { effectiveTableOf } from "./schema.js";
import { toTableRecord } from "./rows.js";

export const unauthorized = () => NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
export const notFound = (error = "Not found") => NextResponse.json({ success: false, error }, { status: 404 });
export const fail = (err, status = 500) =>
  NextResponse.json({ success: false, error: err?.message || String(err) }, { status });

export async function sessionEmail() {
  const session = await getServerSession();
  return session?.user?.email || null;
}

export function ownedDocument(documentId, email, select = { id: true, filename: true, filePath: true, projectId: true, userId: true }) {
  return prisma.document.findFirst({ where: { id: documentId, user: { email } }, select });
}

export function ownedProject(projectId, email) {
  return prisma.project.findFirst({ where: { id: projectId, user: { email } }, select: { id: true, userId: true } });
}

export function ownedTable(tableId, email) {
  return prisma.documentTable.findFirst({
    where: { id: tableId, document: { user: { email } } },
    include: { document: { select: { id: true, filename: true, filePath: true, projectId: true } } },
  });
}

export async function ownedDerived(id, email) {
  const row = await prisma.derivedTable.findUnique({ where: { id } });
  if (!row) return null;
  if (row.projectId && (await ownedProject(row.projectId, email))) return row;
  if (row.documentId && (await ownedDocument(row.documentId, email, { id: true }))) return row;
  return null;
}

// The picture a vision-read table came from, for the viewer's side-by-side
// check: the embedded figure, or the uploaded image itself. Scanned-page
// tables use "Show in document" instead.
async function tableSourceImageUrl(t) {
  try {
    if (t.figureId) {
      const fig = await prisma.figure.findUnique({ where: { id: t.figureId }, select: { s3Key: true } });
      if (fig?.s3Key) return await generateSignedUrl(fig.s3Key);
    }
    if (t.sourceType === "image_vision" && t.document?.filePath) return await generateSignedUrl(t.document.filePath);
  } catch (_) {}
  return null;
}

// desktop fullTable(): the record plus its parsed layers.
export async function fullTable(tableId) {
  const t = await prisma.documentTable.findUnique({
    where: { id: tableId },
    include: { document: { select: { id: true, filename: true, filePath: true, projectId: true } } },
  });
  if (!t) return null;
  const { raw_json, clean_json, edited_json, signature_embedding, ...rest } = toTableRecord(t);
  const raw = t.rawJson ?? null;
  const clean = t.cleanJson ?? null;
  const edited = t.editedJson ?? null;
  return {
    ...rest,
    edited: !!edited,
    documentName: t.document?.filename,
    projectId: t.document?.projectId ?? null,
    raw,
    clean,
    editedTable: edited,
    effective: edited || clean || raw,
    sourceImageUrl: await tableSourceImageUrl(t),
  };
}

export async function refreshTableCounts(tableId) {
  const t = await prisma.documentTable.findUnique({ where: { id: tableId } });
  const eff = effectiveTableOf(toTableRecord(t));
  if (eff) {
    await prisma.documentTable.update({ where: { id: tableId }, data: { rowCount: eff.rows.length, colCount: eff.columns.length } });
  }
}

let sqs;
export async function enqueueJob(body) {
  sqs ||= new SQSClient({ region: process.env.AWS_REGION });
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.SQS_QUEUE_URL, MessageBody: JSON.stringify(body) }));
}

// The re-embed is best effort: an edit is saved even if the queue is down.
export async function enqueueReembed(tableId) {
  try {
    await enqueueJob({ type: "tables-reembed", tableId });
  } catch (err) {
    console.error(`⚠️  Failed to enqueue table re-embed (${tableId}):`, err.message);
  }
}

export function slugify(text) {
  return String(text || "table")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60) || "table";
}

const CONTENT_TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  json: "application/json; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
};

// desktop saveTableFile(): here the route returns the file itself.
export function fileResponse({ defaultName, format, data }) {
  const filename = `${defaultName}.${format}`;
  return new NextResponse(data, {
    headers: {
      "Content-Type": CONTENT_TYPES[format] || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}

export const EXPORT_FORMATS = new Set(["xlsx", "csv", "md", "json"]);
