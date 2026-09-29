// lib/today/gamesBandCards.js - what the front page's four game cards SAY (tue-3).
// PURE: GamesBand draws, this decides, and every state has a test.
//
// TWO DEFECTS THIS REPLACED, both "a date that was never true":
//   - Pick'em's lock line read lockLabel(nextKickoff). With every game on the
//     board kicked, nextKickoff is null and new Date(null) is the epoch - "locks
//     Wed Dec 31". It now says "all games kicked", as the lobby row does.
//   - The Weekly and Draft cards read weekly?.cta / weekly?.open, fields the home
//     views (lib/weekly/homeModule.js, lib/draft/view.js) never had. Every card,
//     every week, fell through to a typed 'Opens Sep 8', ghosted and unlinked -
//     while Week 3 was open. They now read the views' own `state`.
import { lockLabel } from '../pickem/read.js';

/**
 * "locks <next kickoff>" while one is ahead; "all games kicked" once none is -
 * the lobby row's own words for the same state (lib/games/read.js). NOT the
 * board's first kickoff: pickemCardData dropped firstKickoff on purpose (a fact
 * about the board's past, never about what a reader can still do -
 * lib/pickem/nextLockLine.test.mjs guards it), and this does not bring it back.
 */
export function pickemLockLine({ nextKickoff = null } = {}) {
  const l = lockLabel(nextKickoff);
  return l ? `locks ${l}` : 'all games kicked';
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Sep 29" in ET, the day a board opens. */
export function openDay(iso) {
  if (iso == null || !Number.isFinite(new Date(iso).getTime())) return null;
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric' })
    .formatToParts(new Date(iso)).reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${MON[Number(p.month) - 1]} ${Number(p.day)}`;
}

const DEFAULT_SUB = { weekly: 'Six NFL players, best five count', draft: 'Eight picks feed a best six' };

/**
 * ONE SEASON-GAME CARD from its home view.
 * @param kind 'weekly' | 'draft'
 * @param view the home view, or null when no board has opened
 * @param nextOpensAt the next board's opens_at, for the null case
 * @returns {{ sub, cta, open, href }}
 */
export function seasonGameCard(kind, view, { nextOpensAt = null } = {}) {
  const href = kind === 'weekly' ? '/weekly' : '/draft';
  const wk = view?.week != null ? `Week ${view.week}` : null;
  const card = (sub, cta, open = true) => ({ sub, cta, open, href: open ? (view?.href ?? href) : null });
  if (!view) {
    const d = openDay(nextOpensAt);
    return { sub: DEFAULT_SUB[kind], cta: d ? `Opens ${d}` : 'Opens soon', open: false, href: null };
  }
  const head = (tail) => [wk, tail].filter(Boolean).join(' · ') || DEFAULT_SUB[kind];
  switch (view.state) {
    case 'settled':
      return card(head(view.played && view.score != null ? `${view.score} pts` : 'settled'), 'See results');
    case 'locked':
      if (kind === 'weekly') return card(head('locked'), view.entered ? `Live · ${view.filled}/6` : 'Locked');
      return card(head('locked'), view.entered ? 'Your team is set' : 'Locked');
    case 'building':
      return card(head(`${view.remaining} to fill`), `Finish lineup · ${view.filled}/6`);
    case 'drafting':
      return card(head('drafting'), 'Your pick is up');
    case 'waiting':
      return card(head(`${view.picks} picked`), 'Back to the draft');
    case 'rules':
      return card(head('open'), 'Start the draft');
    case 'play':
    default:
      return card(head('open'), kind === 'weekly' ? 'Set your six' : 'Start the draft');
  }
}
