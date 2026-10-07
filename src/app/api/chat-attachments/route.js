// src/app/api/chat-attachments/route.js
// Registers an image the browser uploaded to its staged key (desktop
// upload-chat-attachment). PNG and JPEG are normalised like the desktop's
// storeChatImage — fit inside 2048 px, re-encoded as PNG — in pure JS (no
// EXIF rotation without sharp). WebP has no decoder here and is stored as
// is. The row stays staged (messageId null) until a message binds it.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decodeImage, resize, encodePng, sniffFormat } from "@/lib/tables/vision/imageOps";
import {
  CHAT_KINDS, stagedKeyPrefix, chatImageKey, readS3Buffer, putS3Object, deleteS3Keys,
  chatAttachmentToClient, sweepStagedAttachments,
} from "@/lib/chatImages/server";
import { sessionUser, unauthorized, badRequest, fail } from "@/lib/chatImages/routeUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_SIDE = 2048;

function normalise(buffer) {
  const format = sniffFormat(buffer);
  if (format === "webp") return { buffer, mime: "image/webp", width: null, height: null };
  if (format !== "png" && format !== "jpeg") return null;
  const img = decodeImage(buffer);
  if (!img) return null;
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const pixels = scale < 1 ? resize(img.data, img.width, img.height, 4, width, height) : img.data;
  return { buffer: encodePng(pixels, width, height, 4), mime: "image/png", width, height };
}

export async function POST(req) {
  let stagedKey = null;
  try {
    const user = await sessionUser();
    if (!user) return unauthorized();
    const { key, kind, originalName } = await req.json().catch(() => ({}));
    if (!CHAT_KINDS.has(kind)) return badRequest("Unknown chat.");
    if (typeof key !== "string" || !key.startsWith(stagedKeyPrefix(user.id)) || key.includes("..") || key.slice(stagedKeyPrefix(user.id).length).includes("/")) {
      return badRequest("Invalid upload.");
    }
    stagedKey = key;

    let original;
    try {
      original = await readS3Buffer(key);
    } catch (err) {
      return badRequest("The upload could not be found. Please attach the image again.");
    }
    if (!original.length) return badRequest("That file looks empty.");
    if (original.length > MAX_BYTES) return badRequest("Images must be under 20MB.");

    const image = normalise(original);
    if (!image) return badRequest("Attach a PNG, JPG or WEBP image.");

    const s3Key = chatImageKey(user.id, kind, image.mime);
    await putS3Object(s3Key, image.buffer, image.mime);
    const row = await prisma.chatAttachment.create({
      data: {
        userId: user.id,
        messageKind: kind,
        messageId: null,
        direction: "input",
        s3Key,
        originalName: typeof originalName === "string" ? originalName.slice(0, 200) : null,
        mime: image.mime,
        width: image.width,
        height: image.height,
        sizeBytes: image.buffer.length,
      },
    });

    sweepStagedAttachments(user.id).catch((err) => console.warn("⚠️  Chat attachment sweep skipped:", err.message));
    return NextResponse.json({ success: true, attachment: chatAttachmentToClient(row) });
  } catch (err) {
    console.error("❌ chat-attachments register:", err);
    return fail(new Error("Could not read that image."));
  } finally {
    if (stagedKey) await deleteS3Keys([stagedKey]);
  }
}
