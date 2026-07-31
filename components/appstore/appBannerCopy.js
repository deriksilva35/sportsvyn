// Copy for the get-the-app banner - pure data, dash-scanned. Hyphens only, no
// em/en dashes (house rule, same as simPromoCopy and membershipCopy).
//
// The app is DRAFTVYN, not "Sportsvyn": the shipped bundle is
// com.sportsvyn.draftvyn (lib/aasa.js) and the App Store listing is the sim, not
// the publication. Naming it Sportsvyn here would send a reader to the store
// expecting the whole site and hand them a draft app.
//
// "Free" is a factual statement about the download, and it is the ONLY money-
// adjacent word here. This banner is web-only by construction, so it is not
// bound by the 3.1.1 no-solicitation rule that governs the shell copy - but it
// still names no plan and no price, because the app itself is the free thing.

export const APP_BANNER = {
  headline: 'Draftvyn - the sim in your pocket.',
  line: 'Free on the App Store.',
  // Apple's badge lockup is a two-line label beside the logomark. Kept as data
  // so the wording is asserted, not buried in JSX.
  badgePre: 'Download on the',
  badgeStore: 'App Store',
  dismissLabel: 'Dismiss',
};
