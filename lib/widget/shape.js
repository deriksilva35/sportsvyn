// lib/widget/shape.js - THE iOS WIDGET FEED'S SHAPE, v1 (sun-22). PURE.
//
// The Mac builds the widgets; this repo serves their data. Everything here is
// a function of its arguments and a clock that is always passed in, so the
// fixtures under docs/widgets/fixtures/ are this file's own output on stub
// inputs (scripts/widget-fixtures.mjs) and a test regenerates them to prove
// they have not drifted.
//
// THE CONTRACT IS docs/widgets/feed-v1.md. The rules it states, in one place:
//   - every time is a UTC ISO string ending in Z (the widget formats locally)
//   - no nested team objects: a team is flattened onto its row as id,
//     abbreviation, short name and two colours
//   - lists are capped (GAMES_MAX, TEAMS_MAX, IN_YOUR_GAMES_MAX) and strings
//     clipped (STR_MAX), so the maxed payload stays under SIZE_LIMIT
//   - a signed-out, expired or age-pending reader gets a 200 with a `state`
//     saying so and empty data, never an error
//
// WHAT "URGENT" MEANS (defined here, once): a game the reader can still act
// on - open, and not complete for them (lib/games/playLobby.js isActionable) -
// whose next lock is at most URGENT_MS (60 minutes) away. A game the reader
// has already finished is never urgent, however close its lock.

import { isActionable, phaseOf, SPORT_LABEL, playLobby } from '../games/playLobby.js';
import { shortOf, finalShortOf, sportOf, hasClock } from '../live/vocabulary.js';
import { pickState, driveStripFor } from '../gridiron/scoresV2Shape.js';
import { winProbDisplayed } from '../winprob/display.js';
import { resolveAbbr } from '../live/teamAbbr.js';

export const FEED_VERSION = 1;
export const URGENT_MS = 60 * 60_000;
export const GAMES_MAX = 6;
export const TEAMS_MAX = 4;
export const IN_YOUR_GAMES_MAX = 4;
export const STR_MAX = 40;
/** The feed's byte budget, asserted on a maxed fixture. */
export const SIZE_LIMIT = 8 * 1024;
/** Win probability older than this is not shown (components/gridiron/LiveWinProb.js DEAD_SEC). */
export const WINPROB_DEAD_MS = 300_000;

export const STATE_OK = 'ok';
export const STATE_SIGNED_OUT = 'signed_out';
export const STATE_AGE = 'age_required';

/** Where each non-ok state sends the reader. Site paths; the widget prefixes its host. */
export const STATE_CTA = Object.freeze({
  [STATE_SIGNED_OUT]: { label: 'Sign in', href: '/signin' },
  [STATE_AGE]: { label: 'Confirm your age', href: '/age' },
});

/** Any instant -> 'YYYY-MM-DDTHH:MM:SS.sssZ', or null. Never a local-time string. */
export function z(v) {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** A short string, or null. Clipped with an ellipsis so a long title cannot grow the payload. */
export function clip(s, n = STR_MAX) {
  if (s == null) return null;
  const t = String(s).replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

const int = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
const ms = (v) => (v == null ? null : new Date(v).getTime());

/**
 * A team's badge letters: its abbreviation, else 2-4 letters derived from its
 * name (lib/live/teamAbbr.js - 105 CFB teams have no abbreviation). Not the
 * short name: "Abilene Chr" does not fit a badge.
 */
export const badge = (abbreviation, name) => clip(resolveAbbr({ abbreviation, name }).value, 6);

/** A link, whole or not at all: a clipped path is a broken one. */
export const HREF_MAX = 64;
export const hrefOf = (h) => (typeof h === 'string' && h.startsWith('/') && h.length <= HREF_MAX ? h : null);

/** Only the keys with a value: an OPTIONAL field is absent, never null. */
export const optional = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));

/** The game page a match row links to. */
export function gameHref(leagueSlug, slug) {
  if (!slug) return null;
  if (leagueSlug === 'epl') return `/epl/match/${slug}`;
  return `/${leagueSlug}/game/${slug}`;
}

