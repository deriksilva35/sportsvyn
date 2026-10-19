// lib/email/morningModules.js - THE MORNING EMAIL'S MODULES, as rules (mon-1, thu-1
// spec). PURE: plain data in, each module's content out - or null, and a null
// module is not in the mail ("each one hides itself when empty").
//
//   headlineFor       1  one line from the day ("NBA opening night: 11 games")
//   yesterdayDaily    2  the answer, how many played, the top 3
//   weekGrid          4  game counts by sport, Mon-Sun, today marked
//   pickGameOfDay     5  playoff > rivalry > closest line > earliest
//   freeToPlay        6  three open games, soonest lock first
//   yourMove          7  your yesterday + your entries locking today (players only)
//   spotlightFor      8  one feature a day, in rotation; the app link only without an iOS device
// No coins anywhere: nothing here names, counts or promises them.

import { roundLabel } from '../mlb/postseason.js';

export const LEAGUE_LABEL = Object.freeze({ nfl: 'NFL', cfb: 'CFB', mlb: 'MLB', nba: 'NBA', epl: 'EPL', ucl: 'UCL' });
export const WEEK_LEAGUES = Object.freeze(['nfl', 'cfb', 'mlb', 'nba', 'epl', 'ucl']);
const DOW = Object.freeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

/**
 * A KNOCKOUT OR POSTSEASON GAME. The stage words differ by league: in soccer a
 * 'group' or 'league' stage is the league phase (UCL), not a playoff - only the
 * knockout rounds count; in MLB / NFL / NBA any stage is the postseason.
 */
const SOCCER = new Set(['epl', 'ucl']);
const KNOCKOUT = new Set(['playoff', 'round_of_32', 'round_of_16', 'quarter', 'semi', 'third_place', 'final']);
export const isPlayoff = (g) => Boolean(g?.stage) && (SOCCER.has(g.league) ? KNOCKOUT.has(g.stage) : g.stage !== 'group');

const SOCCER_STAGE = Object.freeze({ playoff: 'Knockout playoff', round_of_32: 'Round of 32', round_of_16: 'Round of 16', quarter: 'Quarterfinal', semi: 'Semifinal', third_place: 'Third place', final: 'Final' });
/** "ALCS" / "World Series" (lib/mlb/postseason.js), "UCL Round of 16", else "Playoffs". */
const roundOf = (g) => (g.league === 'mlb' ? (roundLabel(g.stage, g.homeConf) ?? 'MLB playoffs')
  : SOCCER.has(g.league) ? `${LEAGUE_LABEL[g.league]} ${SOCCER_STAGE[g.stage] ?? 'knockout'}`
  : `${LEAGUE_LABEL[g.league] ?? ''} playoffs`.trim());

/**
 * 1. THE HEADLINE. games: today's [{ league, stage, away, home, kickoffAt, dow }];
 * openers: leagues whose regular season starts today. -> string | null
 */
