import { NextResponse } from "next/server";
import { getUserOpenAIKey } from "@/utils/key_helper";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const apiKey = await getUserOpenAIKey(session.user.id);

  return NextResponse.json({
    key: apiKey || null,
  });
}
