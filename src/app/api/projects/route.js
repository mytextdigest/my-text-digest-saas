// app/api/projects/route.js
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma"; // adjust import path if needed
import { getServerSession } from "next-auth"; // adjust if you use custom auth

export async function GET() {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projects = await prisma.project.findMany({
    where: { user: { email: session.user.email } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
    },
  });

  // normalize dates to ISO strings to be explicit
  const normalized = projects.map((p) => ({
    ...p,
    created_at: p.createdAt.toISOString(),
  }));

  return NextResponse.json(normalized);
}

export async function POST(req) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { name, description } = body || {};

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Invalid project name" }, { status: 400 });
  }

  // Find user id
  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const project = await prisma.project.create({
    data: {
      name,
      description: description || null,
      userId: user.id,
    },
  });

  return NextResponse.json({ success: true, id: project.id });
}
