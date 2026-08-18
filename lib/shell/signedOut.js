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

import { redirect } from 'next/navigation';
import { signInHrefForSignedOut } from './signedOutRule.js';

/**
 * Send a signed-out reader to sign-in, but only inside the container.
 *
 * Call it from a server component BEFORE rendering anything - redirect() throws
 * to unwind, so anything after it is unreachable and anything before it is
 * wasted work.
 *
 * @param {object}  a
 * @param {boolean} a.isShell resolved shell mode
 * @param {*}       a.userId  null when signed out
 * @param {string}  a.dest    the tab to return to after sign-in
 */
export function requireSignInInShell({ isShell, userId, dest }) {
  const href = signInHrefForSignedOut({ isShell, userId, dest });
  if (href) redirect(href);
}