/** ?teams=1,2,3 -> up to TEAMS_MAX distinct positive integer ids, or null. */
export function parseTeamIds(raw) {
  if (raw == null || raw === '') return null;
  const ids = [...new Set(String(raw).split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0))];
  return ids.length ? ids.slice(0, TEAMS_MAX) : null;
}

/** The empty data every state carries, so the widget decodes one shape. */
function emptyData() {
  return { yourMove: { count: 0, nextLock: null }, games: [], daily: null, teams: [], inYourGames: [] };
}

/** The envelope. `state` first after the version so a reader can switch on it. */
function envelope(state, now, data) {
  return { v: FEED_VERSION, state, generatedAt: z(now), cta: STATE_CTA[state] ?? null, ...data };
}

/** Signed out, a bad token or an expired one: one answer for all three. */
export function signedOutFeed(now) {
  return envelope(STATE_SIGNED_OUT, now, emptyData());
}

/** Signed in, but the account has not passed the age screen: no data. */
export function ageFeed(now) {
  return envelope(STATE_AGE, now, emptyData());
}

// ---------------------------------------------------------------------------
// GAMES AND YOUR MOVE, from the Play lobby's view (lib/games/playLobby.js)
// ---------------------------------------------------------------------------

/** URGENT: actionable, and the next lock at most URGENT_MS away. */
export function isUrgent(item, now) {
  if (!isActionable(item, now)) return false;
  const left = ms(item.locksAt) - new Date(now).getTime();
  return left > 0 && left <= URGENT_MS;
}

/** Picks or slots still to make, from the game's own progress; null when it has none. */
function remaining(item) {
  const p = item.progress;
  if (!p || !Number.isFinite(Number(p.total))) return null;
  return Math.max(0, Number(p.total) - Number(p.done ?? 0));
}

export function gameRow(item, now) {
  return {
    key: clip(item.key, 32),
    sport: SPORT_LABEL[item.sport] ?? clip(String(item.sport ?? '').toUpperCase(), 12),
    name: clip(item.name),
    title: clip(item.title),
    line: clip(item.status),
    count: remaining(item),
    lockAt: z(item.locksAt),
    urgent: isUrgent(item, now),
    href: hrefOf(item.href),
  };
}

/**
 * THE WIDGET'S VIEW OF THE LOBBY: playLobby() as the reader is signed in, ALL
 * chip, and WITH the Daily. Since mon-2 the Play page hands the Daily to its
 * banner and drops it from YOUR MOVE; the widget's contract (docs/widgets/
 * feed-v1.md: yourMove counts "The Daily included") did not change with that
 * page, so every widget caller - reads.js, the fixtures, the tests - builds its
 * view here, once.
 */
export function widgetView(items = [], now) {
  return playLobby(items, { now, signedIn: true, chip: 'all', keepDaily: true });
}

/**
 * YOUR MOVE and the GAMES list from playLobby()'s view.
 *   yourMove  every item the reader can act on (the lobby's own yourMove,
 *             The Daily included), the count and the soonest lock
 *   games     the move items first in lock order, then the rest of the
 *             reader's open or in-play games in the lobby's group order;
 *             never The Daily (it has its own block), never a settled or
 *             not-yet-open game. At most GAMES_MAX. (The next door is the
 *             top-level nextOpening, never a row here - sun-25.)
 */
/**
 * THE NEXT OPENING: the soonest door among items that have not opened yet
 * (never The Daily, which opens every midnight). Null when there is none.
 * It is the feed's top-level, OPTIONAL `nextOpening` (sun-25, the Mac's name):
 * present whenever a door is ahead - so a quiet day's widget has something to
 * say when games[] is empty - and absent when there is none.
 */
export function nextOpening(items = [], now) {
  const t = new Date(now).getTime();
  return items
    .filter((i) => i.sport !== 'all' && phaseOf(i, now) === 'upcoming' && ms(i.opensAt) > t)
    .sort((a, b) => ms(a.opensAt) - ms(b.opensAt) || String(a.key).localeCompare(String(b.key)))[0] ?? null;
}

