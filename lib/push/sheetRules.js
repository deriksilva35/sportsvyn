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
 *   master off, a league floor on    -> "Back to red zone"
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

export function summaryLine(prefs, { leagueFloor = false } = {}) {
  // "OFF" IS NOT WHAT HAPPENS WHEN A FLOOR IS UNDER IT. With red zone on,
  // turning a game off returns it to the league row rather than silencing it,
  // so the sheet must not promise silence it will not deliver - the same rule
  // that retired the "Silenced by" line. The reader is told where the game
  // goes, not merely that this row stopped applying.
  if (!prefs?.master) return leagueFloor ? 'Back to red zone' : 'Off';
  const on = SUMMARY_WORDS.filter(([k]) => prefs[k]).map(([, w]) => w);
  if (!on.length) return 'Nothing selected';
  if (on.length === 1) {
    const w = on[0] === 'the final' ? 'final' : on[0];
    return `${w[0].toUpperCase()}${w.slice(1)} only`;
  }
  const s = `${on.slice(0, -1).join(', ')} and ${on[on.length - 1]}`;
  return s[0].toUpperCase() + s.slice(1);
}

/**
 * WHAT THE SHEET'S FIVE ROWS SAY, for a sport that is not football.
 *
 * THE COPY AND THE RULE MUST BE ONE FACT. The close row said "Q4, one score
 * apart, under five minutes" on every sheet in the app, including baseball's,
 * where there is no Q4 and no clock - a sentence describing a rule that could
 * not fire. isCloseGame() decides when it fires; this decides what the reader
 * is promised, and they are written next to each other on purpose.
 *
 * Only the rows whose SENTENCE differs are listed. Everything absent from a
 * sport's entry keeps the football wording, because "Every score, both teams"
 * means the same thing in both games.
 */
export const SPORT_ROW_COPY = Object.freeze({
  baseball: Object.freeze({
    quarter: { title: 'Inning ends', trigger: 'End of each inning' },
    close: { trigger: 'Within one run, 8th inning or later' },
    score: { trigger: 'Every run, both teams · "PHI 3, MIL 3 · Marsh homers · Bot 8th"' },
  }),
});

/** PURE. The sheet's rows, with this sport's wording applied. */
export function rowsForSport(rows = [], sport = null) {
  const over = SPORT_ROW_COPY[String(sport ?? '').trim().toLowerCase()] ?? null;
  if (!over) return rows;
  return rows.map((r) => (over[r.key] ? { ...r, ...over[r.key] } : r));
}
