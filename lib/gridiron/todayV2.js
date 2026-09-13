// lib/gridiron/todayV2.js - everything the Today tab draws, in one read.
//
// THE ROUTES ARE /nfl AND /cfb. There is no Today tab on the container's bar
// any more - it went to four with the You tab - so lib/shell/appTabs.js lights
// SCORES for /nfl, /cfb and /epl, and the Scores tab's league chips are the
// way in. The web header's TODAY is a different page at "/" and is not this.
//
// EVERY READ IS CAUGHT TO ITS OWN EMPTY VALUE. This is the page the app opens
// on; a module that fails is a module that does not render, never a page that
// does not load. The blocks are independent by construction - there is no
// value one block computes that another needs.
//
// SIGNED OUT IS THE SAME PAGE MINUS THE PERSONAL BLOCKS (R3). The numbers -
// the rail, the leaders, the standings, the wire - are identical either way,
// and they are read the same way for both. Only weekly, picks, daily and
// teams are gated, and the empty card plus the kickoff list take their place.

import { getFollowedTeamIds } from '../follows.js';
import { weeklyHero, latestRead, liveElseNext } from './todayReads.js';
import { todayPicks } from './todayPicks.js';
import { dailyV2Home } from '../daily/seasonBoardHome.js';
import { railFor } from './leagueRail.js';
import { railChips } from './leagueLanding.js';
import { standingsSnapshot, marketRows, weekLeaders } from './landingModules.js';
import { wireTeaser } from '../wire/read.js';
import { myFollowedTeamNext } from '../my/reads.js';
import { getSlateByDate, getWeekSlate } from './readers.js';
import { getSpreadHome } from './oddsReader.js';
import { currentApRanks } from '../cfb/rankings.js';
import { resolveSeasonYear } from '../pollers/seasonResolver.js';
import { getNearestUpcomingWeek, getCurrentWeek } from './readers.js';

const empty = (v) => (p) => Promise.resolve(p).catch(() => v);

