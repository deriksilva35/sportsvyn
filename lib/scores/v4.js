// lib/scores/v4.js - the arcade Scoreboard (scores-v4), PURE.
//
// ScoreboardV4 draws; this decides. Everything a chip, a filter or a card foot
// has to get right lives here, where a fixture can pin it:
//   · v4Href      THE ONE URL BUILDER. Every chip, pill and day on the page is
//                 a link made here, so the grammar cannot drift chip by chip.
//   · isClose     live only; football within 8 in Q4 or OT, MLB within 2 from
//                 the 7th (mon-16 ruling d).
//   · isTonight   today's games, in the viewer's zone, not yet started.
//   · applyView   the Live / Close / Tonight / conference narrowing, applied to
//                 the groups scoresV2 already built.
//   · chipCounts  the number on each chip; a chip whose count is 0 is hidden.
//   · oddsFoot    "DEN -3.5 · O/U 44.5 · opened -2.5".
//   · winProbRead "PHI 64% win" - NFL only (ruling f).
//
// The Yours band is NOT decided here. It is withYoursBand, exactly as the dark
// page has it (lib/scores/yours.js); this file only knows to leave it alone.

import { viewerDay, gamesSub, ET } from '../gridiron/scoresV2Shape.js';
import { sportOf, BASEBALL, FOOTBALL } from '../live/vocabulary.js';

export const SPORTS = Object.freeze([['all', 'All'], ['nfl', 'NFL'], ['cfb', 'CFB'], ['mlb', 'MLB']]);
/** The narrowing views. Mutually exclusive: Close is a subset of Live and
 *  Tonight is disjoint from it, so combining any two is empty or redundant. */
export const VIEWS = Object.freeze(['live', 'close', 'tonight']);

const SPORT_KEYS = new Set(SPORTS.map(([k]) => k));
const one = (v) => (Array.isArray(v) ? v[0] : v);

/** The page's query, normalised. Unknown values fall back to their default. */
export function parseV4(sp = {}) {
  const sport = SPORT_KEYS.has(one(sp.sport)) ? one(sp.sport) : 'all';
  const view = VIEWS.includes(one(sp.view)) ? one(sp.view) : null;
  const conf = sport === 'cfb' && one(sp.conf) ? String(one(sp.conf)) : null;
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(one(sp.date) ?? '') ? one(sp.date) : null,
    sport, view, conf,
    mine: one(sp.mine) === '1',
    top25: one(sp.top25) === '1',
  };
}

/**
 * THE URL, ONE BUILDER. Fixed key order (date, sport, view, conf, mine,
 * top25) so the same state is always the same string.
 *   · defaults are dropped: sport=all, no view, no conf
 *   · top25 rides only where it can mean something - All or CFB (as on V2)
 *   · conf rides only on CFB; a league chip that leaves CFB drops it
 */
export function v4Href({ date = null, sport = 'all', view = null, conf = null, mine = false, top25 = false } = {}) {
  const p = new URLSearchParams();
  if (date) p.set('date', date);
  if (sport && sport !== 'all') p.set('sport', sport);
  if (view && VIEWS.includes(view)) p.set('view', view);
  if (conf && sport === 'cfb') p.set('conf', conf);
  if (mine) p.set('mine', '1');
  if (top25 && (sport === 'all' || sport === 'cfb')) p.set('top25', '1');
  const q = p.toString();
  return q ? `/scores?${q}` : '/scores';
}

/**
 * The href for each control, from the state in force. A chip toggles its own
 * key and carries the rest. Picking a DAY drops the view: Live and Close have
 * nothing to show off today (live games collapse to one line there), and
 * Tonight means today by definition.
 */
export function hrefs(state) {
  const s = { date: state.date, sport: state.sport, view: state.view, conf: state.conf, mine: state.mine, top25: state.top25 };
  return {
    sport: (k) => v4Href({ ...s, sport: k, conf: k === 'cfb' ? s.conf : null }),
    view: (k) => v4Href({ ...s, view: s.view === k ? null : k }),
    mine: () => v4Href({ ...s, mine: !s.mine }),
    top25: () => v4Href({ ...s, top25: !s.top25 }),
    conf: (c) => v4Href({ ...s, conf: s.conf === c ? null : c }),
    day: (date) => v4Href({ ...s, date, view: null }),
  };
}

const diff = (g) => Math.abs(Number(g.homeScore ?? 0) - Number(g.awayScore ?? 0));

/**
 * CLOSE, the whole ruling. Live only.
 *   football  |diff| <= 8 in the 4th quarter or overtime (period >= 4)
 *   MLB       |diff| <= 2 from the 7th inning on (period is the inning)
 * Anything else - soccer, a game with no period yet - is never close.
 */
export const CLOSE = Object.freeze({ football: { margin: 8, from: 4 }, baseball: { margin: 2, from: 7 } });
export function isClose(g) {
  if (g?.status !== 'live') return false;
  if (g.homeScore == null || g.awayScore == null) return false;
  const period = Number(g.liveState?.period);
  if (!Number.isFinite(period)) return false;
  const sport = sportOf(g.leagueSlug);
  const rule = sport === FOOTBALL ? CLOSE.football : sport === BASEBALL ? CLOSE.baseball : null;
  if (!rule) return false;
  return period >= rule.from && diff(g) <= rule.margin;
}

/** TONIGHT: kicks off today in the viewer's zone and has not started. */
export function isTonight(g, { today, tz = ET, now = new Date() } = {}) {
  if (!g || g.status !== 'scheduled' || !g.kickoffAt) return false;
  if (viewerDay(g.kickoffAt, tz) !== today) return false;
  return new Date(g.kickoffAt).getTime() > new Date(now).getTime();
}

