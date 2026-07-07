export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { parseWorkbook, streamToBuffer } from "@/lib/spreadsheetParser";

const s3 = new S3Client({ region: process.env.AWS_REGION });

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
