// Copy + config for MembershipCard — pure data (no JSX) so it is the single,
// unit-testable source of the card's content. Hyphens only, no em/en dashes.

export const MEMBERSHIP_PRICE_LINE = '$19/mo - $190/yr - $99/yr founding';

export const MEMBERSHIP_CARD_VARIANTS = {
  // Variant A — draft gate (out of the 3 free drafts).
  draft: {
    headline: "That's your three.",
    body: 'Free accounts get three drafts. Members draft without limit - plus custom rosters, leagues past 12 teams, superflex, and a history that keeps every Read.',
    secondary: { label: 'Your drafts', href: '/sim/history' },
  },
  // Variant B — custom config lock.
  custom: {
    headline: 'Custom is a member thing.',
    body: 'Set your own roster slots, league size, and scoring. Members configure the room; free accounts draft the presets.',
    secondary: { label: 'Back to presets' }, // no href — uses the onBackToPresets callback
  },
};