export function playBlocks(view, now) {
  const moves = view?.yourMove ?? [];
  const first = moves.find((i) => i.locksAt) ?? null;
  const yourMove = {
    count: moves.length,
    nextLock: first ? { game: clip(first.name), sport: SPORT_LABEL[first.sport] ?? null, at: z(first.locksAt) } : null,
  };
  const seen = new Set();
  const games = [];
  const take = (i) => {
    if (games.length >= GAMES_MAX || seen.has(i.key) || i.sport === 'all') return;
    const p = phaseOf(i, now);
    if (p !== 'open' && p !== 'locked') return;
    seen.add(i.key);
    games.push(gameRow(i, now));
  };
  moves.forEach(take);
  for (const g of view?.groups ?? []) (g.rows ?? []).forEach(take);
  return { yourMove, games };
}

// ---------------------------------------------------------------------------
// THE DAILY, from lobbyV2()'s daily card and streak
// ---------------------------------------------------------------------------

/** state: 'play' | 'in-progress' | 'done' | 'none'. open = the board can still be played. */
export function dailyBlock(card, streak = 0, now) {
  if (!card) return null;
  const closesAt = z(card.closesAt);
  const state = ['play', 'in-progress', 'done', 'none'].includes(card.state) ? card.state : 'play';
  const open = (state === 'play' || state === 'in-progress') && closesAt != null && ms(closesAt) > new Date(now).getTime();
  return { state, open, closesAt, streak: int(streak) ?? 0, href: '/daily/board' };
}

// ---------------------------------------------------------------------------
// TEAMS, from the team rows (lib/widget/reads.js teamRows)
// ---------------------------------------------------------------------------

/** 'pre' | 'live' | 'final' | 'none' (no game in the window). */
function gameStatus(status) {
  if (status === 'live') return 'live';
  if (status === 'final') return 'final';
  if (status == null) return 'none';
  return 'pre';
}

/** "Q3 7:22", "Top 7th", "HT", "F/OT", or null. */
export function clockOf(status, liveState, leagueSlug) {
  const sport = sportOf(leagueSlug);
  if (status === 'live') {
    const short = shortOf(liveState, sport);
    if (!short) return 'Live';
    const c = hasClock(sport) && !['HT', 'Half'].includes(short) ? (liveState?.clock ?? null) : null;
    return clip(c ? `${short} ${c}` : short, 16);
  }
  if (status === 'final') return finalShortOf(liveState?.period, sport);
  return null;
}

/**
 * THE WIN PROBABILITY a phone may show, for ONE side, or null. Four gates:
 * the game is live; the sport displays one (lib/winprob/display.js); the phone
 * switch is on FOR THAT LEAGUE (winProbForPhone, the same function the Live
 * Activity obeys - lib/push/liveActivityState.js); and the stored number is a
 * whole 0..100 stamped inside WINPROB_DEAD_MS. live_state.win_prob is the
 * HOME side's.
 */
export function winProbFor({ status, liveState, leagueSlug, home, phoneOn, now }) {
  // phoneOn: a boolean, or a per-league function - liveActivityState.js
  // winProbForPhone, which is per sport once winprob-phone-nfl lands (NFL on,
  // CFB off: lib/winprob/display.js PHONE) and env-driven (off) before it.
  const on = typeof phoneOn === 'function' ? phoneOn(leagueSlug) === true : phoneOn === true;
  if (status !== 'live' || !on || !winProbDisplayed(leagueSlug)) return null;
  const wp = liveState?.win_prob;
  if (!Number.isInteger(wp) || wp < 0 || wp > 100) return null;
  const at = Date.parse(liveState?.win_prob_at ?? '');
  if (!Number.isFinite(at) || new Date(now).getTime() - at > WINPROB_DEAD_MS) return null;
  return home ? wp : 100 - wp;
}

/**
 * One followed (or picked) team's row. `r` is a teamRows() row: the team, its
 * focus game (live, else a final inside the window, else the next one) and the
 * kickoff of its next game after that.
 */
/**
 * POSSESSION AND FIELD POSITION, live football only (sun-24): driveStripFor()
 * over the game's recent plays - the Scores card's own derivation. possession
 * is the offense's badge letters; fieldPos the spot ("BUF 35", "50"), the last
 * snap's when the next down cannot be named (a turnover, a score).
 */
