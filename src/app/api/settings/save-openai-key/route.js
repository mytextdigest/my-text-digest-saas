import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma.mjs";

export async function POST(req) {
    const session = await auth();
    if (!session) return 401;
  
    const { apiKey } = await req.json();
  
    // optional validation (same as desktop intent)
    // await validateKey(apiKey);
  
    await prisma.setting.upsert({
      where: {
        userId_key: {
          userId: session.user.id,
          key: "openai_api_key",
        },
      },
      update: { value: apiKey },
      create: {
        userId: session.user.id,
        key: "openai_api_key",
        value: apiKey,
      },
    });
  
    return Response.json({ success: true });
  }
  