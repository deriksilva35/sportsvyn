'use server';

/**
 * Server Actions for membership checkout + billing portal.
 *
 * Session is resolved INSIDE each action (user id/email never trusted from the
 * client). The plan key maps to a server-side price id (lib/stripe/plans.js), so
 * the client can't inject an arbitrary price. Both actions end in redirect() to a
 * Stripe-hosted URL — redirect() must stay outside try/catch (it throws to signal
 * the framework).
 */

import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createCheckoutSession, createBillingPortalSession } from '@/lib/stripe';
import { getMembership } from '@/lib/membership';
import { PLAN_BY_KEY } from '@/lib/stripe/plans';

async function originBaseUrl() {
  const h = await headers();
  const host = h.get('host');
  const proto = h.get('x-forwarded-proto') ?? (host?.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

// Start Stripe Checkout for a plan key ('monthly' | 'annual' | 'founding').
export async function startCheckout(planKey) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const email = session?.user?.email ?? null;
  if (!userId) redirect('/signin?callbackUrl=/membership');

  const plan = PLAN_BY_KEY[planKey];
  if (!plan) redirect('/membership'); // unknown plan — bounce back

  const baseUrl = await originBaseUrl();
  const checkout = await createCheckoutSession({ priceId: plan.priceId, userId, email, baseUrl });
  redirect(checkout.url);
}

// Open the Stripe Billing Portal (manage/cancel/update card) for the member.
export async function openBillingPortal() {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (!userId) redirect('/signin?callbackUrl=/sim/account');

  const m = await getMembership(userId);
  if (!m?.stripe_customer_id) redirect('/membership'); // no customer yet — send to pricing

  const baseUrl = await originBaseUrl();
  const portal = await createBillingPortalSession({
    customerId: m.stripe_customer_id,
    returnUrl: `${baseUrl}/sim/account`,
  });
  redirect(portal.url);
}
