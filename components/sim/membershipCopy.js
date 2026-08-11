// Copy + config for the membership funnel — pure data (no JSX), the single,
// unit-testable source for /membership and MembershipCard. Hyphens only, no em/en
// dashes. The pricing ladder: Draft Pass (one-time) -> Football Suite (annual) ->
// Founding (annual). Plan keys match lib/stripe/plans.js.

export const MEMBERSHIP_PRICE_LINE = '$9.99 Draft Pass - $59/yr Suite - $99/yr Founding';

// Per-tier display copy for /membership, keyed by plan key.
export const MEMBERSHIP_TIERS = {
  draft_pass: {
    tagline: "For people prepping like it's a second job.",
    // ORDER IS THE POINT. The Tracker leads because it is the Pass's anchor
    // feature and the only one that leaves the house: every other bullet is
    // something you do alone against the sim, while the Tracker is what you open
    // at a real table with people waiting. It was missing from this card
    // entirely, which meant the card sold a practice tool and never mentioned the
    // thing you actually draft with.
    features: [
      'Draft Tracker - log your real draft live at the table',
      'Unlimited drafts',
      'Superflex and 2QB',
      '14 to 16 teams',
      'Custom rosters and scoring',
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

// ---------------------------------------------------------------------------
// APPLE IAP COPY — App Store Guideline 3.1.1, the OTHER half
// ---------------------------------------------------------------------------
// The first rejection was "membership is purchasable outside the app". Removing
// every purchase path did not clear it, because 3.1.1 also says the app must not
// ACCESS content that is not buyable via IAP - and the app reads membership-gated
// content. So the Pass has to be buyable in-app, which means that under the
// APPLE_IAP_ENABLED flag the shell card does the opposite of the suppressed one:
// it names the price and offers to sell.
//
// This is not a relaxation of 3.1.1. The price shown here is the IAP price, the
// button calls StoreKit through the native bridge, and NOTHING here links to the
// web. There is still no /membership link, no Stripe checkout, and no plan ladder
// - one product, bought through Apple, at Apple's price.
//
// $9.99 must match the App Store Connect price tier for the product. The web
// Draft Pass is the same $9.99 (MEMBERSHIP_PRICE_LINE above), so there is no
// price disparity to explain to a reviewer.
export const APPLE_PASS_PRICE = '$9.99';

// Shell + IAP bodies. These REPLACE the neutral "members sign in and it unlocks"
// line, which is actively wrong once you can buy the thing where you are standing.
export const MEMBERSHIP_CARD_IAP = {
  draft: {
    body: 'That is your three - they reset Monday. The Draft Pass unlocks unlimited drafts, custom rosters, superflex, 14 to 16 teams, full history, and the Exposure Report, through the Super Bowl.',
  },
  custom: {
    body: 'Set your own roster slots, league size, superflex, and scoring. The Draft Pass unlocks the full console; free accounts draft the presets.',
  },
  tracker: {
    body: 'Tracker mode logs a real draft as it happens - every team, every pick, on your phone at the table. The Draft Pass unlocks it.',
  },
};

// The buy control's own strings, including every terminal state of the purchase
// flow. "Unlocking" is deliberately not "Unlocked": StoreKit returning success
// means Apple took the money, but the entitlement lands when RevenueCat's webhook
// reaches our server, which is fast but not synchronous.
export const PASS_BUY = {
  cta: 'Unlock the Draft Pass',
  retry: 'Try again',
  restore: 'Restore purchase',
  note: 'One time. Through the Super Bowl.',
  buying: 'Opening App Store...',
  restoring: 'Checking your purchases...',
  unlocking: 'Confirmed. Unlocking...',
  purchased: 'Purchased.',
  restored: 'Restored. Your Pass is back.',
  cancelled: 'Purchase cancelled.',
  pending: 'Waiting on approval. Your Pass unlocks once it clears.',
  unavailable: 'The App Store is not reachable right now. Try again in a moment.',
  notOwned: 'No previous purchase found on this Apple ID.',
  failed: 'That did not go through. Nothing was charged.',
  // Shown when the store succeeded but the account still reads as free after a
  // refresh. It must NOT say "purchase failed" - the money may well have moved -
  // and it must give an instruction rather than a spinner.
  stalled: 'Your purchase went through but the account has not updated yet. Tap Restore purchase, or reopen the app.',
};

// First-launch welcome sheet (shell + APPLE_IAP_ENABLED only, once per device).
// It has one job: say what you get for free, what the Pass adds, and what it
// costs - then get out of the way. The primary action is START DRAFTING, not the
// purchase, because the free tier is genuinely the front door and a sheet that
// leads with "buy" on first launch reads as a paywall.
//
// The Tracker headlines the Pass line for the same reason it leads the
// /membership card: it is the anchor feature and the only one that leaves the
// house. Hyphens only, no em/en dashes.
// The first-launch sheet. ONE SCREEN, TWO PRODUCTS, and that ordering is the
// whole content decision.
//
// The previous version led with the free tier, then spent more words on the
// Draft Pass than on the thing it was selling, then stated a price - so a new
// account's first screen was mostly about paying. The Tracker, which is the
// harder product to discover and the reason somebody would ever pay, was one
// clause inside the Pass sentence.
//
// Now each product gets its own half and its own instruction, the Pass is a
// single line rather than a paragraph, and there is no purchase control on the
// sheet at all. Buying stays on the MembershipCard and the tracker gate, where
// the user has actually reached for something.
export const WELCOME = {
  kicker: 'Welcome to Draftvyn',
  mockHead: 'Mock draft',
  mock: 'Pick a preset, tap START DRAFT. Full snake mock against AI rooms that reach and slide like real ones - every pick graded on live ADP. Three free drafts a week.',
  trackerHead: 'Draft Tracker',
  tracker: 'Draft night, logged live. Name the teams in your league, set your roster and slot, then enter picks as they happen at the table - the board tracks value while you draft.',
  pass: 'The Draft Pass unlocks the Tracker, unlimited drafts, and custom leagues - $9.99 through the Super Bowl.',
  primary: 'Start a mock draft',
  trackerLink: 'Set up the Tracker',
  dismissLabel: 'Close',
};

export const MEMBERSHIP_CARD_VARIANTS = {
  // Variant A — draft gate (out of the 3 free weekly drafts). Leads with the Pass.
  draft: {
    headline: 'Three free drafts a week.',
    // The Tracker leads the unlock list here for the same reason it leads the
    // /membership card: it is the anchor feature, and this body previously ran
    // through six sim features without naming it.
    body: "That's your three - they reset Monday. The Draft Pass unlocks the Draft Tracker for your real draft at the table, plus unlimited drafts, custom rosters, superflex, 14 to 16 teams, full history, and the Exposure Report - through the Super Bowl.",
    secondary: { label: 'Your drafts', href: '/sim/history' },
  },
  // Variant B — custom config lock. Custom is a sim entitlement, so lead with the
  // Pass too (the Pass is the cheapest thing that unlocks it).
  custom: {
    headline: 'Custom needs the Draft Pass.',
    // The worst offender before this pass: a reader hits the custom-config lock,
    // is told the Pass buys "the full console", and never learns that the same
    // Pass is what they would open at their actual draft. The console clause is
    // kept verbatim - shellPurchase.test.mjs pins it as proof the 3.1.1 shell fix
    // never leaked into web copy - and the Tracker is named alongside it.
    body: 'Set your own roster slots, league size, superflex, and scoring. The Draft Pass unlocks the full console, and the Draft Tracker for the real draft at the table; free accounts draft the presets.',
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
