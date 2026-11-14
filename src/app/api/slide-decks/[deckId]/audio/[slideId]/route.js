// src/app/api/slide-decks/[deckId]/audio/[slideId]/route.js
// POST: save-slide-audio — records a clip the browser uploaded to the key
// issued by …/upload-url. MP3 and WAV are measured here
// (mp3DurationMs / wavDurationMs); other formats use the browser's
// measurement (`durationMs`), the same fallback as desktop. A WebM
// recording also gets an `audio-remux` job, which rewrites its header with
// the real length (desktop: remuxInPlace).
// DELETE: delete-slide-audio — removes the clip; the script stays.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { prisma } from "@/lib/prisma";
import { AUDIO_TYPES } from "@/lib/slides/narration";
import { isClipKeyFor, extOf, measureDuration, upsert, loadSlideAudio } from "@/lib/slides/narrationServer";
import { s3GetBytes, s3Delete, startMediaJob } from "@/lib/slides/deckServer";
import { deckFromRequest, ok, fail, serverError } from "@/lib/slides/routeUtils";

export async function POST(req, { params }) {
  let uploadedKey = null;
  try {
    const ctx = await deckFromRequest(params);
    if (ctx.response) return ctx.response;
    const { slideId } = await params;
    const { s3Key, durationMs, source } = await req.json().catch(() => ({}));
    if (!isClipKeyFor(s3Key, ctx.deckId, slideId)) return fail("That upload doesn't belong to this slide.");
    uploadedKey = s3Key;
    if (!ctx.outline.slides.some((s) => s.id === slideId)) {
      await s3Delete(s3Key);
      return fail("That slide no longer exists.", 404);
    }

    const ext = extOf(s3Key);
    let bytes = null;
    if (ext === ".mp3" || ext === ".wav") {
      try { bytes = await s3GetBytes(s3Key); } catch (e) { return fail("The upload didn't arrive. Try again."); }
      if (!bytes.length) { await s3Delete(s3Key); return fail("That file looks empty."); }
    }
    const ms = measureDuration(ext, bytes ? new Uint8Array(bytes) : null, durationMs);
    if (!ms) {
      await s3Delete(s3Key);
      return fail("Couldn't read that audio file. Try an MP3 or WAV.");
    }
    await upsert(prisma, ctx.deckId, slideId, {
      source: source === "recorded" ? "recorded" : "uploaded",
      s3Key, mime: AUDIO_TYPES[ext], durationMs: ms, voice: null, audioScriptHash: null,
    });
    uploadedKey = null;
    if (ext === ".webm") {
      // Recordings: give the file a real duration in its header.
      await startMediaJob(prisma, { deckId: ctx.deckId, kind: "audio-remux", slideId, payload: { s3Key } })
        .catch((err) => console.error("⚠️  Could not queue the recording fix-up:", err.message || err));
    }
    return ok({ audio: await loadSlideAudio(prisma, ctx.deckId) });
  } catch (err) {
    if (uploadedKey) await s3Delete(uploadedKey);
    return serverError("save-slide-audio", err, "Could not save the audio.");
  }
}

export async function DELETE(req, { params }) {
  try {
    const ctx = await deckFromRequest(params, { editable: false });
    if (ctx.response) return ctx.response;
    const { slideId } = await params;
    const row = await prisma.slideAudio.findUnique({ where: { deckId_slideId: { deckId: ctx.deckId, slideId } } });
    if (row) {
      await upsert(prisma, ctx.deckId, slideId, { source: null, s3Key: null, mime: null, durationMs: null, voice: null, audioScriptHash: null });
    }
    return ok({ audio: await loadSlideAudio(prisma, ctx.deckId) });
  } catch (err) {
    return serverError("delete-slide-audio", err, "Could not remove the audio.");
  }
}
