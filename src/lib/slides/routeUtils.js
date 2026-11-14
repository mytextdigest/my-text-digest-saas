// src/lib/slides/routeUtils.js
// Shared plumbing for the talking-points / narration / video / job routes:
// session auth (scoped through document.user.email, like every slide-deck
// route), deck loading, and desktop-shaped `{success, error}` responses.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { loadEditableOutline } from "@/lib/slides/deckServer";

export function ok(body = {}) {
  return NextResponse.json({ success: true, ...body });
}

export function fail(error, status = 400, extra = {}) {
  return NextResponse.json({ success: false, error, ...extra }, { status });
}

// Logs and turns an unexpected error into a 500 with a user-facing message.
export function serverError(label, err, message) {
  console.error(`❌ ${label}:`, err);
  return fail(message || "Something went wrong.", 500);
}

export async function sessionEmail() {
  const session = await getServerSession();
  return session?.user?.email || null;
}

// → {email, deckId, deck, outline} or {response} to return as is.
// `editable: false` only needs the deck to exist and be the user's.
export async function deckFromRequest(params, { editable = true } = {}) {
  const email = await sessionEmail();
  if (!email) return { response: fail("Unauthorized", 401) };
  const { deckId } = await params;
  if (!editable) {
    const deck = await prisma.slideDeck.findFirst({ where: { id: deckId, document: { user: { email } } } });
    if (!deck) return { response: fail("Deck not found.", 404) };
    return { email, deckId, deck };
  }
  const { deck, outline, error, status } = await loadEditableOutline(prisma, deckId, { userEmail: email });
  if (error) return { response: fail(error, status || 400) };
  return { email, deckId, deck, outline };
}

export function openAiKeyMessage(err) {
  return /OPENAI_KEY_MISSING/.test(String(err?.message || err)) ? "Add your OpenAI API key in Settings first." : null;
}
