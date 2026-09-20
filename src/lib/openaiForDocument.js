// src/lib/openaiForDocument.js
// Resolves a per-user OpenAI client for a given document — moved here (out
// of worker/openai.js, which now just re-exports it) so both the worker and
// Next.js API routes (e.g. generate-slide-image, a direct-await route, not
// a queued job) can import it from a stable path instead of an API route
// reaching several directories up into worker/.

import OpenAI from "openai";
import { prisma } from "./prisma.mjs";

export async function getOpenAIForDocument(docId) {
  const doc = await prisma.document.findUnique({
    where: { id: docId },
    select: {
      userId: true,
      user: {
        select: {
          settings: {
            where: { key: "openai_api_key" },
            select: { value: true },
            take: 1,
          },
        },
      },
    },
  });

  if (!doc?.user?.settings?.[0]?.value) {
    throw new Error("OPENAI_KEY_MISSING");
  }

  return new OpenAI({
    apiKey: doc.user.settings[0].value,
    // Fail fast into the job's watchdog/retry path instead of hanging the
    // single-threaded worker loop on a stalled request.
    timeout: 120 * 1000,
  });
}
