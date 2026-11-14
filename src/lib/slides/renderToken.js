// src/lib/slides/renderToken.js
// A deck-scoped token that lets the worker's headless Chromium load
// /present/frame (and the deck it draws) without a user session — the
// cloud stand-in for desktop's offscreen BrowserWindow, which simply shared
// the app's session (spec D7). Signed with NEXTAUTH_SECRET (or
// RENDER_TOKEN_SECRET when set), expires after 10 minutes, and is accepted
// only by GET /api/slide-decks/[deckId] and the frame page.
//
// Format: base64url(JSON {d: deckId, e: expiresAtMs}) + "." + base64url(HMAC-SHA256).

import crypto from "node:crypto";

export const RENDER_TOKEN_TTL_MS = 10 * 60 * 1000;

function secret() {
  const s = process.env.RENDER_TOKEN_SECRET || process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET (or RENDER_TOKEN_SECRET) is not set");
  return s;
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function signRenderToken(deckId, ttlMs = RENDER_TOKEN_TTL_MS) {
  const payload = Buffer.from(JSON.stringify({ d: String(deckId), e: Date.now() + ttlMs })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

// True only for an unexpired token minted for exactly this deck.
export function verifyRenderToken(token, deckId) {
  if (typeof token !== "string" || !token.includes(".")) return false;
  const [payload, mac] = token.split(".");
  let expected;
  try { expected = sign(payload); } catch (e) { return false; }
  const a = Buffer.from(mac || "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const { d, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return d === String(deckId) && Number.isFinite(e) && e > Date.now();
  } catch (e) {
    return false;
  }
}
