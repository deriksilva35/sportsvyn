// lib/leagues/core.js - player leagues: codes, membership, scoped boards.
//
// NAMING LANDMINE (restated from migration 073): `leagues` is the SPORTS
// table. Everything here is player_leagues / league_members.

import crypto from 'node:crypto';
import { sql } from '../db.js';

// ---------------------------------------------------------------------------
// JOIN CODES
// ---------------------------------------------------------------------------
// SIX CHARS from an unambiguous alphabet: no 0/O, no 1/I/L - a code lives in
// a group chat and gets read aloud off a phone screen; every dropped
// lookalike is a support thread that never happens. 28^6 ≈ 481M codes against
// dozens of leagues: collisions are theoretical, but the INSERT still retries
// on the UNIQUE violation rather than trusting arithmetic - the same posture
// as every other uniqueness in this codebase.
// THE ALPHABET LIVES IN lib/fantasy/inviteCode.js (pure, client-safe) so the
// lobby's code field can read it without pulling this module's DB import.
// THE CODE'S OWN MODULE IS lib/leagues/code.js - pure and client-safe, so the
// join sheet and this file cannot disagree about the length or the refusal.
// Re-exported here because every existing importer reads them from core.
export { CODE_ALPHABET, CODE_LENGTH, REFUSALS, joinHref, normalizeLeagueCode, cleanLeagueInput } from './code.js';
import { CODE_ALPHABET, CODE_LENGTH } from './code.js';
import { validateLeagueSettings, chooseStart, gameRows, gamesFromRows, MEMBERS_DEFAULT } from './settings.js';
import { loadStartAnchors } from './start.js';
import { joinByInvite, makeInviteToken } from './invite.js';

export function makeJoinCode(rng = crypto.randomInt) {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) out += CODE_ALPHABET[rng(CODE_ALPHABET.length)];
  return out;
}

// ---------------------------------------------------------------------------
// LEAGUES
// ---------------------------------------------------------------------------

export { validateLeagueName } from './name.js';
import { validateLeagueName } from './name.js';

/**
 * THE SETTINGS A LEAGUE GETS WHEN NONE ARE GIVEN - the pre-V1 league, exactly
 * what migration 122 made the existing ones (ruling d): The Daily, total
 * points, a season table, open to late joins. The V1 create flow always passes
 * its own; this is for callers that only ever had a name.
 */
export const LEGACY_SETTINGS = Object.freeze({
  games: ['daily'], span: 'season', scoring: 'total', format: 'table',
  dropWorst: false, maxMembers: MEMBERS_DEFAULT, lateJoins: true,
});

/**
 * Create a league; the creator is member #1. ONE STATEMENT writes the league,
 * the owner's membership and the games (a CTE), so a league can never exist
 * without its games or its owner. Retries the code AND the token on a UNIQUE
 * collision, and only on that.
 * `anchors` (lib/leagues/start.js) may be passed; otherwise they are loaded.
 */
export async function createLeague(userId, rawName, rawSettings = null, { anchors = null, survivor } = {}) {
  const v = validateLeagueName(rawName);
  if (!v.ok) return { ok: false, reason: v.reason };
  const sv = validateLeagueSettings(rawSettings ?? LEGACY_SETTINGS, survivor === undefined ? {} : { survivor });
  if (!sv.ok) return { ok: false, reason: sv.reason };
  const st = sv.settings;
  const start = chooseStart(st.games, anchors ?? await loadStartAnchors());
  const rows = gameRows(st.games);
  const types = rows.map((r) => r.game_type);
  const sports = rows.map((r) => r.sport);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = makeJoinCode();
    const token = makeInviteToken();
    try {
      const [row] = await sql`
        WITH lg AS (
          INSERT INTO player_leagues (name, owner_id, join_code, invite_token, span, scoring, drop_worst,
                                      format, max_members, late_joins, starts_at, start_season, start_week, start_date)
          VALUES (${v.name}, ${userId}, ${code}, ${token}, ${st.span}, ${st.scoring}, ${st.dropWorst},
                  ${st.format}, ${st.maxMembers}, ${st.lateJoins}, ${start.startsAt}, ${start.startSeason},
                  ${start.startWeek}, ${start.startDate})
          RETURNING id, join_code, invite_token),
        owner AS (
          INSERT INTO league_members (league_id, user_id) SELECT id, ${userId} FROM lg
          ON CONFLICT DO NOTHING),
        games AS (
          INSERT INTO player_league_games (league_id, game_type, sport)
          SELECT lg.id, g.game_type, g.sport FROM lg, unnest(${types}::text[], ${sports}::text[]) AS g(game_type, sport))
        SELECT id, join_code, invite_token FROM lg`;
      return { ok: true, leagueId: row.id, joinCode: row.join_code, inviteToken: row.invite_token };
    } catch (e) {
      // UNIQUE violation on join_code / invite_token: mint another. Anything else is real.
      const m = String(e?.message ?? '');
      if (!m.includes('player_leagues_join_code_key') && !m.includes('player_leagues_invite_token_key')) throw e;
    }
  }
  return { ok: false, reason: 'Could not mint a code - try again' };
}

