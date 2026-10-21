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

import { cardLine } from '../daily/cardLine.js';
import { roundLabel, BEST_OF } from '../mlb/postseason.js';

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
// cardLine lives in lib/daily/cardLine.js (shared with the Daily's result screen).
export { cardLine };

export function yesterdayDaily({ board = null, played = 0, top = [] } = {}) {
  if (!board || !played) return null;
  return {
    answer: `${board.seasonYear} season. The perfect lineup scored ${fmt(board.ceiling)}: ${board.best.map((p) => `${p.name} ${p.slot}`).join(', ')}.`,
    // THE LINEUP GRID (mon-3): the perfect lineup, slot by slot.
    seasonYear: board.seasonYear, ceiling: board.ceiling,
    // THE ANSWER CARDS (tue-0): the position (for its colour) and the season line the
    // Daily's result screen prints (best_roster.meta); a missing line is left out.
    lineup: board.best.map((p) => ({ slot: p.slot, name: p.name, position: p.position ?? null, line: cardLine(p.meta, p) })),
    played, top: top.slice(0, 3),
  };
}

/**
 * 4. THIS WEEK. days: the seven ET dates Mon..Sun; counts: [{ league, day, n }];
 * today: ET date. -> { days: [{ dow, today }], rows: [{ league, cells: [n] }] } | null
 */
export function weekGrid({ days = [], counts = [], today, maybes = [] } = {}) {
  // maybes: [{ league, day, label }] - "if needed" games, counted but starred.
  const rows = WEEK_LEAGUES.map((l) => ({
    league: LEAGUE_LABEL[l],
    cells: days.map((d) => counts.filter((c) => c.league === l && c.day === d).reduce((s, c) => s + c.n, 0)),
    starred: days.map((d) => maybes.some((m) => m.league === l && m.day === d)),
  })).filter((r) => r.cells.some((n) => n > 0));
  if (!rows.length) return null;
  const notes = [...new Set(maybes.filter((m) => days.includes(m.day)).map((m) => `* ${m.label}`))];
  return { days: days.map((d, i) => ({ date: d, dow: DOW[i], today: d === today })), rows, notes };
}

/**
 * 5. GAME OF THE DAY - THE LEAD ORDER (mon-3, Derik):
 *   1 NFL primetime (TNF / SNF / MNF: Thu, Sun or Mon at 7 PM ET or later)
 *   2 a season opener (a league in SEASON_OPENERS opening today)
 *   3 a playoff game   4 a rivalry (same division; same conference in college)
 *   5 the closest line, then the earliest kickoff.
 * ALSO TONIGHT: on a day with a primetime game AND an opener, the best game of
 * whichever of those two did not lead shows right under the lead.
 * games: [{ league, stage, kickoffAt, primetime, homeDiv, awayDiv, homeConf, awayConf, spread }]
 * -> { ...lead, why, also: game | null } | null
 */
export function pickGameOfDay(games = [], { openers = [] } = {}) {
  if (!games.length) return null;
  const rivalry = (g) => (g.league === 'cfb'
    ? g.homeConf != null && g.homeConf === g.awayConf
    : g.homeDiv != null && g.homeDiv === g.awayDiv);
  const opener = (g) => openers.includes(g.league) && SEASON_OPENERS.some((c) => c.league === g.league);
  const tier = (g) => (g.primetime ? 0 : opener(g) ? 1 : isPlayoff(g) ? 2 : rivalry(g) ? 3 : 4);
  const rank = (g) => [tier(g), g.spread == null ? Infinity : Math.abs(g.spread), new Date(g.kickoffAt).getTime()];
  const order = (a, b) => {
    const x = rank(a); const y = rank(b);
    for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  };
  const sorted = [...games].sort(order);
  const lead = sorted[0];
  const WHY = ['primetime', 'season opener', 'playoff', 'rivalry', null];
  const leadTier = tier(lead);
  const also = leadTier <= 1 ? sorted.find((g) => tier(g) === (leadTier === 0 ? 1 : 0)) ?? null : null;
  const why = WHY[leadTier] ?? (lead.spread != null ? 'closest line' : null);
  return { ...lead, why, also: also ? { ...also, why: WHY[tier(also)] } : null };
}

/** "Monday Night Football" for an NFL game at 7 PM ET or later on Thu / Sun / Mon, else null. */
export function primetimeName(league, etWeekday, etHour) {
  if (league !== 'nfl' || etHour < 19) return null;
  return { Thu: 'Thursday Night Football', Sun: 'Sunday Night Football', Mon: 'Monday Night Football' }[etWeekday] ?? null;
}

