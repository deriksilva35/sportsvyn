/**
 * lib/stripe/plans.js — Stripe plan config.
 *
 * RUNTIME SOURCE OF TRUTH IS `lookupKey`, not `priceId`. The checkout action
 * resolves the price from its lookup_key at request time (lib/stripe.js
 * resolvePriceId), so the same code works in test and live: a test key resolves
 * the test price, a live key resolves the live price, with no per-environment
 * price config. The `priceId` literals below are the current TEST ids kept for
 * documentation/reference only — nothing at runtime reads them. Go-live just
 * needs the live prices created with these IDENTICAL lookup_keys
 * (scripts/stripe-setup.mjs --live). Price IDs are not secrets.
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

// Server-side allow-list keyed on lookup_key — mode-agnostic (the resolved price
// id differs test vs live, so we validate the plan/lookup key, not an id string).
// The action already gates on PLAN_BY_KEY[planKey]; this is the resolution key set.
export const KNOWN_LOOKUP_KEYS = new Set(PLANS.map((p) => p.lookupKey));
