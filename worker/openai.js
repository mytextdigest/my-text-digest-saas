import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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
  });
}