/** 6. FREE TO PLAY: three open games (one per game), soonest lock first. contests: [{ label, path, locksAt }] */
export function freeToPlay(contests = [], { daily = null } = {}) {
  const seen = new Set();
  // THE DAILY LEADS THE ROW when there is one (mon-3: Pick'em, Daily, Weekly tiles).
  const out = daily ? [daily] : [];
  for (const c of [...contests].sort((a, b) => new Date(a.sortAt ?? a.locksAt) - new Date(b.sortAt ?? b.locksAt))) {
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

// ---------------------------------------------------------------------------
// 0 THE HERO - season-opener days only (mon-1 addendum)
// ---------------------------------------------------------------------------

/**
 * THE OPENERS a hero can lead with. A league in this list whose regular season
 * starts today (loadDay's `openers`) puts a hero above everything else; the
 * default - any other day, any league not listed - is no hero. Add NFL, CFB,
 * MLB or EPL here when their opener comes round.
 */
export const SEASON_OPENERS = Object.freeze([
  {
    league: 'nba', eyebrow: 'NBA IS BACK', cta: 'Make your picks', path: '/pickem/nba',
    confidenceLine: 'New: rank your picks by confidence',
    prep: { label: 'Draft prep: run an NBA mock', path: '/mock/nba' },
    spotlight: { key: 'app', title: 'The Sportsvyn app', line: "Follow tonight's games on your lock screen with Live Activities.", path: null },
  },
]);

/**
 * The hero for today, or null. openers: leagues opening today; games: today's
 * shaped games; board: tonight's Pick'em board for that league
 * ({ confidence }) or null when it is not built yet - the button still goes to
 * /pickem/<league> (which opens tonight's board when it exists) and the
 * confidence line hides. tipTime(g) -> "7:00 PM ET / 4:00 PM PT".
 */
export function heroFor({ openers = [], games = [], boards = {}, tipTime = () => '' } = {}) {
  const cfg = SEASON_OPENERS.find((c) => openers.includes(c.league));
  if (!cfg) return null;
  const tonight = games.filter((g) => g.league === cfg.league).sort((a, b) => new Date(a.kickoffAt) - new Date(b.kickoffAt));
  if (!tonight.length) return null;
  const board = boards[cfg.league] ?? null;
  return {
    league: cfg.league, eyebrow: cfg.eyebrow, cta: cfg.cta, path: cfg.path,
    games: tonight.map((g) => ({ away: g.away, home: g.home, time: tipTime(g) })),
    confidenceLine: board?.confidence ? cfg.confidenceLine : null,
    prep: cfg.prep, spotlight: cfg.spotlight,
  };
}

/** On an opener day the subject leads with it: "NBA opening night: 3 games tonight - make your picks". */
export function heroSubject(hero) {
  if (!hero) return null;
  const n = hero.games.length;
  return `${LEAGUE_LABEL[hero.league] ?? hero.league.toUpperCase()} opening night: ${n} game${n === 1 ? '' : 's'} tonight - ${hero.cta.toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// THE COUNTING RULE (mon-3): the email counts games exactly as /scores does
// ---------------------------------------------------------------------------

/**
 * /scores' rule (lib/gridiron/scoresV2.js windowGames): a game counts unless its
 * status is 'not_needed' (a decided series' leftover game, lib/mlb/notNeeded.js).
 * Postponed and cancelled rows still count there, so they count here too - one
 * rule, two surfaces, the same number.
 */
export const countsAsGame = (g) => g?.status !== 'not_needed';

/**
 * "ONLY IF NEEDED": an MLB postseason game that may not be played. In an
 * undecided series the first unplayed game is certain; a later one is "if
 * needed" when either club could clinch before it (max wins + the unplayed
 * games ahead of it reach the wins needed). series: every game of the pairing
 * in the round, { id, kickoffAt, status, winner } (winner = club key or null).
 * -> { gameNumber, label } | null
 */
const SERIES_SKIP = new Set(['cancelled', 'canceled', 'not_needed', 'postponed']);

export function ifNeeded(game, series = [], { stage, homeConf = null } = {}) {
  const bestOf = BEST_OF[stage];
  if (!bestOf || game.status !== 'scheduled') return null;
  const need = Math.floor(bestOf / 2) + 1;
  // THE SERIES' OWN GAMES, numbered as lib/playoffs/seriesLine.js numbers them:
  // a postponed, cancelled or not-needed row is not a game of the series.
  const live = series.filter((g) => !SERIES_SKIP.has(g.status)).sort((a, b) => new Date(a.kickoffAt) - new Date(b.kickoffAt) || a.id - b.id);
  const finals = live.filter((g) => g.status === 'final');
  const wins = new Map();
  for (const g of finals) if (g.winner != null) wins.set(g.winner, (wins.get(g.winner) ?? 0) + 1);
  const top = Math.max(0, ...wins.values());
  if (top >= need) return null; // decided: the leftovers are not_needed, not "if needed"
  const n = live.findIndex((g) => g.id === game.id) + 1;
  if (n <= finals.length + 1) return null; // the next game is certain
  if (top + (n - 1 - finals.length) < need) return null; // nobody can clinch before it
  return { gameNumber: n, label: `${roundLabel(stage, homeConf) ?? 'Series'} Game ${n}, only if needed` };
}
