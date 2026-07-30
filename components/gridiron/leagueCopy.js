// Static copy for the league-page instruments (verbatim from the locked mocks).
// Hyphens only, dash-scanned. Middot separators are U+00B7.

// bodyShell: App Store 3.1.1. Inside the native container the teaser may still
// describe the feature (that is editorial) but must not name a purchasable plan.
// Held as explicit copy rather than stripped from `body` with a regex, so the
// shell string is something a person wrote and a test can assert.
export const SUITE_TEASERS = [
  {
    lock: 'Football Suite',
    headline: "Who's actually on the field.",
    body: 'Snap counts, role changes, and the read on what changed - every Wednesday from Week 1. Part of the Football Suite.',
    bodyShell: 'Snap counts, role changes, and the read on what changed - every Wednesday from Week 1.',
  },
  {
    lock: 'Football Suite',
    headline: 'Quiet · Warming · Steam',
    body: "Who's actually worth a claim, every Tuesday - with the why. Part of the Football Suite.",
    bodyShell: "Who's actually worth a claim, every Tuesday - with the why.",
  },
];

export const UPSET_NOTE = 'What the market fears this week - live dog probabilities, de-vigged. Not a play.';
export const MARKET_FINE = 'De-vigged consensus, tracked daily. No picks, no books.';

export const READ_BLANK = {
  headline: "The week's read lands here.",
  nfl: 'One piece, every week of the season - what actually mattered, in the voice. Not a recap.',
  cfb: 'One piece, every Saturday night of the season - what actually mattered, in the voice. Not a recap.',
};
