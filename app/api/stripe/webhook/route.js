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
 *
 * TEST-MODE EVENTS ARE IGNORED unless STRIPE_ALLOW_TEST_EVENTS=true. One
 * endpoint URL serves both Stripe modes, so without this a test checkout writes
 * a real membership row in production. See the guard below.
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

  // TEST EVENTS DO NOT WRITE TO AN ENVIRONMENT THAT DID NOT ASK FOR THEM.
  //
  // There is ONE registered endpoint URL and both Stripe modes point at it:
  // https://sportsvyn.com/api/stripe/webhook is enabled in test AND live. So a
  // test-mode checkout - a developer walking the flow with a 4242 card - fires
  // a signed, valid webhook straight at production, and upsertMembershipForUser
  // happily writes a real membership row for whatever client_reference_id it
  // carries. The signature check cannot catch that: the event IS authentic. It
  // is simply from the wrong world.
  //
  // event.livemode is Stripe's own answer to which world, and it is on every
  // event. An environment opts IN to test traffic with STRIPE_ALLOW_TEST_EVENTS;
  // production never sets it, so the absence of a variable is the guard. That
  // direction matters - a guard that has to be switched ON in production is one
  // deploy away from being off.
  //
  // ACKNOWLEDGED, NOT REJECTED. A 200 tells Stripe the event was delivered so it
  // stops retrying; a 4xx would leave test events retrying against production
  // for days. And it is LOGGED rather than dropped in silence, because "nothing
  // happened" and "we deliberately ignored it" look identical in a database and
  // only one of them is fine.
  const allowTest = process.env.STRIPE_ALLOW_TEST_EVENTS === 'true';
  if (!event.livemode && !allowTest) {
    console.log('[stripe-webhook] ignored test-mode event', { id: event.id, type: event.type });
    return Response.json({ ignored: 'test event', id: event.id, type: event.type });
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
