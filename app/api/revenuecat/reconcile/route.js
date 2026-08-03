/**
 * POST /api/revenuecat/reconcile — "ask RevenueCat what I own, and fix my row".
 *
 * This is the endpoint that unsticks the buy flow. StoreKit can complete without
 * producing anything our webhook will act on - an already-owned non-consumable
 * emits no purchase event, and a TRANSFER carries no app_user_id - so the client
 * needs a way to say "I just transacted, go look". It reconciles ONE user: the
 * one holding the session.
 *
 * IT TAKES NO BODY, AND THAT IS THE POINT. The user id comes from auth(), never
 * from the request, so this cannot be pointed at another account. There is
 * nothing to forge: the only input is the session cookie. It is also why the
 * endpoint can be safely called from the client at all - it grants nothing by
 * itself, it just asks RevenueCat and mirrors the answer.
 *
 * RATE LIMITED because each call is an outbound RevenueCat request. The limiter
 * is per-instance in memory, which is honestly weaker than it sounds on
 * serverless - N instances means up to N times the limit. That is accepted: the
 * endpoint requires a valid session, writes only the caller's own row, and is
 * idempotent, so the limit is here to stop a retry loop hammering RevenueCat, not
 * to stop an attacker. A DB-backed limiter would need a migration and buys little
 * against those properties.
 */

import { auth } from '@/auth';
import { reconcileFromRevenueCat } from '@/lib/revenuecat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Per-user cooldown and hourly cap. A purchase legitimately triggers 1-2 calls
// (purchase, then a retry if the webhook is slow), so the cooldown is short
// enough not to block a real retry and long enough to kill a spin loop.
const COOLDOWN_MS = 5_000;
const HOURLY_CAP = 30;
const HOUR_MS = 3_600_000;

// userId -> { last: epochMs, hits: number[] }
const seen = new Map();

function rateLimit(userId, now = Date.now()) {
  const e = seen.get(userId) ?? { last: 0, hits: [] };
  if (now - e.last < COOLDOWN_MS) {
    return { ok: false, retryAfter: Math.ceil((COOLDOWN_MS - (now - e.last)) / 1000), reason: 'cooldown' };
  }
  e.hits = e.hits.filter((t) => now - t < HOUR_MS);
  if (e.hits.length >= HOURLY_CAP) {
    return { ok: false, retryAfter: 60, reason: 'hourly cap' };
  }
  e.last = now;
  e.hits.push(now);
  seen.set(userId, e);
  // Keep the map from growing without bound on a long-lived instance.
  if (seen.size > 5000) for (const [k, v] of seen) { if (now - v.last > HOUR_MS) seen.delete(k); }
  return { ok: true };
}

export async function POST() {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return new Response('unauthorized', { status: 401 });

  const limited = rateLimit(userId);
  if (!limited.ok) {
    return new Response(JSON.stringify({ ok: false, error: `rate limited (${limited.reason})` }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': String(limited.retryAfter) },
    });
  }

  const r = await reconcileFromRevenueCat(userId);

  if (!r.ok) {
    // A failed RevenueCat lookup wrote nothing (guaranteed in the core). 502
    // rather than 500: the failure is upstream, and the client should show
    // "could not check right now" and offer a retry, not "purchase failed".
    console.error(`[reconcile] user=${userId} lookup failed: ${r.error}`);
    return new Response(JSON.stringify({ ok: false, error: r.error, entitled: null }), {
      status: 502, headers: { 'content-type': 'application/json' },
    });
  }

  console.log(`[reconcile] user=${userId} rc.entitled=${r.rc.entitled} plan=${r.plan.action} wrote=${r.wrote}`);
  return Response.json({
    ok: true,
    // What the CLIENT needs: does the server now consider them entitled? The row
    // is the authority, not RevenueCat's answer - after a revoke plan those differ.
    entitled: r.rc.entitled && r.plan.action !== 'revoke',
    action: r.plan.action,
    changed: r.wrote,
  });
}
