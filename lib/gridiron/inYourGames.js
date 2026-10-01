// lib/gridiron/inYourGames.js - "In your games" on the arcade game page
// (game-page-arcade, wed-8): what the signed-in reader has riding on THIS game
// across Pick'em, the Weekly and The Draft.
//
// ITS OWN READS, AND ONLY READS. This module does not call stakeForMatches
// (lib/gridiron/scoresV2.js) - that is the board's fan-out over a whole slate,
// and it reaches the Weekly through the live-board readers - and it never
// touches lib/draft/entry.js, whose draftState() can WRITE (it bridges a
// roster on read). Three SELECTs at most, all keyed:
//   1. the week's contests     contests (game_type, sport, season_year, week) - idx_contests_week
//   2. the reader's entries    contest_entries (user_id, contest_id = ANY)
//   3. the pick'em week's matches, for the record - only when there is a pick'em entry
// The player points are NOT a fourth read: they come from the stat rows the
// page already loaded (regTeamTables, with nfl_player_id), scored the way
// lib/weekly/settle.js scores them - fantasyPoints(toStatLine(r), 'ppr').
//
// GRIDIRON ONLY. CFB has Pick'em boards and nothing else; their week key is
// the ISO week of the ET Monday the game falls in (lib/pickem/create.js
// windowFor), not the provider's week number.

import { sql } from '../db.js';
import { fantasyPoints } from '../fantasy/scoring.js';
import { toStatLine } from '../fantasy/playerStats.js';
import { pickState } from './scoresV2Shape.js';

export const GAME_TYPES = Object.freeze(['pickem', 'weekly', 'draft']);

