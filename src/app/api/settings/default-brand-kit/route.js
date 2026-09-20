// src/app/api/settings/default-brand-kit/route.js
// get-default-brand-kit / save-default-brand-kit — reuses the existing
// Setting model (same {userId, key, value} shape already used for
// openai_api_key) rather than a new table. `value` is a plain string
// column, so the brand kit object is JSON.stringify'd on save and
// JSON.parse'd on read. Fire-and-forget from the client ("Remember this
// brand" checkbox) — failures here should never block deck generation.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

const SETTING_KEY = "default_brand_kit";

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const setting = await prisma.setting.findUnique({ where: { userId_key: { userId: user.id, key: SETTING_KEY } } });
    const brandKit = setting?.value ? JSON.parse(setting.value) : null;

    return NextResponse.json({ brandKit });
  } catch (err) {
    console.error("get-default-brand-kit error:", err);
    return NextResponse.json({ error: "Failed to load default brand kit" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const value = JSON.stringify(body.brandKit || null);

    await prisma.setting.upsert({
      where: { userId_key: { userId: user.id, key: SETTING_KEY } },
      update: { value },
      create: { userId: user.id, key: SETTING_KEY, value },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("save-default-brand-kit error:", err);
    return NextResponse.json({ error: "Failed to save default brand kit" }, { status: 500 });
  }
}