/**
 * Join by the typed code (or a link token) - lib/leagues/invite.js does the
 * work: the cap, the start line, the door that must still match. Kept under
 * this name because every existing caller joins through core.
 */
export async function joinLeague(userId, rawCode) {
  return joinByInvite(userId, rawCode);
}

async function gamesFor(ids) {
  if (!ids.length) return new Map();
  const rows = await sql`SELECT league_id, game_type, sport FROM player_league_games WHERE league_id = ANY(${ids})`;
  const by = new Map(ids.map((id) => [id, []]));
  for (const r of rows) by.get(r.league_id)?.push(r);
  return new Map([...by].map(([id, rs]) => [id, gamesFromRows(rs)]));
}

/** The reader's leagues, with member counts, settings and games - the /leagues index. */
export async function myLeagues(userId) {
  const rows = await sql`
    SELECT l.id, l.name, l.join_code, l.owner_id = ${userId} AS mine,
           l.span, l.scoring, l.format, l.max_members, l.late_joins, l.starts_at, l.start_week, l.start_date,
           (SELECT count(*)::int FROM league_members m2 WHERE m2.league_id = l.id) AS members
      FROM player_leagues l
      JOIN league_members m ON m.league_id = l.id AND m.user_id = ${userId}
     ORDER BY l.created_at`;
  const games = await gamesFor(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, games: games.get(r.id) ?? [] }));
}

/** One league + its member list (handles only - the roster of people). */
export async function leagueDetail(leagueId, userId) {
  const [lg] = await sql`
    SELECT l.id, l.name, l.join_code, l.invite_token, l.owner_id, l.span, l.scoring, l.format,
           l.drop_worst, l.max_members, l.late_joins, l.starts_at, l.start_week, l.start_date
      FROM player_leagues l
      JOIN league_members m ON m.league_id = l.id AND m.user_id = ${userId}
     WHERE l.id = ${leagueId}`;
  if (!lg) return null;   // not a member = not a league you can see
  lg.games = (await gamesFor([lg.id])).get(lg.id) ?? [];
  const members = await sql`
    SELECT m.user_id, u.handle, m.joined_at
      FROM league_members m JOIN users u ON u.id = m.user_id
     WHERE m.league_id = ${leagueId} ORDER BY m.joined_at`;
  return { ...lg, members };
}

/** Member ids for board scoping - the one hand the leaderboards need. */
export async function leagueMemberIds(leagueId) {
  const rows = await sql`SELECT user_id FROM league_members WHERE league_id = ${leagueId}`;
  return rows.map((r) => r.user_id);
}

/**
 * The NON-MEMBER's view of a league by id: name + member count, nothing
 * else - the code-holder preview pin, extended to the /leagues/[id] route.
 *
 * FLAGGED TRADE, made by ruling (mock frame 3): league ids are serial, so
 * this preview is reachable by walking ids, which the six-char code gate was
 * not. Name + count is what leaks; boards and identities stay sealed.
 *
 * JOINING IS BY CODE ONLY. There was a joinLeagueById() beside this read -
 * the preview's one-tap JOIN - and it made the id walk a way IN, not just a
 * way to read a name: any signed-in reader could join any league by counting.
 * It is gone; the preview asks for the code (pinned by lib/leagues/core.test).
 */
export async function leaguePreview(leagueId) {
  const [lg] = await sql`
    SELECT l.id, l.name,
           (SELECT count(*)::int FROM league_members m WHERE m.league_id = l.id) AS members
      FROM player_leagues l WHERE l.id = ${leagueId}`;
  if (!lg) return null;
  return { ...lg, games: (await gamesFor([lg.id])).get(lg.id) ?? [] };
}