/** Today in ET - the football day, and the day the eyebrow names. */
export function etDay(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${p.year}-${p.month}-${p.day}`;
}

/** "Sunday · Week 1 · 10:42 AM", the mock's eyebrow. */
export function eyebrow({ now = new Date(), week = null, phase = 'REG', tz = 'America/New_York' } = {}) {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(now);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(now);
  const wk = phase === 'REG' && week != null ? `Week ${week}` : null;
  return [day, wk, time].filter(Boolean).join(' · ');
}

/**
 * THE SIGNED-OUT KICKOFF LIST IS TODAY'S GAMES (Q6), not the next three
 * priced ones. marketRows is date-unbounded - on a quiet Tuesday it returns
 * Sunday - and a Tuesday page showing Sunday is not a Today tab.
 */
export async function kickingOff({ leagueSlug, now = new Date(), limit = 4 } = {}) {
  const slate = await getSlateByDate(etDay(now)).catch(() => null);
  const games = slate?.byLeague?.[leagueSlug] ?? [];
  const ahead = games.filter((g) => g.status !== 'final');
  if (!ahead.length) return [];
  const spreads = await getSpreadHome(ahead.map((g) => g.id)).catch(() => new Map());
  return ahead.slice(0, limit).map((g) => ({
    id: g.id, slug: g.slug, kickoffAt: g.kickoffAt, status: g.status,
    home: g.home, away: g.away, homeScore: g.homeScore, awayScore: g.awayScore,
    liveState: g.liveState ?? null,
    spreadHome: spreads.get(g.id) ?? null,
    href: `/${leagueSlug}/game/${g.slug}`,
  }));
}

/** Followed teams, each with its live game or its next one (R1). */
export async function yourTeams(userId, { now = new Date(), limit = 8 } = {}) {
  if (userId == null) return [];
  const [rows, ap] = await Promise.all([
    myFollowedTeamNext(userId, { now, limit }).catch(() => []),
    currentApRanks().catch(() => ({ ranks: new Map() })),
  ]);
  return rows.map((r) => {
    const forHome = r.home?.abbreviation === r.followName || r.home?.name === r.followName;
    const mine = forHome ? r.home : r.away;
    const opp = forHome ? r.away : r.home;
    return {
      ...r,
      mine, opp, forHome,
      rank: r.leagueSlug === 'cfb' ? ap.ranks.get(r.followTeamId) ?? null : null,
    };
  });
}

/**
 * THE WEEK'S GAMES BY TEAM ABBREVIATION, for the Weekly hero's slot rows.
 *
 * IT HAS TO BE THE WEEK, NOT THE DAY. The first cut matched each player to
 * today's slate, so a lineup spread across Thursday, Sunday and Monday showed
 * a state for the Sunday players and nothing for the rest - the rows that
 * needed it most. The Weekly is an NFL contest scoped to one REG week, so its
 * week is the right bound, and getWeekSlate already returns every game in it
 * with status, live_state and kickoff.
 *
 * Keyed on abbreviation because that is what a Weekly board row carries - the
 * same team-abbreviation match stakeForMatches performs.
 */
export async function weekTeamGames({ week, seasonYear, sport = 'nfl' } = {}) {
  if (week == null || seasonYear == null) return new Map();
  const slate = await getWeekSlate(sport, seasonYear, 'REG', week).catch(() => null);
  const games = (slate?.byDay ?? []).flatMap((d) => d.games ?? []);
  const out = new Map();
  for (const g of games) {
    for (const t of [g.home, g.away]) {
      const a = t?.abbreviation ?? null;
      if (a) out.set(a, { status: g.status, metadata: { live_state: g.liveState ?? null }, kickoffAt: g.kickoffAt });
    }
  }
  return out;
}

/**
 * THE VIEWER ARRIVES AS AN ARGUMENT, not as an auth() call in here. Every
 * other reader in this tree takes a userId and the page resolves the session
 * once - which is also what makes this function testable without a request.
 */
export async function todayV2({ leagueSlug = 'nfl', userId = null, now = new Date() } = {}) {
  const seasonYear = resolveSeasonYear(now);
  const upcoming = await getNearestUpcomingWeek(leagueSlug, seasonYear).catch(() => null);
  const cur = upcoming ?? (await getCurrentWeek(leagueSlug, seasonYear).catch(() => null));
  const week = cur?.week ?? 1;
  const phase = cur?.seasonPhase ?? 'REG';
  const isNfl = leagueSlug === 'nfl';
  const apWeek = isNfl ? null : (await currentApRanks().catch(() => ({ week: null }))).week;

  const [
    read, hero, picks, daily, teams, followed, railRows, snapshot, leaders, wire, kicks,
  ] = await Promise.all([
    empty(null)(latestRead()),
    userId == null ? Promise.resolve(null) : empty(null)(weeklyHero(userId)),
    userId == null ? Promise.resolve(null) : empty(null)(todayPicks(userId, { now })),
    userId == null ? Promise.resolve(null) : empty(null)(dailyV2Home(userId, {})),
    empty([])(yourTeams(userId, { now })),
    userId == null ? Promise.resolve(new Set()) : empty(new Set())(getFollowedTeamIds(userId)),
    empty([])(railFor(leagueSlug, { season: seasonYear, apWeek })),
    empty(null)(standingsSnapshot(leagueSlug, seasonYear, { userId })),
    empty([])(weekLeaders(leagueSlug, seasonYear, week)),
    empty({ items: [], newest: null })(wireTeaser(leagueSlug)),
    empty([])(kickingOff({ leagueSlug, now })),
  ]);
  // The Weekly hero's slot states come from the CONTEST's week, not the day
  // on screen - see weekTeamGames(). Only read when there is a hero to fill.
  const weekGames = hero
    ? await weekTeamGames({ week: hero.week, seasonYear }).catch(() => new Map())
    : new Map();

  const signedIn = userId != null;
  // NOTHING RIDING YET is the honest signed-in state too: an account with no
  // lineup, no picks and no Daily run has the same empty day a stranger does,
  // and pretending otherwise would draw three empty cards instead of one.
  const riding = Boolean(hero || picks?.entered || daily?.run || teams.length);
  return {
    leagueSlug, signedIn, now: now.toISOString(), week, phase,
    eyebrow: eyebrow({ now, week, phase }),
    title: signedIn ? 'Your day' : 'Today',
    read, hero, picks, daily, teams, riding, weekGames,
    chips: railChips(railRows),
    followed,
    snapshot, leaders, wire, kicks,
  };
}
