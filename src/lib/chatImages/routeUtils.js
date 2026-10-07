// src/lib/chatImages/routeUtils.js
// Session + ownership plumbing for the chat image routes. Server-only.
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { messageDelegate } from "./server.js";

export const unauthorized = () => NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
export const notFound = (error = "Not found") => NextResponse.json({ success: false, error }, { status: 404 });
export const badRequest = (error) => NextResponse.json({ success: false, error }, { status: 400 });
export const fail = (err, status = 500) =>
  NextResponse.json({ success: false, error: err?.message || String(err) }, { status });

// → { id, email } of the signed-in user, or null.
export async function sessionUser() {
  const session = await getServerSession();
  const email = session?.user?.email;
  if (!email) return null;
  return prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
}

export function ownedAttachment(id, userId) {
  return prisma.chatAttachment.findFirst({ where: { id, userId } });
}

// A chat message whose conversation belongs to the user.
export function ownedMessage(kind, messageId, userId) {
  const delegate = messageDelegate(kind);
  if (!delegate || !messageId) return null;
  return delegate.findFirst({ where: { id: messageId, conversation: { userId } } });
}
