// lib/rankings/view.js - everything /rankings draws, per view.
//
// EVERY VIEW IS A URL (item 1). league=nfl|cfb|epl, view=teams|players|people,
// plus stat= on players and game= on people. The pills and the segment control
// are links; nothing here is client state, so a view can be shared, bookmarked
// and rendered on the server with no hydration.
//
// EVERY READ IS CAUGHT TO ITS OWN EMPTY VALUE. A module that fails does not
// render; it never takes the tab down.

import { getFollowedTeamIds } from '../follows.js';
import { apTop25, nflPower, ourTop25, groupTable, seasonLeaders, tdLeaders, ourVsAp, STAT_KEYS } from './reads.js';
import { draftBySeat, distanceToRanking, FLOORS } from './people.js';
import { weekLeaders } from '../gridiron/landingModules.js';
import { followedGroup } from '../gridiron/landingModules.js';
import { resolveSeasonYear } from '../pollers/seasonResolver.js';
import { getNearestUpcomingWeek, getCurrentWeek } from '../gridiron/readers.js';
import { pickemTable } from '../games/read.js';
import { getLeagueTable } from '../standings/read.js';

const empty = (v) => (p) => Promise.resolve(p).catch(() => v);

export const LEAGUES = Object.freeze(['nfl', 'cfb', 'epl']);
export const VIEWS = Object.freeze(['teams', 'players', 'people']);
export const GAMES = Object.freeze(['all', 'weekly', 'draft', 'pickem', 'daily']);
export const LEAGUE_LABEL = Object.freeze({ nfl: 'NFL', cfb: 'CFB', epl: 'EPL' });

/** The URL is the state, so parsing it is one function with defaults. */
export function parseRankings(sp = {}) {
  const one = (v) => (Array.isArray(v) ? v[0] : v);
  const league = LEAGUES.includes(one(sp.league)) ? one(sp.league) : 'nfl';
  const view = VIEWS.includes(one(sp.view)) ? one(sp.view) : 'teams';
  const stat = STAT_KEYS.includes(one(sp.stat)) ? one(sp.stat) : 'pass';
  const game = GAMES.includes(one(sp.game)) ? one(sp.game) : 'all';
  return { league, view, stat, game };
}

export function rankingsHref({ league = 'nfl', view = 'teams', stat = null, game = null } = {}) {
  const p = new URLSearchParams();
  if (league !== 'nfl') p.set('league', league);
  if (view !== 'teams') p.set('view', view);
  if (stat && stat !== 'pass' && view === 'players') p.set('stat', stat);
  if (game && game !== 'all' && view === 'people') p.set('game', game);
  const q = p.toString();
  return q ? `/rankings?${q}` : '/rankings';
}

async function weekFor(leagueSlug, seasonYear) {
  const up = await getNearestUpcomingWeek(leagueSlug, seasonYear).catch(() => null);
  const cur = up ?? (await getCurrentWeek(leagueSlug, seasonYear).catch(() => null));
  return { week: cur?.week ?? 1, phase: cur?.seasonPhase ?? 'REG' };
}

// ------------------------------------------------------------------ teams

async function teamsView({ league, userId, seasonYear, followed }) {
  const group = userId == null ? null : await empty(null)(followedGroup(userId, league, seasonYear));
  if (league === 'epl') {
    const [table] = await Promise.all([empty(null)(getLeagueTable('epl', seasonYear))]);
    return { kind: 'epl', table };
  }
  if (league === 'nfl') {
    const [power, division] = await Promise.all([
      empty([])(nflPower({ limit: 8 })),
      empty(null)(groupTable('nfl', seasonYear, group)),
    ]);
    return { kind: 'nfl', power, division };
  }
  const [ap, ours, conference] = await Promise.all([
    empty(null)(apTop25()),
    empty([])(ourTop25({ limit: 5 })),
    empty(null)(groupTable('cfb', seasonYear, group)),
  ]);
  // OUR RANK AGAINST THE POLL'S, per row, at a gap of three or more (R2).
  const apByTeam = new Map((ap?.rows ?? []).map((r) => [r.teamId, r.rank]));
  const oursWithGap = ours.map((r) => ({ ...r, vsAp: ourVsAp(r.rank, apByTeam.get(r.teamId) ?? null) }));
  return { kind: 'cfb', ap, ours: oursWithGap, conference };
}

