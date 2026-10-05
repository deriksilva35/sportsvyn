// lib/widget/session.js - WHO A WIDGET REQUEST IS FOR (sun-22).
//
// A WIDGET CANNOT SEND COOKIES, SO IT SENDS THE SAME TOKEN AS A BEARER. The
// token is the app's existing Auth.js database-session token - the value of
// the authjs.session-token / __Secure-authjs.session-token cookie, which is the
// "sessionToken" column of the sessions table. No new token type: the widget
// is the same session as the app, it expires when that session does, and
// signing out (which deletes the row) signs the widget out with it.
//
//   Authorization: Bearer <session token>
//
// The cookie is accepted too (sessionTokenFrom, lib/auth/ageGate.js), so the
// web view can call the endpoint as itself. The header wins when both exist.
//
// THE TOKEN IS NEVER LOGGED. Nothing in this file or the routes prints it, and
// the rate limiter keys on a hash of it, never the value.
//
// THE THREE ANSWERS, all of them a 200 from the route:
//   signed_out    no token, a malformed one, no session row, an expired row,
//                 or a session whose user is gone
//   age_required  a live session whose account has not passed the age screen
//                 (hasPassed, lib/auth/ageGateDb.js - gateVerdict's rule, the
//                 same one every write door asks)
//   ok            a live session on a passed account

import { createHash } from 'node:crypto';
import { sql as defaultSql } from '../db.js';
import { sessionTokenFrom } from '../auth/ageGate.js';
import { hasPassed } from '../auth/ageGateDb.js';
import { STATE_OK, STATE_SIGNED_OUT, STATE_AGE } from './shape.js';

/** Auth.js tokens are UUIDs; accept any URL-safe token of a sane length, nothing else. */
const TOKEN_RX = /^[A-Za-z0-9._~+/=-]{16,512}$/;

/** The bearer token from a Request, else the session cookie, else null. */
export function tokenFrom(request) {
  const h = request?.headers?.get?.('authorization') ?? '';
  const m = /^Bearer\s+(\S+)\s*$/i.exec(h);
  if (m) return TOKEN_RX.test(m[1]) ? m[1] : null;
  if (h) return null;
  const cookies = request?.cookies;
  const raw = cookies?.get ? sessionTokenFrom((n) => cookies.get(n)?.value ?? null) : null;
  return raw && TOKEN_RX.test(raw) ? raw : null;
}

/** A short, non-reversible handle for a token: what the rate limiter keys on. */
export const tokenKey = (token) => createHash('sha256').update(`sv-widget:${token}`).digest('hex').slice(0, 32);

/**
 * The session's user and verdict. Two reads: the live session row (joined to
 * its user, so a deleted account is signed out), then hasPassed() - the age
 * gate's own read (lib/auth/ageGateDb.js). This file never names the date of
 * birth itself: lib/auth/ageGateDob.test.mjs allows that to three files only.
 * @returns {Promise<{ state: string, userId: number|null }>}
 */
export async function resolveWidgetSession(token, { db = defaultSql, now = new Date() } = {}) {
  if (!token || !TOKEN_RX.test(token)) return { state: STATE_SIGNED_OUT, userId: null };
  let row;
  try {
    [row] = await db`
      SELECT u.id AS user_id
        FROM sessions s JOIN users u ON u.id = s."userId"
       WHERE s."sessionToken" = ${token} AND s.expires > ${new Date(now).toISOString()}::timestamptz
       LIMIT 1`;
  } catch {
    // FAILS TO SIGNED OUT, never to data: a read that cannot confirm the
    // session shows the sign-in state for one refresh.
    return { state: STATE_SIGNED_OUT, userId: null };
  }
  if (!row) return { state: STATE_SIGNED_OUT, userId: null };
  const userId = Number(row.user_id);
  // hasPassed FAILS CLOSED (false on a failed read): no data that refresh.
  if (!(await hasPassed(userId, db))) return { state: STATE_AGE, userId };
  return { state: STATE_OK, userId };
}

// ---------------------------------------------------------------------------
// RATE LIMIT, light, per token, in memory per instance.
//
// Widgets refresh on a budget iOS sets (a few dozen times a day), and the feed
// is memoised 60 s per user, so a well-behaved widget is nowhere near this. It
// exists to stop a retry loop: RATE_MAX requests per RATE_WINDOW_MS per token.
// Per-instance, so N instances allow N times that - the same trade the
// RevenueCat reconcile route makes, for the same reasons (no writes here at all).
// ---------------------------------------------------------------------------

export const RATE_WINDOW_MS = 60_000;
export const RATE_MAX = 20;
const hits = new Map();

/** { ok: true } or { ok: false, retryAfter } (seconds). Keyed on tokenKey(), or 'anon'. */
export function rateLimit(key, now = Date.now()) {
  const k = key ?? 'anon';
  const list = (hits.get(k) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_MAX) {
    hits.set(k, list);
    return { ok: false, retryAfter: Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - list[0])) / 1000)) };
  }
  list.push(now);
  hits.set(k, list);
  if (hits.size > 10_000) for (const [kk, v] of hits) { if (!v.length || now - v[v.length - 1] >= RATE_WINDOW_MS) hits.delete(kk); }
  return { ok: true };
}

/** Tests only. */
export function clearRateLimit() { hits.clear(); }

// ---------------------------------------------------------------------------
// HEADERS
// ---------------------------------------------------------------------------

/**
 * EVERY ANSWER IS PRIVATE. The signed-in feed is one reader's; the sign-in
 * states could be shared, but the URL is the same for both, and a shared cache
 * keyed on the URL alone would hand a stored "sign in" to a signed-in widget
 * (or worse, the other way round). So nothing here is ever edge-cacheable:
 * private on all of them, Vary on the two things that pick the reader.
 */
export const FEED_HEADERS = Object.freeze({
  'Cache-Control': 'private, max-age=60',
  Vary: 'Authorization, Cookie',
});
