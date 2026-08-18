// lib/shell/signedOut.js - what a signed-out reader meets, per platform.
//
// ============================================================================
// IN THE CONTAINER, A PITCH IS A SECOND SALE OF SOMETHING ALREADY BOUGHT
// ============================================================================
// The App Store listing did the selling. Somebody who has found the app,
// installed it and opened it does not need "Draft against the market, not a
// spreadsheet" and a button to a form - they need the form. Every tap on a
// pitch page in the shell is a tap the listing already earned and we are
// spending again.
//
// It was also FOUR DIFFERENT PITCHES. /sim, /daily, /weekly and /draft each
// rendered their own signed-out hero, so the app had four front doors
// depending on which tab you happened to open, and /games had none at all -
// it rendered the lobby to a stranger. One rule replaces all five.
//
// THE WEB IS UNCHANGED, DELIBERATELY. There the hero is correct: a visitor
// arrives from a link or a search with no idea what this is, and the pitch is
// the only thing that can tell them. Same signed-out state, opposite correct
// answer, because the reader arrived by a different road.
//
// THE DESTINATION RIDES ALONG. shellSigninHref encodes the tab inside
// callbackUrl (with the shell marker nested, which is the bug it exists to
// fix), so sign-in returns the reader to the tab they launched into rather than
// to a generic home. Launch -> sign-in -> handle -> playing, with no step that
// asks them to want it.

import { shellSigninHref } from './signinHref.js';

/**
 * WHERE a signed-out reader belongs, as a value.
 *
 * PURE AND SEPARATE FROM THE REDIRECT, because `next/navigation` is resolvable
 * only through the Next build - importing it under `node --test` fails outright,
 * which would leave the rule itself untested and only its wiring assertable as
 * source. The decision is the part with the failure modes, so the decision is
 * the part that gets a test.
 *
 * @returns {string|null} the sign-in href, or null to render the page as-is
 */
export function signInHrefForSignedOut({ isShell, userId, dest }) {
  if (!isShell) return null;        // web keeps its hero
  if (userId != null) return null;  // signed in: carry on
  return shellSigninHref(dest, true);
}
