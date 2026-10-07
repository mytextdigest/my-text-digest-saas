// src/app/api/documents/ingest/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { createDocumentFromS3 } from "@/lib/documents/createDocumentFromS3";

export async function POST(req) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const formData = await req.formData();
    const projectId = formData.get("projectId");
    const s3Key = formData.get("s3Key");
    const visibility = formData.get("visibility") || "private";


    if (!projectId || !s3Key) {
      return NextResponse.json({ error: "Missing projectId or s3Key" }, { status: 400 });
    }

    if (!["public", "private"].includes(visibility)) {
      return NextResponse.json({ error: "Invalid visibility" }, { status: 400 });
    }

    const dbUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });

    if (!dbUser)
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    const result = await createDocumentFromS3({ userId: dbUser.id, projectId, s3Key, visibility });
    if (!result.ok) return NextResponse.json(result.body, { status: result.status });
    const { doc } = result;

    return NextResponse.json({
      success: true,
      id: doc.id,
      status: "queued"
    });

  } catch (err) {
    console.error("❌ File ingestion failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
