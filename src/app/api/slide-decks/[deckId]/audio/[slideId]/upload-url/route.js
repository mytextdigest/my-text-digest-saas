// src/app/api/slide-decks/[deckId]/audio/[slideId]/upload-url/route.js
// A presigned POST for one narration clip (upload or in-app recording). The
// key is chosen here — slide-audio/<deckId>/<slideId>-<ts>-<rand>.<ext> —
// never by the client; POST …/audio/[slideId] then records it.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { AUDIO_TYPES, MAX_AUDIO_BYTES } from "@/lib/slides/narration";
import { clipKey, extOf } from "@/lib/slides/narrationServer";
import { s3Client } from "@/lib/slides/deckServer";
import { deckFromRequest, ok, fail, serverError } from "@/lib/slides/routeUtils";

export async function POST(req, { params }) {
  try {
    const ctx = await deckFromRequest(params);
    if (ctx.response) return ctx.response;
    const { slideId } = await params;
    if (!ctx.outline.slides.some((s) => s.id === slideId)) return fail("That slide no longer exists.", 404);
    const { filename, size } = await req.json().catch(() => ({}));
    const ext = extOf(filename);
    if (!AUDIO_TYPES[ext]) return fail("Use an MP3, M4A, WAV, OGG or WEBM audio file.");
    if (!size) return fail("That file looks empty.");
    if (size > MAX_AUDIO_BYTES) return fail("Audio files must be under 100 MB.");

    const key = clipKey(ctx.deckId, slideId, ext);
    const presigned = await createPresignedPost(s3Client(), {
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Fields: { "Content-Type": AUDIO_TYPES[ext] },
      Conditions: [
        ["eq", "$Content-Type", AUDIO_TYPES[ext]],
        ["content-length-range", 1, MAX_AUDIO_BYTES],
      ],
      Expires: 600,
    });
    return ok({ url: presigned.url, fields: presigned.fields, key });
  } catch (err) {
    return serverError("slide-audio upload-url", err, "Could not start the upload.");
  }
}
