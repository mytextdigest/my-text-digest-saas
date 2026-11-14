// src/app/api/slide-decks/[deckId]/audio/settings/route.js
// save-narration-settings — voice / tone / pause between slides.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { saveSettings } from "@/lib/slides/narrationServer";
import { deckFromRequest, ok, serverError } from "@/lib/slides/routeUtils";

export async function PUT(req, { params }) {
  try {
    const ctx = await deckFromRequest(params, { editable: false });
    if (ctx.response) return ctx.response;
    const { voice, tone, gapMs } = await req.json().catch(() => ({}));
    return ok({ settings: await saveSettings(prisma, ctx.deckId, { voice, tone, gapMs }) });
  } catch (err) {
    return serverError("save-narration-settings", err, "Could not save the settings.");
  }
}
