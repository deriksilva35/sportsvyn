// lib/push/sheetRules.js — the sheet's own rules, PURE.
//
// IT LIVES HERE AND NOT IN AlertBell.js BECAUSE THAT FILE IS JSX, which
// `node --test` cannot import. A rule that can only be checked by rendering is
// a rule with no test, and this project has extracted three of these already
// for the same reason.

import { isShellClient } from '../shell/appTabs.js';

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

/**
 * THE SHEET'S FIRST LINE SAYS WHAT THE ROW WILL DO (ALERTS SHEET relay, R3).
 * One sentence, recomputed on every toggle, so a reader never has to add up
 * five switches to know what their phone is going to do tonight:
 *
 *   master off                       -> "Off"
 *   only the final on                -> "Final only"
 *   one other trigger on             -> "Kickoff only" / "Score changes only"
 *   several on                       -> "Kickoff, score changes and the final"
 *   master on, nothing on            -> "Nothing selected"
 *
 * Order follows the rows. The final is always named last and as "the final",
 * because that is how the sentence reads aloud.
 */
export const SUMMARY_WORDS = Object.freeze([
  ['kickoff', 'kickoff'], ['score', 'score changes'], ['quarter', 'quarter ends'],
  ['close', 'close games'], ['final', 'the final'],
]);

export function summaryLine(prefs) {
  if (!prefs?.master) return 'Off';
  const on = SUMMARY_WORDS.filter(([k]) => prefs[k]).map(([, w]) => w);
  if (!on.length) return 'Nothing selected';
  if (on.length === 1) {
    const w = on[0] === 'the final' ? 'final' : on[0];
    return `${w[0].toUpperCase()}${w.slice(1)} only`;
  }
  const s = `${on.slice(0, -1).join(', ')} and ${on[on.length - 1]}`;
  return s[0].toUpperCase() + s.slice(1);
}