export function headlineFor({ games = [], openers = [] } = {}) {
  if (!games.length) return null;
  const by = (l) => games.filter((g) => g.league === l);
  for (const l of openers) {
    const n = by(l).length;
    if (n) return `${LEAGUE_LABEL[l] ?? l.toUpperCase()} opening night: ${n} game${n === 1 ? '' : 's'}`;
  }
  const po = games.filter(isPlayoff);
  if (po.length === 1) return `${roundOf(po[0])}: ${po[0].away} at ${po[0].home}`;
  if (po.length > 1) {
    const rounds = [...new Set(po.map(roundOf))];
    return `${rounds.length <= 2 ? rounds.join(' and ') : 'Playoffs'}: ${po.length} games today`;
  }
  const nfl = by('nfl');
  if (nfl.length === 1 && (nfl[0].dow === 'Mon' || nfl[0].dow === 'Thu')) {
    return `${nfl[0].dow === 'Mon' ? 'Monday' : 'Thursday'} Night Football: ${nfl[0].away} at ${nfl[0].home}`;
  }
  const counts = WEEK_LEAGUES.map((l) => [l, by(l).length]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  return `${games.length} game${games.length === 1 ? '' : 's'} today: ${counts.slice(0, 3).map(([l, n]) => `${n} ${LEAGUE_LABEL[l]}`).join(' · ')}`;
}

/**
 * 2. YESTERDAY'S DAILY. board: { seasonYear, ceiling, best: [{name, slot}] };
 * played: how many finished it; top: [{ name, score }] (display names).
 */
export function yesterdayDaily({ board = null, played = 0, top = [] } = {}) {
  if (!board || !played) return null;
  return {
    answer: `${board.seasonYear} season. The perfect lineup scored ${fmt(board.ceiling)}: ${board.best.map((p) => `${p.name} ${p.slot}`).join(', ')}.`,
    played, top: top.slice(0, 3),
  };
}

/**
 * 4. THIS WEEK. days: the seven ET dates Mon..Sun; counts: [{ league, day, n }];
 * today: ET date. -> { days: [{ dow, today }], rows: [{ league, cells: [n] }] } | null
 */
export function weekGrid({ days = [], counts = [], today } = {}) {
  const rows = WEEK_LEAGUES.map((l) => ({
    league: LEAGUE_LABEL[l],
    cells: days.map((d) => counts.filter((c) => c.league === l && c.day === d).reduce((s, c) => s + c.n, 0)),
  })).filter((r) => r.cells.some((n) => n > 0));
  if (!rows.length) return null;
  return { days: days.map((d, i) => ({ dow: DOW[i], today: d === today })), rows };
}

/**
 * 5. GAME OF THE DAY: a playoff game; else a rivalry (same division, or same
 * conference in college); else the closest line; else the earliest kickoff.
 * games: [{ ...headline game, homeDiv, awayDiv, homeConf, awayConf, spread (abs) }]
 */
export function pickGameOfDay(games = []) {
  if (!games.length) return null;
  const rivalry = (g) => (g.league === 'cfb'
    ? g.homeConf != null && g.homeConf === g.awayConf
    : g.homeDiv != null && g.homeDiv === g.awayDiv);
  const rank = (g) => [isPlayoff(g) ? 0 : 1, rivalry(g) ? 0 : 1, g.spread == null ? Infinity : Math.abs(g.spread), new Date(g.kickoffAt).getTime()];
  const sorted = [...games].sort((a, b) => {
    const x = rank(a); const y = rank(b);
    for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  });
  const g = sorted[0];
  return { ...g, why: isPlayoff(g) ? 'playoff' : rivalry(g) ? 'rivalry' : g.spread != null ? 'closest line' : null };
}

/** 6. FREE TO PLAY: three open games (one per game), soonest lock first. contests: [{ label, path, locksAt }] */
export function freeToPlay(contests = []) {
  const seen = new Set();
  const out = [];
  for (const c of [...contests].sort((a, b) => new Date(a.locksAt) - new Date(b.locksAt))) {
    if (seen.has(c.label)) continue;
    seen.add(c.label);
    out.push(c);
    if (out.length === 3) break;
  }
  return out.length ? out : null;
}

/** 7. YOUR MOVE - players only; hidden with nothing to say. */
export function yourMove({ player = false, yesterday = null, locks = [] } = {}) {
  if (!player || (!yesterday && !locks.length)) return null;
  return { yesterday, locks };
}

export const SPOTLIGHTS = Object.freeze([
  { key: 'widgets', title: 'Home screen widgets', line: 'Your next lock and live scores on your home screen, from the Sportsvyn app.', path: null },
  { key: 'live-activity', title: 'Live Activities', line: 'Follow a game on your lock screen, score by score, without opening a thing.', path: null },
  { key: 'leagues', title: 'Leagues', line: 'Start a league with friends: one table across the Daily, Pick\'em and more.', path: '/leagues/new' },
  { key: 'mock-drafts', title: 'Mock drafts', line: 'Run an NFL or NBA mock draft against the clock, and get a grade.', path: '/mock/nfl' },
]);

/** 8. ONE FEATURE A DAY, in rotation by ET date. The app link only when the account has no iOS device. */
export function spotlightFor(day, { hasIosDevice = false } = {}) {
  const [y, m, d] = String(day).split('-').map(Number);
  const n = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
  return { ...SPOTLIGHTS[((n % SPOTLIGHTS.length) + SPOTLIGHTS.length) % SPOTLIGHTS.length], appLink: !hasIosDevice };
}

export function fmt(x) {
  if (x == null || !Number.isFinite(Number(x))) return '';
  return Number(x).toLocaleString('en-US', { maximumFractionDigits: 1 });
}
