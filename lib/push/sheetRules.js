// lib/push/sheetRules.js — the sheet's own rules, PURE.
//
// IT LIVES HERE AND NOT IN AlertBell.js BECAUSE THAT FILE IS JSX, which
// `node --test` cannot import. A rule that can only be checked by rendering is
// a rule with no test, and this project has extracted three of these already
// for the same reason.

import { isShellClient } from '../shell/appTabs.js';

/**
 * WHICH ROWS FINAL ONLY SILENCES.
 *
 * Named once so the UI's dimming and the dispatcher's gate cannot disagree:
 * a row that dims but still fires, or fires but looks dead, is worse than
 * either behaviour on its own.
 */
export const SILENCED_BY_FINAL_ONLY = Object.freeze(['kickoff', 'score', 'quarter', 'close']);

/**
 * WHICH TRANSPORT THIS ENVIRONMENT HAS. 'native' or 'web'.
 *
 * The sheet renders in two places that do not share a transport: inside
 * Draftvyn there is a Capacitor plugin and an APNs token that already works,
 * and in a browser there is a service worker and a VAPID subscription. The path
 * is CHOSEN, not attempted in turn - a try-web-then-fall-back would show the
 * browser's refusal ("add Sportsvyn to your Home Screen first") inside an app
 * the reader has already installed, every single time.
 *
 * The cookie is read through isShellClient, the same predicate the tab bar and
 * the chrome use, because a second answer to "am I in the container" is how the
 * two drift. window.Capacitor is the belt: a webview that somehow arrived
 * without the cookie is still a webview, and offering it web push offers it
 * nothing.
 */
export function pushPathFor({ cookie = '', capacitor = false } = {}) {
  return isShellClient({ cookie }) || capacitor ? 'native' : 'web';
}

/** Is this row currently doing nothing because Final only is on? */
export function silencedByFinalOnly(prefs, key) {
  return Boolean(prefs?.final_only) && SILENCED_BY_FINAL_ONLY.includes(key);
}

/**
 * The prefs after a row is toggled.
 *
 * TURNING A SILENCED ROW ON TURNS FINAL ONLY OFF. Otherwise the reader taps
 * Score changes, watches the toggle move, and gets nothing: the row says on
 * and the game says silent. Master and Final only can never both read as
 * "everything on".
 */
export function applyRowToggle(prefs, key, value) {
  const next = { ...prefs, [key]: value };
  if (value && SILENCED_BY_FINAL_ONLY.includes(key)) next.final_only = false;
  return next;
}
