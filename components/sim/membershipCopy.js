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

// ---------------------------------------------------------------------------
// SHELL (native app) COPY — App Store Guideline 3.1.1
// ---------------------------------------------------------------------------
// Inside the native container the app must contain NO purchase path and NO
// solicitation to buy: no price, no plan names, no link to the pricing page, no
// "see plans", no urgency. What is allowed is naming the feature and stating,
// neutrally, that it belongs to an account level the user does not currently
// have. That is a fact about their account, not an offer.
//
// These bodies are deliberately account-shaped ("Members sign in and it
// unlocks") rather than commerce-shaped. The user still gets a truthful
// explanation of why a control is inert, which is the honest minimum; they just
// are not sold to. Web copy above is UNCHANGED.
export const MEMBERSHIP_CARD_SHELL = {
  draft: {
    headline: 'Three free drafts a week.',
    body: 'That is your three - they reset Monday. Unlimited drafts are part of the Sportsvyn membership. Members sign in and it unlocks.',
  },
  custom: {
    headline: 'Custom is a membership feature.',
    body: 'Your own roster slots, league size, superflex, and scoring are part of the Sportsvyn membership. Members sign in and it unlocks. Free accounts draft the presets.',
  },
  tracker: {
    headline: 'Tracker mode is a membership feature.',
    body: 'Tracker mode logs a real draft as it happens - every team, every pick, on your phone at the table. It is part of the Sportsvyn membership. Members sign in and it unlocks.',
  },
};

// The neutral locked line reused by non-card surfaces (the Exposure Report
// preview, the league rail teasers) in shell mode.
export const SHELL_LOCKED_NOTE = 'Part of the Sportsvyn membership. Members sign in and it unlocks.';

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
  // Variant C — tracker lock. Same `sim` entitlement as custom, so the Pass is
  // again the cheapest unlock. The pitch is deliberately about the ROOM, not the
  // feature list: this is the one mode that leaves the house and goes to a real
  // draft table, and that is the whole reason to buy it. States what it does and
  // stops - no urgency, no "don't get caught without it".
  tracker: {
    headline: 'Bring it to your draft.',
    body: 'Tracker mode logs a real draft as it happens - every team, every pick, on your phone at the table. Your roster and the open slots stay in front of you, and the value on each pick is read against live ADP. The Draft Pass unlocks it.',
    secondary: { label: 'Back to the sim' },
  },
};
