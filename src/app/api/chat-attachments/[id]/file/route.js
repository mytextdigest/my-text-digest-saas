// src/app/api/chat-attachments/[id]/file/route.js
// The image bytes, same-origin (the attachment's fileUrl). History URLs
// never expire, and Copy can fetch the bytes without bucket CORS. The bytes
// for an id never change, so the browser may cache them for good.
// ?download=1 serves it as a download (desktop save-image-as).
import { NextResponse } from "next/server";
import { getS3Object } from "@/lib/chatImages/server";
import { sessionUser, ownedAttachment, unauthorized, notFound } from "@/lib/chatImages/routeUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function downloadName(row, requested) {
  const ext = row.mime === "image/webp" ? ".webp" : ".png";
  const base = String(requested || row.originalName || (row.direction === "output" ? "generated-image" : "image"))
    .replace(/[\\/:*?"<>|\r\n]/g, "-")
    .replace(/\.[a-z0-9]+$/i, "")
    .slice(0, 120) || "image";
  return `${base}${ext}`;
}

export async function GET(req, { params }) {
  const user = await sessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  const row = await ownedAttachment(id, user.id);
  if (!row) return notFound("Image not found.");

  let object;
  try {
    object = await getS3Object(row.s3Key);
  } catch (err) {
    return notFound("Image not found.");
  }

  const headers = {
    "Content-Type": row.mime || "image/png",
    "Cache-Control": "private, max-age=31536000, immutable",
  };
  if (object.ContentLength) headers["Content-Length"] = String(object.ContentLength);
  const url = new URL(req.url);
  if (url.searchParams.get("download")) {
    const filename = downloadName(row, url.searchParams.get("name"));
    headers["Content-Disposition"] = `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
  }
  return new NextResponse(object.Body.transformToWebStream(), { headers });
}