export function livePossession(r, home) {
  if (!['nfl', 'cfb'].includes(r.leagueSlug) || !r.plays?.length) return {};
  const me = { id: Number(r.teamId), abbreviation: r.teamAbbr ?? null, name: r.teamFullName ?? r.teamName ?? null };
  const them = { id: Number(r.oppId), abbreviation: r.oppAbbr ?? null, name: r.oppFullName ?? r.oppName ?? null };
  const strip = driveStripFor({ plays: r.plays, game: { home: home ? me : them, away: home ? them : me } });
  if (!strip) return {};
  return { possession: clip(strip.offenseAbbr, 6), fieldPos: clip(strip.spot ?? strip.snapSpot, 12) };
}

export function teamRow(r, { now, phoneOn = false } = {}) {
  const home = r.gameId != null && Number(r.homeTeamId) === Number(r.teamId);
  const status = r.gameId == null ? 'none' : gameStatus(r.status);
  const score = status === 'pre' || status === 'none' ? null : int(home ? r.homeScore : r.awayScore);
  const oppScore = status === 'pre' || status === 'none' ? null : int(home ? r.awayScore : r.homeScore);
  let result = null;
  if (status === 'final' && score != null && oppScore != null) result = score > oppScore ? 'W' : score < oppScore ? 'L' : 'T';
  return {
    teamId: int(r.teamId),
    team: badge(r.teamAbbr, r.teamFullName ?? r.teamName),
    teamName: clip(r.teamName, 24),
    league: clip(r.leagueSlug, 8),
    color: clip(r.color, 9),
    altColor: clip(r.altColor, 9),
    gameId: int(r.gameId),
    home: r.gameId == null ? null : home,
    oppId: int(r.oppId),
    opp: badge(r.oppAbbr, r.oppFullName ?? r.oppName),
    oppName: clip(r.oppName, 24),
    status,
    score,
    oppScore,
    clock: clockOf(r.status, r.liveState, r.leagueSlug),
    winProb: winProbFor({ status: r.status, liveState: r.liveState, leagueSlug: r.leagueSlug, home, phoneOn, now }),
    startAt: z(r.kickoffAt),
    nextAt: z(r.nextAt),
    result,
    href: hrefOf(r.gameId != null ? gameHref(r.leagueSlug, r.gameSlug) : (r.teamSlug ? `/team/${r.teamSlug}` : null)),
    // OPTIONAL, ADDITIVE (sun-24, v stays 1): present only when there is a value.
    ...optional({
      oppColor: clip(r.oppColor, 9),
      oppAltColor: clip(r.oppAltColor, 9),
      ...(status === 'live' ? livePossession(r, home) : {}),
    }),
  };
}

const STATUS_RANK = { live: 0, final: 1, pre: 2, none: 3 };

/** Live first, then a fresh final, then the soonest kickoff, then teams with no game. */
export function teamsBlock(rows = [], opts = {}) {
  return rows.map((r) => teamRow(r, opts))
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]
      || (a.status === 'final' ? (ms(b.startAt) ?? 0) - (ms(a.startAt) ?? 0) : (ms(a.startAt) ?? Infinity) - (ms(b.startAt) ?? Infinity))
      || (a.teamId ?? 0) - (b.teamId ?? 0))
    .slice(0, TEAMS_MAX);
}

// ---------------------------------------------------------------------------
// IN YOUR GAMES, from stakeForMatches (lib/gridiron/scoresV2.js)
// ---------------------------------------------------------------------------

/**
 * A game the reader has something riding on, from picks and lineups only: a
 * Pick'em pick, Weekly players, a Series Pick'em pick on its two clubs, or
 * October / The Run / Tonight's Six players in it. A follow alone is not a
 * stake here (the teams block shows those) and an alert alone is not one either.
 */
/** Which game put the reader in this one, in a fixed order. */
export const STAKE_KINDS = Object.freeze(['pickem', 'series', 'weekly', 'draft', 'october', 'run', 'six']);

/**
 * THE LINEUP STAKES (sun-23): October, The Run, Series Pick'em and Tonight's
 * Six, from the reader's own lineups on each game's CURRENT contest (the
 * readers the Play tab uses - currentOctoberDay, currentRunRound,
 * currentSeriesBoard, currentSixNight). PURE.
 *   october, six  a slot names its matchId
 *   run           a slot names its club (teamId): every slate game that club plays
 *   series        { series_key: teamId } over the board's two-team series: the
 *                 slate MLB games between exactly those two clubs, picked side
 * @param lineups { october, run, six: lineup|null, series: { board, lineup }|null, draft: liveEntryRows rows[] }
 * @returns Map(gameId -> { players: [{kind, name}], seriesPick: {side, abbr}|null })
 */
