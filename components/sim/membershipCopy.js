// Copy + config for the membership funnel — pure data (no JSX), the single,
// unit-testable source for /membership and MembershipCard. Hyphens only, no em/en
// dashes. The pricing ladder: Draft Pass (one-time) -> Football Suite (annual) ->
// Founding (annual). Plan keys match lib/stripe/plans.js.

export const MEMBERSHIP_PRICE_LINE = '$9.99 Draft Pass - $59/yr Suite - $99/yr Founding';

// Per-tier display copy for /membership, keyed by plan key.
export const MEMBERSHIP_TIERS = {
  draft_pass: {
    tagline: "For people prepping like it's a second job.",
    features: [
      'Superflex and 2QB',
      '14 to 16 teams',
      'Custom rosters and scoring',
      'Unlimited drafts',
      'Full draft history',
      'The Exposure Report',
    ],
    footnote: 'Through the Super Bowl.',
  },
  suite: {
    tagline: 'Draft tools today. The Suite starts Week 1.',
    features: [
      'Everything in the Pass, unlocked now',
      'The Waiver Read every Tuesday',
      'The Usage Board every Wednesday',
      'Watch Score on every game',
      'Sleeper league sync',
      'The Reads all season',
    ],
    footnote: 'Draft tools now, the Suite from Week 1.',
  },
  founding: {
    tagline: 'This price exists because the publication is being built in front of you.',
    features: [
      'Everything in the Suite',
      'Your rate locked for as long as you stay',
    ],
    footnote: 'Founding rate, locked for as long as you stay.',
  },
};

export const MEMBERSHIP_CARD_VARIANTS = {
  // Variant A — draft gate (out of the 3 free weekly drafts). Leads with the Pass.
  draft: {
    headline: 'Three free drafts a week.',
    body: "That's your three - they reset Monday. The Draft Pass unlocks unlimited drafts, custom rosters, superflex, 14 to 16 teams, full history, and the Exposure Report - through the Super Bowl.",
    secondary: { label: 'Your drafts', href: '/sim/history' },
  },
  // Variant B — custom config lock. Custom is a sim entitlement, so lead with the
  // Pass too (the Pass is the cheapest thing that unlocks it).
  custom: {
    headline: 'Custom needs the Draft Pass.',
    body: 'Set your own roster slots, league size, superflex, and scoring. The Draft Pass unlocks the full console; free accounts draft the presets.',
    secondary: { label: 'Back to presets' }, // no href — uses the onBackToPresets callback
  },
};