// ----------------------------------------------------------------- players

async function playersView({ league, stat, seasonYear, week, weeklyTeams }) {
  const [season, wk, td] = await Promise.all([
    empty([])(seasonLeaders(league, { season: seasonYear, stat, limit: 5 })),
    empty([])(weekLeaders(league, seasonYear, week)),
    league === 'cfb' ? empty([])(tdLeaders('cfb', { season: seasonYear })) : Promise.resolve(null),
  ]);
  // NFL ONLY: the PPR season board, with the reader's own Weekly six marked.
  // CFB gets no fantasy module AND no note about its absence - the mock's
  // note was written for Derik, not for a reader.
  const fantasy = league === 'nfl'
    ? await empty([])(seasonLeaders('nfl', { season: seasonYear, stat: 'td', limit: 5 }))
      .then((rows) => rows.map((r) => ({ ...r, mine: weeklyTeams.has(r.name) })))
    : null;
  return { stat, season, week: wk, td, fantasy };
}

// ------------------------------------------------------------------ people

async function peopleView({ userId, game }) {
  const want = (k) => game === 'all' || game === k;
  const [pickem, seat] = await Promise.all([
    want('pickem') ? empty(null)(pickemTable(userId, { limit: 4 })) : Promise.resolve(null),
    want('draft') ? empty(null)(draftBySeat(userId)) : Promise.resolve(null),
  ]);
  const mods = [];
  if (pickem) {
    const self = pickem.self ?? null;
    mods.push({
      key: 'pickem', title: "Pick'em · correct %", sub: `NFL + CFB · min ${FLOORS.pickem} boards`,
      rows: pickem.top.map((r) => ({
        rank: r.rank ?? null, name: r.name, sub: `${r.boardsPlayed} boards · ${r.correct}-${r.played - r.correct}`,
        value: `${r.pct}%`, you: userId != null && r.userId === userId,
      })),
      self: self ? {
        rank: null, name: self.name, you: true,
        sub: [`${self.boardsPlayed} board${self.boardsPlayed === 1 ? '' : 's'}`,
          `${self.correct}-${self.played - self.correct}`,
          distanceToRanking(self.boardsPlayed, FLOORS.pickem, 'board')?.text?.split(' · ')[1]]
          .filter(Boolean).join(' · '),
        value: `${self.pct}%`,
      } : null,
      href: '/games?pane=leaderboards',
    });
  }
  return { mods, seat, game };
}

// --------------------------------------------------------------------------

export async function rankingsView({ sp = {}, userId = null, now = new Date() } = {}) {
  const { league, view, stat, game } = parseRankings(sp);
  const seasonYear = resolveSeasonYear(now);
  const { week, phase } = await weekFor(league === 'epl' ? 'epl' : league, seasonYear);
  const followed = userId == null ? new Set() : await empty(new Set())(getFollowedTeamIds(userId));

  // The reader's Weekly six, by player name, for the fantasy module's mark.
  let weeklyTeams = new Set();
  if (view === 'players' && league === 'nfl' && userId != null) {
    const { weeklyHero } = await import('../gridiron/todayReads.js');
    const hero = await empty(null)(weeklyHero(userId));
    weeklyTeams = new Set((hero?.rows ?? []).map((r) => r.name).filter(Boolean));
  }

  const base = {
    league, view, stat, game, week, phase, seasonYear,
    signedIn: userId != null, followed,
    eyebrow: [new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long' }).format(now),
      phase === 'REG' ? `Week ${week}` : null].filter(Boolean).join(' · '),
  };
  if (view === 'teams') return { ...base, teams: await teamsView({ league, userId, seasonYear, followed }) };
  if (view === 'players') return { ...base, players: await playersView({ league, stat, seasonYear, week, weeklyTeams }) };
  return { ...base, people: await peopleView({ userId, game }) };
}