/** The ISO week of the Monday (ET) of the week an instant falls in. PURE. */
export function isoWeekOfEtMonday(iso) {
  if (!iso) return null;
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  const d = new Date(`${ymd}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon = 0
  d.setUTCDate(d.getUTCDate() - dow);   // the Monday
  // ISO week of that Monday: the week containing its Thursday.
  const thu = new Date(d); thu.setUTCDate(d.getUTCDate() + 3);
  const jan1 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
  return 1 + Math.floor((thu - jan1) / 86400000 / 7);
}

/**
 * THE CONTEST KEY for a game: { sport, season, week } or null. NFL boards key
 * on the REG week (a preseason "week 2" is not the Weekly's week 2); CFB on the
 * ISO week of its ET Monday. PURE.
 */
export function contestKeyFor(game) {
  if (!game?.seasonYear) return null;
  if (game.leagueSlug === 'nfl') {
    return game.seasonPhase === 'REG' && game.week != null ? { sport: 'nfl', season: game.seasonYear, week: Number(game.week) } : null;
  }
  if (game.leagueSlug === 'cfb') {
    const week = isoWeekOfEtMonday(game.kickoffAt);
    return week ? { sport: 'cfb', season: game.seasonYear, week } : null;
  }
  return null;
}

const round1 = (v) => Math.round(v * 10) / 10;
const lastName = (s) => String(s ?? '').trim().split(/\s+/).pop();
const ids = (v) => (Array.isArray(v) ? v : Object.values(v ?? {})).map((x) => (x && typeof x === 'object' ? x.id : x)).filter((x) => x != null).map(Number);

/** Points per nfl_player_id from this game's stat rows, ppr, as settle.js scores them. PURE. */
export function pointsByPlayer(statRows) {
  const out = new Map();
  for (const r of statRows ?? []) {
    if (r.nfl_player_id == null) continue;
    const id = Number(r.nfl_player_id);
    out.set(id, (out.get(id) ?? 0) + fantasyPoints(toStatLine(r), 'ppr'));
  }
  return out;
}

/**
 * THE ROWS, from what the three reads returned. PURE.
 * @param game       getGamePage's shape (status, scores, home/away, leagueSlug)
 * @param contests   [{ id, game_type, board }]
 * @param entries    [{ contest_id, lineup, meta }]
 * @param boardMatches [{ id, status, home_score, away_score }] - the pick'em week
 * @param statRows   this game's stat rows with nfl_player_id
 * @returns [{ kind, label, line, value, href }]
 */
export function yourGamesRows({ game, contests = [], entries = [], boardMatches = [], statRows = [] }) {
  const state = game.status === 'final' ? 'final' : game.status === 'live' ? 'live' : 'pre';
  const byContest = new Map(contests.map((c) => [c.id, c]));
  const playing = new Set((statRows ?? []).map((r) => Number(r.nfl_player_id)).filter(Number.isFinite));
  const teamAbbrs = new Set([game.home?.abbreviation, game.away?.abbreviation].filter(Boolean));
  const pts = pointsByPlayer(statRows);
  const rows = [];
  for (const kind of GAME_TYPES) {
    const c = contests.find((x) => x.game_type === kind);
    const e = c ? entries.find((x) => x.contest_id === c.id) : null;
    if (!c || !e) continue;
    if (kind === 'pickem') {
      const lineup = e.lineup ?? {};
      const side = lineup[game.id] ?? lineup[String(game.id)] ?? null;
      if (side !== 'home' && side !== 'away') continue;
      const abbr = (side === 'home' ? game.home : game.away)?.abbreviation ?? '';
      const st = pickState({ side, homeScore: game.homeScore, awayScore: game.awayScore, status: game.status });
      // THE WEEK'S RECORD: picks on finished games, and how many were right.
      let won = 0, decided = 0;
      for (const m of boardMatches) {
        const s = lineup[m.id] ?? lineup[String(m.id)];
        if (!s || m.status !== 'final') continue;
        decided += 1;
        if (pickState({ side: s, homeScore: m.home_score, awayScore: m.away_score, status: 'final' }) === 'won') won += 1;
      }
      const rec = decided ? `${won} of ${decided} this week` : null;
      const word = { won: 'Won', lost: 'Lost', push: 'Push', winning: 'Winning', losing: 'Losing', tied: 'Tied', pending: 'Pending' }[st] ?? '';
      rows.push({
        kind, label: "PICK'EM", line: `${state === 'final' ? 'You had' : 'You have'} ${abbr}`,
        value: [word, rec].filter(Boolean).join(' · '), href: `/pickem/${game.leagueSlug}`,
      });
      continue;
    }
    // WEEKLY: the six in the lineup. DRAFT: the drafted roster (meta.roster),
    // the lineup when a roster is not stored. Names from the contest's board -
    // the pool snapshot - so no player read is needed.
    const mine = kind === 'draft' && Array.isArray(e.meta?.roster) && e.meta.roster.length ? ids(e.meta.roster) : ids(e.lineup);
    const pool = new Map((Array.isArray(c.board) ? c.board : []).map((p) => [Number(p.id), p]));
    for (const r of Array.isArray(e.meta?.roster) ? e.meta.roster : []) if (r?.id != null && !pool.has(Number(r.id))) pool.set(Number(r.id), r);
    // IN THIS GAME: a stat row here, or a pool team that is one of the two
    // (before kickoff there are no stat rows; a man yet to touch the ball has none either).
    const here = mine.filter((id) => playing.has(id) || teamAbbrs.has(pool.get(id)?.team));
    if (!here.length) continue;
    const names = here.map((id) => lastName(pool.get(id)?.name) || `#${id}`).join(' · ');
    const total = round1(here.reduce((a, id) => a + (pts.get(id) ?? 0), 0));
    const value = state === 'pre' ? `${here.length} player${here.length === 1 ? '' : 's'}`
      : state === 'live' ? `${total} pts live` : `${total} pts from this game`;
    rows.push({
      kind, label: kind === 'weekly' ? 'WEEKLY' : 'THE DRAFT',
      line: `${names} ${kind === 'weekly' ? 'in your six' : 'on your roster'}`,
      value, href: kind === 'weekly' ? '/weekly' : '/draft',
    });
  }
  return rows;
}

/**
 * THE READ: at most three queries (see the header). `db` is injectable so the
 * count is testable against a stub. Returns the rows for yourGamesRows().
 */
export async function inYourGames({ userId, game, statRows = [], db = sql }) {
  const uid = userId == null ? null : Number(userId);
  const key = contestKeyFor(game);
  if (uid == null || !Number.isFinite(uid) || !key) return [];
  const contests = await db`
    SELECT id, game_type, board FROM contests
     WHERE game_type = ANY(${GAME_TYPES}) AND sport = ${key.sport}
       AND season_year = ${key.season} AND week = ${key.week} AND puzzle_date IS NULL`;
  if (!contests.length) return [];
  const entries = await db`
    SELECT contest_id, lineup, meta FROM contest_entries
     WHERE user_id = ${uid} AND contest_id = ANY(${contests.map((c) => c.id)})`;
  if (!entries.length) return [];
  const pick = contests.find((c) => c.game_type === 'pickem' && entries.some((e) => e.contest_id === c.id));
  const boardIds = pick && Array.isArray(pick.board) ? pick.board.map((b) => Number(b.match_id)).filter(Number.isFinite) : [];
  const boardMatches = boardIds.length
    ? await db`SELECT id, status, home_score, away_score FROM matches WHERE id = ANY(${boardIds})`
    : [];
  return yourGamesRows({ game, contests, entries, boardMatches, statRows });
}
