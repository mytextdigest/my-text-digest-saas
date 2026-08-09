export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import OpenAI from "openai";
import Tesseract from "tesseract.js";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import s3Client from "@/lib/s3.mjs";
import { streamToBuffer } from "@/lib/spreadsheetParser";
import { getUserOpenAIKey } from "@/utils/key_helper";
import { upsertFigureChunk } from "@/lib/figureChunk";

function getFigureMimeType(format) {
  return format === "jpeg" ? "image/jpeg" : "image/png";
}

// Re-captions one figure synchronously within the request — a single vision
// call is small/fast enough not to need another SQS round trip. Updates the
// linked Chunk's text/embedding in place via the shared upsertFigureChunk
// helper (also used by worker/processFigures.js), rather than creating a
// duplicate chunk on every regenerate.
export async function POST(req, { params }) {
  const { id: documentId, figureId } = await params;

  try {
    const session = await getServerSession();
    if (!session?.user?.email)
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const doc = await prisma.document.findFirst({
      where: { id: documentId, user: { email: session.user.email } },
      select: { id: true, userId: true },
    });
    if (!doc) return NextResponse.json({ success: false, error: "Document not found" }, { status: 404 });

    const figure = await prisma.figure.findFirst({
      where: { id: figureId, documentId: doc.id },
    });
    if (!figure) return NextResponse.json({ success: false, error: "Figure not found" }, { status: 404 });

    const apiKey = await getUserOpenAIKey(doc.userId);
    if (!apiKey) {
      return NextResponse.json({ success: false, error: "OPENAI_KEY_MISSING" }, { status: 400 });
    }
    const openai = new OpenAI({ apiKey });

    await prisma.figure.update({ where: { id: figure.id }, data: { status: "captioning" } });

    const object = await s3Client.send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: figure.s3Key })
    );
    const buffer = await streamToBuffer(object.Body);
    const base64 = buffer.toString("base64");

    const [visionResp, ocrResult] = await Promise.all([
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${getFigureMimeType(figure.format)};base64,${base64}`, detail: "high" } },
            { type: "text", text: "Analyze this figure/diagram from a document. Describe what it shows, key data points, labels, and any visible text. Be concise but thorough." },
          ],
        }],
        max_tokens: 1000,
      }),
      Tesseract.recognize(buffer, "eng", { logger: () => {} }).catch((err) => {
        console.warn(`⚠️  OCR failed for figure ${figure.id}: ${err.message}`);
        return { data: { text: "" } };
      }),
    ]);

    const caption = visionResp.choices[0].message.content;
    const ocrText = ocrResult.data.text.trim();

    const chunkId = await upsertFigureChunk({ prisma, openai, figure, caption, ocrText });

    const updated = await prisma.figure.update({
      where: { id: figure.id },
      data: { caption, ocrText, status: "ready", chunkId, errorMessage: null },
    });

    return NextResponse.json({ success: true, figure: updated });
  } catch (err) {
    console.error("❌ Figure regenerate failed:", err);

    await prisma.figure.update({
      where: { id: figureId },
      data: { status: "error", errorMessage: String(err?.message || err).slice(0, 2000) },
    }).catch(() => {});

    return NextResponse.json({ success: false, error: String(err?.message || err) }, { status: 500 });
  }
}
