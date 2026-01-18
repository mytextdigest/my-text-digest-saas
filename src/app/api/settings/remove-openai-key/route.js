import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth"; // or wherever your NextAuth helper lives

export async function POST() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  await prisma.setting.deleteMany({
    where: {
      userId: session.user.id,
      key: "openai_api_key",
    },
  });

  return NextResponse.json({ success: true });
}