export function lineupStakes(games = [], lineups = {}) {
  const out = new Map();
  const at = (id) => { if (!out.has(id)) out.set(id, { players: [], seriesPick: null }); return out.get(id); };
  const slots = (l) => Object.values(l ?? {}).filter((v) => v && typeof v === 'object');
  const byId = new Map(games.map((g) => [Number(g.id), g]));
  for (const kind of ['october', 'six']) {
    for (const v of slots(lineups[kind])) {
      const g = byId.get(Number(v.matchId));
      if (g) at(g.id).players.push({ kind, name: v.name ?? null });
    }
  }
  // THE DRAFT (sun-24): the ranked roster's counting six, matched to NFL games
  // by club the way stakeForMatches matches the Weekly's.
  for (const d of Array.isArray(lineups.draft) ? lineups.draft : []) {
    for (const g of games) {
      if (g.leagueSlug === 'nfl' && d.team && (d.team === g.home?.abbreviation || d.team === g.away?.abbreviation)) {
        at(g.id).players.push({ kind: 'draft', name: d.name ?? null, points: Number(d.points) || 0 });
      }
    }
  }
  for (const v of slots(lineups.run)) {
    for (const g of games) {
      if (g.leagueSlug === 'mlb' && [g.home?.id, g.away?.id].map(Number).includes(Number(v.teamId))) at(g.id).players.push({ kind: 'run', name: v.name ?? null });
    }
  }
  const ser = lineups.series;
  for (const b of ser?.board ?? []) {
    const picked = ser?.lineup?.[b.series_key];
    if (picked == null) continue;
    const ids = (b.teams ?? []).map((x) => Number(x.team_id));
    for (const g of games) {
      if (g.leagueSlug !== 'mlb') continue;
      const pair = [Number(g.home?.id), Number(g.away?.id)];
      if (!ids.length || !pair.every((x) => ids.includes(x))) continue;
      const side = Number(g.home?.id) === Number(picked) ? 'home' : Number(g.away?.id) === Number(picked) ? 'away' : null;
      if (side) at(g.id).seriesPick = { side, abbr: (side === 'home' ? g.home : g.away)?.abbreviation ?? null };
    }
  }
  return out;
}

/** The best-scoring player's name, clipped; null when there is none. */
export function topPlayerOf(players = []) {
  let best = null;
  for (const p of players) if (p?.name && (best == null || (Number(p.points) || 0) > (Number(best.points) || 0))) best = p;
  return best ? clip(best.name, 24) : null;
}

export function stakeRow(g, stake, now, extra = null) {
  const sp = extra?.seriesPick ?? null;
  const pick = stake?.pick ?? (sp ? { side: sp.side, abbr: sp.abbr ?? badge(null, (sp.side === 'home' ? g.home : g.away)?.name) } : null);
  const weekly = stake?.weekly ?? [];
  const lineup = extra?.players ?? [];
  const players = [...weekly, ...lineup];
  const points = weekly.reduce((a, p) => a + (Number(p.points) || 0), 0);
  const kinds = new Set([
    ...(stake?.pick ? ['pickem'] : []), ...(sp ? ['series'] : []), ...(weekly.length ? ['weekly'] : []),
    ...lineup.map((p) => p.kind),
  ]);
  return {
    gameId: int(g.id),
    league: clip(g.leagueSlug, 8),
    away: badge(g.away?.abbreviation, g.away?.name),
    home: badge(g.home?.abbreviation, g.home?.name),
    awayColor: clip(g.away?.colors?.primary ?? null, 9),
    homeColor: clip(g.home?.colors?.primary ?? null, 9),
    awayScore: g.status === 'scheduled' ? null : int(g.awayScore),
    homeScore: g.status === 'scheduled' ? null : int(g.homeScore),
    status: gameStatus(g.status),
    clock: clockOf(g.status, g.liveState, g.leagueSlug),
    startAt: z(g.kickoffAt),
    pick: pick ? clip(pick.abbr, 6) : null,
    pickState: pick ? (pick.state ?? pickState({ side: pick.side, homeScore: g.homeScore, awayScore: g.awayScore, status: g.status })) : null,
    players: players.length,
    // Weekly points only: the other games score their own way on their own pages.
    points: weekly.length ? Math.round(points * 10) / 10 : null,
    via: STAKE_KINDS.filter((k) => kinds.has(k)),
    href: hrefOf(gameHref(g.leagueSlug, g.slug)),
    // OPTIONAL (sun-24): the reader's best-scoring Weekly or Draft player in
    // this game, by points so far (the first listed on a tie / before kickoff).
    ...optional({ topPlayer: topPlayerOf([...weekly, ...lineup.filter((p) => p.kind === 'draft')]) }),
  };
}

