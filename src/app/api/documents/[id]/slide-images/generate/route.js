// src/app/api/documents/[id]/slide-images/generate/route.js
// generate-slide-image — direct await (one gpt-image-1 call), same posture
// as other single-call routes in this series (not enqueued — the aspect-
// ratio picker + 400-char prompt cap keep this fast/bounded enough for a
// synchronous request/response).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getOpenAIForDocument } from "@/lib/openaiForDocument.js";
import { buildOnDemandImagePrompt, generateSlideImageBuffer, GENERATE_IMAGE_SIZES, DEFAULT_GENERATE_IMAGE_SIZE } from "@/lib/slides/imagePrompt.js";
import { uploadImageBufferToS3, resolveSlideImageUrl } from "@/lib/slides/imageStorage.js";
import { resolveTheme } from "@/lib/slides/theme.js";

export async function POST(req, { params }) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: documentId } = await params;
    const doc = await prisma.document.findFirst({ where: { id: documentId, user: { email: session.user.email } } });
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const userPrompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 400) : "";
    if (!userPrompt) return NextResponse.json({ error: "Missing prompt" }, { status: 400 });

    const size = GENERATE_IMAGE_SIZES.has(body.size) ? body.size : DEFAULT_GENERATE_IMAGE_SIZE;

    // Slide/deck/palette context is optional additive grounding (the
    // panel's "include this slide's context" checkbox) — never overriding
    // the user's own typed prompt, which IS the subject here. Resolved
    // server-side from deckId/slideIndex (scoped to this same document, so
    // a tampered deckId just yields no context rather than leaking another
    // deck's outline) rather than trusting a client-supplied outline/theme
    // payload.
    let context = {};
    if (body.includeContext && body.deckId && Number.isInteger(body.slideIndex)) {
      const deck = await prisma.slideDeck.findFirst({ where: { id: body.deckId, documentId } });
      const outline = deck?.outlineJson;
      const slide = outline?.slides?.[body.slideIndex];
      if (outline && slide) {
        const theme = resolveTheme(outline.paletteName, outline.fontPairName, outline.brandKit?.active ? outline.brandKit.colors : null);
        context = { slide, outline, theme };
      }
    }

    const prompt = buildOnDemandImagePrompt(userPrompt, context);
    const openai = await getOpenAIForDocument(documentId);
    const buffer = await generateSlideImageBuffer(openai, prompt, size);

    const key = `uploads/${doc.userId}/${doc.projectId}/${documentId}/slides/${crypto.randomUUID()}.png`;
    await uploadImageBufferToS3(buffer, key, "image/png");

    const image = await prisma.slideImage.create({
      data: { documentId, s3Key: key, format: "png", source: "generated", prompt: userPrompt },
    });

    return NextResponse.json({ image: { ...image, url: await resolveSlideImageUrl(key) } });
  } catch (err) {
    console.error("generate-slide-image error:", err);
    return NextResponse.json({ error: "Failed to generate slide image" }, { status: 500 });
  }
}
