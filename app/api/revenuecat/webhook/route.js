/**
 * /api/revenuecat/webhook — Apple In-App Purchase events -> memberships.
 *
 * App Store Guideline 3.1.1 requires that membership-gated content the app can
 * READ is also BUYABLE in the app. This endpoint is the server side of that: the
 * app buys the Draft Pass through StoreKit via RevenueCat, RevenueCat posts here,
 * and the Pass lands on the user's membership row with source='apple'.
 *
 * A thin shell on purpose. Authorization, event normalization, and the
 * product/user contracts all live in lib/revenuecat.js, which is pure and
 * unit-tested; route handlers cannot be imported under node --test because of the
 * @/ alias. The DB writes live in lib/membership.js beside the Stripe writers.
 *
 * HANDLED (see lib/revenuecat.js for why each set contains what it does):
 *   NON_RENEWING_PURCHASE / INITIAL_PURCHASE  -> grant the Pass
 *   CANCELLATION / REFUND / EXPIRATION        -> expire the Apple row
 *   anything else                             -> ledger it, 200, ignore
 *
 * STATUS CODES ARE RETRY INSTRUCTIONS. RevenueCat retries 500s with backoff and
 * does not retry 4xx, so:
 *   401 bad/missing secret       - never retry, it will never succeed
 *   400 unusable body            - never retry, the payload is malformed
 *   200 handled OR ignored       - done
 *   500 DB failure               - please retry, this was transient
 * A malformed-but-authenticated event returning 500 would have RevenueCat retry
 * a payload that can never work, forever.
 */

import {
  REVENUECAT_WEBHOOK_SECRET_ENV,
  webhookAuthorized,
  normalizeEvent,
} from '@/lib/revenuecat';
import {
  grantApplePass,
  revokeApplePass,
  recordIgnoredRevenueCatEvent,
} from '@/lib/membership';

export const runtime = 'nodejs';

export async function POST(req) {
  const secret = process.env[REVENUECAT_WEBHOOK_SECRET_ENV];
  if (!webhookAuthorized(req.headers.get('authorization'), secret)) {
    // Deliberately terse: an attacker probing this endpoint learns nothing about
    // whether the secret is unset, wrong, or the wrong shape.
    return new Response('unauthorized', { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response('invalid JSON', { status: 400 });
  }

  const n = normalizeEvent(body);
  if (!n.ok) {
    // Authenticated but unusable - most often an app_user_id that is still
    // RevenueCat's anonymous id, which means the app did not set appUserID to the
    // signed-in users.id before purchasing (see the contract in lib/revenuecat.js).
    // Logged loudly because it is a PAID purchase we cannot attribute.
    console.error('[revenuecat webhook] unusable event:', n.reason);
    return new Response(`unusable event: ${n.reason}`, { status: 400 });
  }

  try {
    switch (n.action) {
      case 'grant': {
        const userId = await grantApplePass(n.event);
        console.log(
          userId
            ? `[revenuecat webhook] pass granted user=${userId} env=${n.event.environment}`
            : `[revenuecat webhook] duplicate event ${n.event.id} - no change`,
        );
        break;
      }
      case 'revoke': {
        const userId = await revokeApplePass(n.event);
        console.log(
          userId
            ? `[revenuecat webhook] pass revoked user=${userId} (${n.event.type})`
            : `[revenuecat webhook] revoke ${n.event.id} matched no apple row - no change`,
        );
        break;
      }
      default:
        await recordIgnoredRevenueCatEvent(n.event);
        break;
    }
  } catch (err) {
    // 500 so RevenueCat retries a transient failure (DB hiccup, etc.).
    console.error('[revenuecat webhook] handler error:', err?.message);
    return new Response('handler error', { status: 500 });
  }

  return Response.json({ received: true });
}
