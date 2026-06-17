export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const s3 = new S3Client({ region: process.env.AWS_REGION });

const MAX_ROWS = 1000;

async function streamToBuffer(stream) {
  const parts = [];
  for await (const chunk of stream) parts.push(chunk);
  return Buffer.concat(parts);
}

function parseWorkbook(buffer, filename) {
  const isCsv = filename.toLowerCase().endsWith(".csv");
  const workbook = isCsv
    ? XLSX.read(buffer.toString("utf8"), { type: "string" })
    : XLSX.read(buffer, { type: "buffer" });

  return workbook.SheetNames.map((name) => {
    const ws = workbook.Sheets[name];
    const raw = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      blankrows: false,
      defval: "",
    });

    if (raw.length === 0) {
      return { name, headers: [], rows: [], totalRows: 0 };
    }

    const headers = raw[0].map((h) => String(h ?? "").trim());
    const dataRows = raw.slice(1);
    const totalRows = dataRows.length;

    const rows = dataRows.slice(0, MAX_ROWS).map((row) => {
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h || `Col${idx + 1}`] = String(row[idx] ?? "");
      });
      return obj;
    });

    return { name, headers, rows, totalRows };
  });
}

export async function GET(req) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const documentId = searchParams.get("documentId");
    if (!documentId)
      return NextResponse.json({ error: "Missing documentId" }, { status: 400 });

    const doc = await prisma.document.findFirst({
      where: { id: documentId, user: { email: session.user.email } },
      select: { filePath: true, filename: true },
    });

    if (!doc || !doc.filePath)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    const ext = doc.filename?.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext))
      return NextResponse.json({ error: "Not a spreadsheet" }, { status: 400 });

    const object = await s3.send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: doc.filePath })
    );
    const buffer = await streamToBuffer(object.Body);
    const sheets = parseWorkbook(buffer, doc.filename);

    return NextResponse.json({ success: true, sheets });
  } catch (err) {
    console.error("❌ spreadsheet-data error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
