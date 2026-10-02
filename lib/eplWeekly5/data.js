// lib/eplWeekly5/data.js - the reads EPL Weekly 5 makes: the gameweek's
// fixtures as they stand NOW, every picked player's line, and the pool.
//
// A LINE COMES FROM ONE OF TWO PLACES and the scorer cannot tell them apart:
//   player_match_stats   written at full time (and re-written at +24h) - the
//                        settle reads only this;
//   epl_live_lines       the live poller's in-play lines (migration 121),
//                        used for a fixture in play, or final but not yet
//                        imported. Same column names, same scorer.

import { sql } from '../db.js';
import { lineFromRow, scoreLine, pointsPerGame, posOf } from './scoring.js';

const LINE_COLS = ['minutes_played', 'goals', 'assists', 'saves', 'yellow_cards', 'red_cards',
  'own_goals', 'penalties_saved', 'penalties_missed', 'conceded_on_pitch'];

/** HTML entities the provider leaves in names ("N. O&apos;Reilly"). PURE. */
export function cleanName(s) {
  return String(s ?? '')
    .replace(/&apos;|&#0?39;/g, '’').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

/** The board's fixtures as they are NOW: status, kickoff, score, minute. */
export async function fixturesNow(board = []) {
  const ids = (board ?? []).map((g) => g.match_id);
  if (!ids.length) return new Map();
  const rows = await sql`
    SELECT id, status, kickoff_at, home_score, away_score, home_team_id, away_team_id,
           metadata->'live_state' AS live_state
      FROM matches WHERE id = ANY(${ids})`;
  return new Map(rows.map((r) => [String(r.id), r]));
}

/** Goals a club conceded in a fixture (the clean-sheet fallback). PURE. */
export function teamConceded(match, teamId) {
  if (!match || teamId == null) return null;
  if (String(match.home_team_id) === String(teamId)) return match.away_score ?? null;
  if (String(match.away_team_id) === String(teamId)) return match.home_score ?? null;
  return null;
}

/**
 * Lines for (match, player) pairs. Returns Map(`${matchId}:${playerId}` ->
 * { row, source: 'stats' | 'live' }).
 */
export async function linesFor(pairs = []) {
  const matchIds = [...new Set(pairs.map((p) => Number(p.matchId)).filter(Number.isFinite))];
  const playerIds = [...new Set(pairs.map((p) => Number(p.playerId)).filter(Number.isFinite))];
  const out = new Map();
  if (!matchIds.length || !playerIds.length) return out;
  const [stats, live, ext] = await Promise.all([
    sql`SELECT match_id, player_id, minutes_played, goals, assists, saves, yellow_cards, red_cards,
               own_goals, penalties_saved, penalties_missed, conceded_on_pitch
          FROM player_match_stats WHERE match_id = ANY(${matchIds}) AND player_id = ANY(${playerIds})`.catch(() => []),
    sql`SELECT match_id, lines FROM epl_live_lines WHERE match_id = ANY(${matchIds})`.catch(() => []),
    sql`SELECT id, external_ids->>'api_sports' AS ap FROM players WHERE id = ANY(${playerIds})`,
  ]);
  for (const r of stats) out.set(`${r.match_id}:${r.player_id}`, { row: r, source: 'stats' });
  const apOf = new Map(ext.map((r) => [String(r.id), r.ap]));
  const liveBy = new Map(live.map((r) => [String(r.match_id), r.lines ?? {}]));
  for (const p of pairs) {
    const k = `${p.matchId}:${p.playerId}`;
    if (out.has(k)) continue;
    const ap = apOf.get(String(p.playerId));
    const row = ap ? liveBy.get(String(p.matchId))?.[ap] : null;
    if (row) out.set(k, { row, source: 'live' });
  }
  return out;
}

/**
 * One pick's state and points. PURE.
 *
 * @returns { state: 'empty'|'pending'|'live'|'final'|'off', points, parts }
 *   pending  not kicked off (or kicked off with no line yet)
 *   off      postponed/cancelled: scores 0, the slot can be swapped
 */
export function scorePick(pick, match, line) {
  if (!pick?.playerId) return { state: 'empty', points: null, parts: [] };
  const status = match?.status ?? 'scheduled';
  if (['postponed', 'cancelled', 'not_needed'].includes(status)) return { state: 'off', points: 0, parts: [] };
  const final = status === 'final';
  if (!line) return { state: final ? 'final' : status === 'live' ? 'live' : 'pending', points: final ? 0 : status === 'live' ? 0 : null, parts: [] };
  const l = lineFromRow(line.row, { position: pick.pos, teamConceded: teamConceded(match, pick.clubId) });
  const s = scoreLine(l, { final });
  return { state: final ? 'final' : 'live', points: s.points, parts: s.parts, provisional: line.source === 'live' };
}

/**
 * The pool: every squad player of the gameweek's clubs that the feed gives a
 * position, with this season's points per game under OUR scorer, the fixture
 * (opponent, kickoff) and any availability flag.
 */
export async function poolFor(contest) {
  const board = contest?.board ?? [];
  if (!board.length) return [];
  const clubFixture = new Map();
  for (const g of board) {
    for (const [side, other, at] of [['home', 'away', 'vs'], ['away', 'home', '@']]) {
      const id = g[side]?.id;
      if (id == null || clubFixture.has(String(id))) continue;
      clubFixture.set(String(id), { matchId: g.match_id, club: g[side].abbr, opp: `${at} ${g[other]?.abbr ?? ''}`.trim(), kickoffAt: g.kickoff_at });
    }
  }
  const clubIds = [...clubFixture.keys()].map(Number);
  const [players, flags] = await Promise.all([
    sql`SELECT id, COALESCE(known_as, full_name) AS name, position, current_team_id, external_ids->>'api_sports' AS ap
          FROM players
         WHERE current_team_id = ANY(${clubIds}) AND position IS NOT NULL`,
    sql`SELECT match_id, player_api_id, kind, reason FROM epl_player_availability
         WHERE match_id = ANY(${board.map((g) => g.match_id)})`.catch(() => []),
  ]);
  const ids = players.map((p) => p.id);
  const hist = ids.length ? await sql`
    SELECT s.player_id, s.team_id, s.minutes_played, s.goals, s.assists, s.saves, s.yellow_cards, s.red_cards,
           s.own_goals, s.penalties_saved, s.penalties_missed, s.conceded_on_pitch,
           m.home_team_id, m.away_team_id, m.home_score, m.away_score
      FROM player_match_stats s
      JOIN matches m ON m.id = s.match_id
      JOIN leagues l ON l.id = m.league_id AND l.slug = 'epl'
     WHERE m.season_year = ${contest.season_year} AND m.status = 'final'
       AND s.player_id = ANY(${ids}) AND s.minutes_played > 0` : [];
  const histBy = new Map();
  for (const h of hist) {
    if (!histBy.has(h.player_id)) histBy.set(h.player_id, []);
    histBy.get(h.player_id).push(h);
  }
  const flagBy = new Map(flags.map((f) => [`${f.match_id}:${f.player_api_id}`, f]));
  const rows = [];
  for (const p of players) {
    const pos = posOf(p.position);
    const fx = clubFixture.get(String(p.current_team_id));
    if (!pos || !fx) continue;
    const lines = (histBy.get(p.id) ?? []).map((h) => lineFromRow(h, { position: pos, teamConceded: teamConceded(h, h.team_id) }));
    const { ppg, games } = pointsPerGame(lines);
    const flag = p.ap ? flagBy.get(`${fx.matchId}:${p.ap}`) : null;
    rows.push({
      playerId: String(p.id), name: cleanName(p.name), pos, clubId: Number(p.current_team_id),
      club: fx.club, matchId: Number(fx.matchId), opp: fx.opp, kickoffAt: fx.kickoffAt,
      ppg, games,
      flag: flag ? flagWord(flag) : null,
    });
  }
  return sortPool(rows);
}

/**
 * THE POOL'S ORDER (ruling thu-42): points per game, but a player with fewer
 * than MIN_GP appearances sorts AFTER every player with MIN_GP or more - one
 * 13-point cameo does not head the list. PURE.
 */
export const MIN_GP = 3;
export function sortPool(rows = []) {
  return [...rows].sort((a, b) => (Number(b.games >= MIN_GP) - Number(a.games >= MIN_GP))
    || (b.ppg ?? -99) - (a.ppg ?? -99) || b.games - a.games || a.name.localeCompare(b.name));
}

/**
 * The feed's availability -> one short word. PURE. API-Sports says type
 * 'Missing Fixture' (out) or 'Questionable' (doubt), and a reason; a reason
 * naming a suspension or a card is a suspension.
 */
export function flagWord(f) {
  const reason = String(f?.reason ?? '');
  const suspended = /suspend|red card|yellow card/i.test(reason);
  const doubt = /questionable|doubt/i.test(String(f?.kind ?? ''));
  return {
    kind: suspended ? 'suspended' : doubt ? 'doubt' : 'injured',
    label: suspended ? 'SUSP' : doubt ? 'DOUBT' : 'INJ',
    reason: reason || null,
  };
}

export { LINE_COLS };
