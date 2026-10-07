// src/app/api/chat-attachments/presign/route.js
// A presigned POST for one chat image upload. The key comes from the
// session (chat/{userId}/staged/…), never from the client; the register
// route (POST /api/chat-attachments) then validates and normalises it.
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { CHAT_KINDS, stagedKeyPrefix } from "@/lib/chatImages/server";
import { sessionUser, unauthorized, badRequest, fail } from "@/lib/chatImages/routeUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 20 * 1024 * 1024;
const EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

const s3 = new S3Client({ region: process.env.AWS_REGION });

export async function POST(req) {
  try {
    const user = await sessionUser();
    if (!user) return unauthorized();
    const { kind, fileType } = await req.json().catch(() => ({}));
    if (!CHAT_KINDS.has(kind)) return badRequest("Unknown chat.");
    const ext = EXTENSIONS[fileType];
    if (!ext) return badRequest("Attach a PNG, JPG or WEBP image.");

    const key = `${stagedKeyPrefix(user.id)}${randomUUID()}.${ext}`;
    const presigned = await createPresignedPost(s3, {
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Fields: { "Content-Type": fileType },
      Conditions: [
        ["eq", "$Content-Type", fileType],
        ["content-length-range", 1, MAX_BYTES],
      ],
      Expires: 120,
    });
    return NextResponse.json({ success: true, url: presigned.url, fields: presigned.fields, key });
  } catch (err) {
    console.error("❌ chat-attachments/presign:", err);
    return fail(err);
  }
}
