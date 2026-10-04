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

import { isActionable, phaseOf, SPORT_LABEL } from '../games/playLobby.js';
import { shortOf, finalShortOf, sportOf, hasClock } from '../live/vocabulary.js';
import { pickState } from '../gridiron/scoresV2Shape.js';
import { winProbDisplayed } from '../winprob/display.js';

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

/** A link, whole or not at all: a clipped path is a broken one. */
export const HREF_MAX = 64;
export const hrefOf = (h) => (typeof h === 'string' && h.startsWith('/') && h.length <= HREF_MAX ? h : null);

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
 * YOUR MOVE and the GAMES list from playLobby()'s view.
 *   yourMove  every item the reader can act on (the lobby's own yourMove,
 *             The Daily included), the count and the soonest lock
 *   games     the move items first in lock order, then the rest of the
 *             reader's open or in-play games in the lobby's group order;
 *             never The Daily (it has its own block), never a settled or
 *             not-yet-open game. At most GAMES_MAX.
 */
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
 * switch is on (WINPROB_PHONE, the same switch the Live Activity obeys -
 * lib/push/liveActivityState.js); and the stored number is a whole 0..100
 * stamped inside WINPROB_DEAD_MS. live_state.win_prob is the HOME side's.
 */
export function winProbFor({ status, liveState, leagueSlug, home, phoneOn, now }) {
  if (status !== 'live' || !phoneOn || !winProbDisplayed(leagueSlug)) return null;
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
export function teamRow(r, { now, phoneOn = false } = {}) {
  const home = r.gameId != null && Number(r.homeTeamId) === Number(r.teamId);
  const status = r.gameId == null ? 'none' : gameStatus(r.status);
  const score = status === 'pre' || status === 'none' ? null : int(home ? r.homeScore : r.awayScore);
  const oppScore = status === 'pre' || status === 'none' ? null : int(home ? r.awayScore : r.homeScore);
  let result = null;
  if (status === 'final' && score != null && oppScore != null) result = score > oppScore ? 'W' : score < oppScore ? 'L' : 'T';
  return {
    teamId: int(r.teamId),
    team: clip(r.teamAbbr ?? r.teamName, 6),
    teamName: clip(r.teamName, 24),
    league: clip(r.leagueSlug, 8),
    color: clip(r.color, 9),
    altColor: clip(r.altColor, 9),
    gameId: int(r.gameId),
    home: r.gameId == null ? null : home,
    oppId: int(r.oppId),
    opp: clip(r.oppAbbr ?? r.oppName, 6),
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
 * A game the reader has something riding on: a Pick'em pick or Weekly players
 * in it. A follow alone is not a stake here (the teams block shows those) and
 * an alert alone is not one either.
 */
export function stakeRow(g, stake, now) {
  const pick = stake?.pick ?? null;
  const players = stake?.weekly ?? [];
  const points = players.reduce((a, p) => a + (Number(p.points) || 0), 0);
  return {
    gameId: int(g.id),
    league: clip(g.leagueSlug, 8),
    away: clip(g.away?.abbreviation ?? g.away?.name, 6),
    home: clip(g.home?.abbreviation ?? g.home?.name, 6),
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
    points: players.length ? Math.round(points * 10) / 10 : null,
    href: hrefOf(gameHref(g.leagueSlug, g.slug)),
  };
}

export function inYourGamesBlock(games = [], stakes = new Map(), now) {
  return games
    .map((g) => ({ g, s: stakes.get(g.id) }))
    .filter(({ s }) => s && (s.pick || (s.weekly ?? []).length))
    .sort((a, b) => (a.g.status === 'live' ? 0 : 1) - (b.g.status === 'live' ? 0 : 1)
      || (ms(a.g.kickoffAt) ?? 0) - (ms(b.g.kickoffAt) ?? 0) || a.g.id - b.g.id)
    .slice(0, IN_YOUR_GAMES_MAX)
    .map(({ g, s }) => stakeRow(g, s, now));
}

// ---------------------------------------------------------------------------
// THE WHOLE FEED
// ---------------------------------------------------------------------------

/**
 * The signed-in feed from its inputs.
 * @param inputs { view, daily, streak, teamRows, stakeGames, stakes, phoneOn }
 */
export function serializeFeed(inputs = {}, now = new Date()) {
  const { view = null, daily = null, streak = 0, teamRows = [], stakeGames = [], stakes = new Map(), phoneOn = false } = inputs;
  const { yourMove, games } = playBlocks(view, now);
  return envelope(STATE_OK, now, {
    yourMove,
    games,
    daily: dailyBlock(daily, streak, now),
    teams: teamsBlock(teamRows, { now, phoneOn }),
    inYourGames: inYourGamesBlock(stakeGames, stakes, now),
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
    abbr: clip(t.abbreviation ?? t.name, 6),
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
