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
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'.replace(/[0OIL1]/g, '');
export const CODE_LENGTH = 6;

export function makeJoinCode(rng = crypto.randomInt) {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) out += CODE_ALPHABET[rng(CODE_ALPHABET.length)];
  return out;
}

// ---------------------------------------------------------------------------
// LEAGUES
// ---------------------------------------------------------------------------

export function validateLeagueName(raw) {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 3) return { ok: false, reason: 'Three characters at least' };
  if (name.length > 40) return { ok: false, reason: 'Forty characters at most' };
  return { ok: true, name };
}

/** Create a league; the creator is member #1. Retries the code on collision. */
export async function createLeague(userId, rawName) {
  const v = validateLeagueName(rawName);
  if (!v.ok) return { ok: false, reason: v.reason };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = makeJoinCode();
    try {
      const [row] = await sql`
        INSERT INTO player_leagues (name, owner_id, join_code)
        VALUES (${v.name}, ${userId}, ${code}) RETURNING id, join_code`;
      await sql`
        INSERT INTO league_members (league_id, user_id) VALUES (${row.id}, ${userId})
        ON CONFLICT DO NOTHING`;
      return { ok: true, leagueId: row.id, joinCode: row.join_code };
    } catch (e) {
      // UNIQUE violation on join_code: mint another. Anything else is real.
      if (!String(e?.message ?? '').includes('player_leagues_join_code_key')) throw e;
    }
  }
  return { ok: false, reason: 'Could not mint a code - try again' };
}

export async function joinLeague(userId, rawCode) {
  const code = String(rawCode ?? '').toUpperCase().replace(/\s+/g, '');
  if (code.length !== CODE_LENGTH) return { ok: false, reason: 'Codes are six characters' };
  const [lg] = await sql`SELECT id, name FROM player_leagues WHERE join_code = ${code}`;
  if (!lg) return { ok: false, reason: 'No league with that code' };
  await sql`
    INSERT INTO league_members (league_id, user_id) VALUES (${lg.id}, ${userId})
    ON CONFLICT DO NOTHING`;
  return { ok: true, leagueId: lg.id, name: lg.name };
}

/** The reader's leagues, with member counts - the /leagues index. */
export async function myLeagues(userId) {
  return sql`
    SELECT l.id, l.name, l.join_code, l.owner_id = ${userId} AS mine,
           (SELECT count(*)::int FROM league_members m2 WHERE m2.league_id = l.id) AS members
      FROM player_leagues l
      JOIN league_members m ON m.league_id = l.id AND m.user_id = ${userId}
     ORDER BY l.created_at`;
}

/** One league + its member list (handles only - the roster of people). */
export async function leagueDetail(leagueId, userId) {
  const [lg] = await sql`
    SELECT l.id, l.name, l.join_code, l.owner_id
      FROM player_leagues l
      JOIN league_members m ON m.league_id = l.id AND m.user_id = ${userId}
     WHERE l.id = ${leagueId}`;
  if (!lg) return null;   // not a member = not a league you can see
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
 * What a CODE-HOLDER may see before joining: name + member count. The code
 * is the invitation, so holding it earns the preview - but only the preview.
 * No member list, no board, no ids beyond the league's own.
 */
export async function leagueByCode(rawCode) {
  const code = String(rawCode ?? '').toUpperCase().replace(/\s+/g, '');
  if (code.length !== CODE_LENGTH) return null;
  const [lg] = await sql`
    SELECT l.id, l.name, l.join_code,
           (SELECT count(*)::int FROM league_members m WHERE m.league_id = l.id) AS members
      FROM player_leagues l WHERE l.join_code = ${code}`;
  return lg ?? null;
}
