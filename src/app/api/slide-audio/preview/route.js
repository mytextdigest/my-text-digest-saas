// src/app/api/slide-audio/preview/route.js
// preview-narration-voice — a short sample of a voice + tone, cached in S3
// under slide-audio/_previews/ so replaying is free. Returns a signed URL.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { prisma } from "@/lib/prisma";
import { getOpenAIForUser } from "@/lib/openaiForDocument";
import { previewVoiceUrl, friendlyTtsError } from "@/lib/slides/narrationServer";
import { sessionEmail, ok, fail } from "@/lib/slides/routeUtils";

export async function POST(req) {
  try {
    const email = await sessionEmail();
    if (!email) return fail("Unauthorized", 401);
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) return fail("Unauthorized", 401);
    const { voice, tone } = await req.json().catch(() => ({}));
    const url = await previewVoiceUrl({ openai: await getOpenAIForUser(user.id), voice, tone });
    return ok({ url });
  } catch (err) {
    console.error("❌ Error previewing voice:", err);
    return fail(friendlyTtsError(err.message), 500);
  }
}
