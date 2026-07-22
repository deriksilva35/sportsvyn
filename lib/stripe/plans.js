/**
 * lib/stripe/plans.js — Stripe plan config (env-agnostic; TEST-mode price IDs).
 *
 * Price IDs are NOT secrets, so they live in committed config rather than env
 * vars — the same file serves every environment (all currently point at the one
 * Stripe test account). lookup_keys are stable across test/live, so go-live is:
 * re-run scripts/stripe-setup.mjs against the live key and swap these three
 * price IDs (created from the identical lookup_keys). See scripts/stripe-setup.mjs.
 */

export const PLANS = [
  {
    key: 'monthly',
    priceId: 'price_1Tw8ZEAQ1w0KsNJtom97cYVy',
    lookupKey: 'sportsvyn_monthly',
    label: 'Monthly',
    price: '$19',
    cadence: '/mo',
    blurb: 'Billed monthly. Cancel anytime.',
  },
  {
    key: 'annual',
    priceId: 'price_1Tw8ZFAQ1w0KsNJtE4yuXuix',
    lookupKey: 'sportsvyn_annual',
    label: 'Annual',
    price: '$190',
    cadence: '/yr',
    blurb: 'Two months free versus monthly.',
  },
  {
    key: 'founding',
    priceId: 'price_1Tw8ZFAQ1w0KsNJtQd7pHdnG',
    lookupKey: 'sportsvyn_founding',
    label: 'Founding Member',
    price: '$99',
    cadence: '/yr',
    blurb: 'Founding price, locked in for as long as you stay.',
  },
];

export const PLAN_BY_KEY = Object.fromEntries(PLANS.map((p) => [p.key, p]));

// Server-side allow-list: the checkout action only accepts a priceId we minted.
export const KNOWN_PRICE_IDS = new Set(PLANS.map((p) => p.priceId));
