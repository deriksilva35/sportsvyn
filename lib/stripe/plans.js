/**
 * lib/stripe/plans.js — Stripe plan config (the pricing ladder).
 *
 * RUNTIME SOURCE OF TRUTH IS `lookupKey`, not `priceId`. The checkout action
 * resolves the price from its lookup_key at request time (lib/stripe.js
 * resolvePriceId), so the same code works in test and live: a test key resolves
 * the test price, a live key resolves the live price, with no per-environment
 * price config. `mode` selects the Checkout mode (one-time 'payment' vs
 * 'subscription'). `priceId` literals are TEST ids for reference only — nothing
 * at runtime reads them. Go-live needs the live prices with these IDENTICAL
 * lookup_keys (scripts/stripe-setup.mjs --live). Price IDs are not secrets.
 *
 * The 2026 restructure: Draft Pass (one-time) + Football Suite (annual) +
 * Founding (annual). Monthly + the old $190 annual are retired (their prices are
 * archived, never deleted). Display copy lives in components/sim/membershipCopy.js.
 */

export const PLANS = [
  {
    key: 'draft_pass',
    priceId: null,
    lookupKey: 'sportsvyn_draft_pass_2026',
    label: 'Draft Pass',
    price: '$9.99',
    cadence: 'one-time',
    mode: 'payment',
    tier: 'pass',
  },
  {
    key: 'suite',
    priceId: null,
    lookupKey: 'sportsvyn_suite',
    label: 'Football Suite',
    price: '$59',
    cadence: '/yr',
    mode: 'subscription',
    tier: 'suite',
    featured: true,
  },
  {
    key: 'founding',
    priceId: 'price_1Tw8ZFAQ1w0KsNJtQd7pHdnG',
    lookupKey: 'sportsvyn_founding',
    label: 'Founding',
    price: '$99',
    cadence: '/yr',
    mode: 'subscription',
    tier: 'founding',
  },
];

export const PLAN_BY_KEY = Object.fromEntries(PLANS.map((p) => [p.key, p]));

// Server-side allow-list keyed on lookup_key — mode-agnostic (the resolved price
// id differs test vs live, so we validate the plan/lookup key, not an id string).
export const KNOWN_LOOKUP_KEYS = new Set(PLANS.map((p) => p.lookupKey));
