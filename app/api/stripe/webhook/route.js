/**
 * /api/stripe/webhook — Stripe events -> memberships upserts.
 *
 * Signature is verified over the RAW body (req.text()) with STRIPE_WEBHOOK_SECRET
 * via our own HMAC (lib/stripe.js) — no SDK. Node runtime: crypto + Neon.
 *
 * Handled events (all idempotent — upsert by user_id / subscription_id, so a
 * Stripe redelivery is a no-op):
 *   · checkout.session.completed        -> resolve user via client_reference_id,
 *                                          retrieve the subscription, upsert row
 *   · customer.subscription.updated     -> update status/price/period by sub id
 *   · customer.subscription.deleted     -> same path; status=canceled re-locks gate
 * Other event types are acknowledged with 200 and ignored.
 */

import {
  verifyWebhookSignature,
  retrieveSubscription,
  membershipFieldsFromSubscription,
} from '@/lib/stripe';
import {
  upsertMembershipForUser,
  updateMembershipBySubscription,
  upsertPassForUser,
  DRAFT_PASS_EXPIRES_AT,
} from '@/lib/membership';

export const runtime = 'nodejs';

export async function POST(req) {
  const rawBody = await req.text();
  const sig = req.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  const v = verifyWebhookSignature(rawBody, sig, secret);
  if (!v.ok) {
    return new Response(`signature verification failed: ${v.reason}`, { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response('invalid JSON', { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.client_reference_id ? Number(session.client_reference_id) : null;
        const customerId =
          typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
        if (userId && session.mode === 'payment') {
          // One-time Draft Pass: write a pass row with the fixed expiry. Idempotent
          // (PK user_id; a Stripe redelivery restamps the same expiry).
          await upsertPassForUser(userId, {
            stripeCustomerId: customerId,
            expiresAt: DRAFT_PASS_EXPIRES_AT,
          });
        } else {
          const subId =
            typeof session.subscription === 'string'
              ? session.subscription
              : session.subscription?.id ?? null;
          if (userId && subId) {
            const sub = await retrieveSubscription(subId);
            await upsertMembershipForUser(userId, membershipFieldsFromSubscription(sub));
          }
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await updateMembershipBySubscription(membershipFieldsFromSubscription(event.data.object));
        break;
      }
      default:
        break; // acknowledge and ignore
    }
  } catch (err) {
    // 500 so Stripe retries a transient failure (DB hiccup, etc.).
    console.error('[stripe webhook] handler error:', err?.message);
    return new Response('handler error', { status: 500 });
  }

  return Response.json({ received: true });
}