/** A CFB game belongs to a conference when either side plays in it. */
export const inConf = (g, conf) => g?.leagueSlug === 'cfb' && (g.home?.conference === conf || g.away?.conference === conf);

/** The conference picker's options: every conference on the picked day's CFB rows, A-Z. */
export function confOptions(groups) {
  const set = new Set();
  for (const grp of groups ?? []) for (const g of grp.games) {
    if (g.leagueSlug !== 'cfb') continue;
    if (g.home?.conference) set.add(g.home.conference);
    if (g.away?.conference) set.add(g.away.conference);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

const viewTest = (view, ctx) => (view === 'live' ? (g) => g.status === 'live'
  : view === 'close' ? isClose
    : view === 'tonight' ? (g) => isTonight(g, ctx)
      : () => true);

/**
 * The number on each chip, over every card the page would draw (the Yours
 * band included - it is on screen). Zero hides the chip.
 */
export function chipCounts(groups, ctx = {}) {
  const all = (groups ?? []).flatMap((grp) => grp.games);
  return {
    live: all.filter(viewTest('live', ctx)).length,
    close: all.filter(viewTest('close', ctx)).length,
    tonight: all.filter(viewTest('tonight', ctx)).length,
  };
}

/**
 * THE NARROWING, applied after scoresV2 built the groups and lifted the Yours
 * band. The band is left whole - it is pinned above the day rail and is the
 * reader's, not the filter's. Every other group loses the games the view or
 * the conference excludes; an emptied group is dropped, and a group whose sub
 * leads with a count is recounted through the helper that wrote it (the same
 * rule withYoursBand follows).
 *
 * A STALE CONF - one not on this day's rows - stops applying rather than
 * emptying the board, the Top 25 rule.
 */
export function applyView(groups, { view = null, conf = null, today, tz = ET, now = new Date() } = {}) {
  const confs = confOptions(groups);
  const useConf = conf && confs.includes(conf) ? conf : null;
  const test = viewTest(view, { today, tz, now });
  const keep = (g) => test(g) && (!useConf || inConf(g, useConf));
  const out = [];
  for (const grp of groups ?? []) {
    if (grp.key === 'yours') { out.push(grp); continue; }
    const games = grp.games.filter(keep);
    if (!games.length) continue;
    if (games.length === grp.games.length) { out.push(grp); continue; }
    out.push(grp.subTail == null ? { ...grp, games } : { ...grp, games, sub: gamesSub(games.length, grp.subTail) });
  }
  return { groups: out, conf: useConf, confs };
}

/** A line as a reader says it: -3.5, +2.5, PK. */
export function fmtLine(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  if (v === 0) return 'PK';
  return v > 0 ? `+${v}` : `${v}`;
}

/**
 * THE ODDS FOOT: "DEN -3.5 · O/U 44.5 · opened -2.5".
 *
 * The line is named by the favourite on the CURRENT number, and the opening is
 * that same team's opening number - so "opened" reads as movement on one
 * team's line, never as a sign flip nobody can parse. spreadHome and
 * openHome are both home-based (negative = home favoured), as oddsReader
 * returns them. Absent pieces drop out; nothing at all is null.
 */
export function oddsFoot(g, { spreadHome = null, total = null, openHome = null } = {}) {
  const bits = [];
  const s = spreadHome == null ? null : Number(spreadHome);
  if (s != null && Number.isFinite(s)) {
    const homeFav = s <= 0;
    const fav = homeFav ? g.home : g.away;
    const ab = fav?.abbreviation ?? '';
    bits.push(`${ab} ${fmtLine(homeFav ? s : -s)}`.trim());
    const o = openHome == null ? null : Number(openHome);
    if (o != null && Number.isFinite(o)) {
      const t = total != null && Number.isFinite(Number(total)) ? `O/U ${Number(total)}` : null;
      if (t) bits.push(t);
      bits.push(`opened ${fmtLine(homeFav ? o : -o)}`);
      return bits.join(' · ');
    }
  }
  if (total != null && Number.isFinite(Number(total))) bits.push(`O/U ${Number(total)}`);
  return bits.length ? bits.join(' · ') : null;
}

/**
 * THE WIN-PROB READ, NFL ONLY (ruling f). CFB's number is shadow
 * (lib/winprob/live.js DISPLAYED) and MLB has none; both get nothing, not a
 * placeholder. `v` is the game page's own view of the stored value
 * (components/gridiron/LiveWinProb.js liveWinProbView), handed in by the
 * card, so a stale or dead number is dropped here exactly as it is there.
 */
export function winProbRead(g, v) {
  if (g?.leagueSlug !== 'nfl' || g.status !== 'live') return null;
  if (!v) return null;
  const homeFav = v.home >= v.away;
  return { abbr: (homeFav ? g.home : g.away)?.abbreviation ?? '', pct: homeFav ? v.home : v.away, stale: v.stale };
}

/** The first-down tick on the field strip: the ball plus the distance, or null at goal-to-go. */
export function firstDownPct(drive) {
  if (!drive || drive.pct == null || drive.togo == null) return null;
  const t = Number(drive.pct) + Number(drive.togo);
  return Number.isFinite(t) && t < 100 ? t : null;
}

/** Leader / trailer for the score ink: 'home' | 'away' | null (tied or unscored). */
export function leaderOf(g) {
  if (g.homeScore == null || g.awayScore == null) return null;
  const h = Number(g.homeScore), a = Number(g.awayScore);
  return h > a ? 'home' : a > h ? 'away' : null;
}