export function inYourGamesBlock(games = [], stakes = new Map(), now, lineups = {}) {
  const extra = lineupStakes(games, lineups);
  return games
    .map((g) => ({ g, s: stakes.get(g.id), x: extra.get(g.id) }))
    .filter(({ s, x }) => (s && (s.pick || (s.weekly ?? []).length)) || (x && (x.players.length || x.seriesPick)))
    .sort((a, b) => (a.g.status === 'live' ? 0 : 1) - (b.g.status === 'live' ? 0 : 1)
      || (ms(a.g.kickoffAt) ?? 0) - (ms(b.g.kickoffAt) ?? 0) || a.g.id - b.g.id)
    .slice(0, IN_YOUR_GAMES_MAX)
    .map(({ g, s, x }) => stakeRow(g, s, now, x));
}

// ---------------------------------------------------------------------------
// THE WHOLE FEED
// ---------------------------------------------------------------------------

/**
 * The signed-in feed from its inputs.
 * @param inputs { view, items, daily, streak, teamRows, stakeGames, stakes, lineups, phoneOn }
 */
export function serializeFeed(inputs = {}, now = new Date()) {
  const { view = null, items = [], daily = null, streak = 0, teamRows = [], stakeGames = [], stakes = new Map(), lineups = {}, phoneOn = false } = inputs;
  const { yourMove, games } = playBlocks(view, now);
  const next = nextOpening(items, now);
  return envelope(STATE_OK, now, {
    yourMove,
    // OPTIONAL (sun-25): { key, sport, name, title, opensAt, href }; the words
    // carry no time and no zone - the widget formats opensAt locally.
    ...optional({ nextOpening: next ? {
      key: clip(next.key, 32), sport: SPORT_LABEL[next.sport] ?? clip(String(next.sport ?? '').toUpperCase(), 12),
      name: clip(next.name), title: clip(next.title), opensAt: z(next.opensAt), href: hrefOf(next.href),
    } : null }),
    games,
    daily: dailyBlock(daily, streak, now),
    teams: teamsBlock(teamRows, { now, phoneOn }),
    inYourGames: inYourGamesBlock(stakeGames, stakes, now, lineups),
  });
}

/** The payload's size in bytes, as it goes over the wire. */
export const byteSize = (payload) => Buffer.byteLength(JSON.stringify(payload), 'utf8');

// ---------------------------------------------------------------------------
// THE TEAM PICKER (GET /api/widget/v1/teams)
// ---------------------------------------------------------------------------

export function pickerTeam(t) {
  return {
    id: int(t.id),
    abbr: badge(t.abbreviation, t.fullName ?? t.name),
    name: clip(t.name, 24),
    league: clip(t.leagueSlug, 8),
    color: clip(t.colors?.primary ?? t.color ?? null, 9),
    altColor: clip(t.colors?.secondary ?? t.altColor ?? null, 9),
  };
}

/** Followed teams first (newest follow first), then every other team by league and name. */
export function pickerFeed({ state = STATE_OK, followed = [], all = [], now = new Date() } = {}) {
  const mine = new Set(followed.map((t) => Number(t.id)));
  return {
    v: FEED_VERSION, state, generatedAt: z(now), cta: STATE_CTA[state] ?? null,
    followed: followed.map(pickerTeam),
    teams: all.filter((t) => !mine.has(Number(t.id))).map(pickerTeam),
  };
}
