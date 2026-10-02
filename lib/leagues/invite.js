// lib/leagues/invite.js - the league's door: the typed code, the link token,
// the cap, the start line, and the owner's reset. (Leagues V1, fri-1.)
//
// THE PATTERN IS lib/fantasy/leagueShare.js's: a refusal is a pure function of
// the row (joinRefusal, like inviteRefusal), the preview never writes, and a
// reset makes the old door simply not exist. What differs: a player league has
// ONE live code and ONE live token, kept on the league row itself - there is
// no invites table, so "revoked" is not a state, it is "no row matches".
//
// THE CAP IS A LOCK, NOT A PRE-CHECK. Two friends tapping the last spot at the
// same moment would both pass a count-then-insert. The join is one transaction:
// the league row is locked FOR UPDATE, then the insert re-counts under that
// lock (READ COMMITTED gives the second statement a fresh snapshot, so it sees
// the first joiner's commit) and inserts only below max_members, only through a
// door that still matches, and only before starts_at unless late joins are on.
// joinRefusal() runs first for the sentence; the insert's WHERE is the truth.
//
// NO JOIN BY LEAGUE ID. Ids are serial; every join here is keyed on a code or a
// token the owner handed out (lib/leagues/joinByCode.test.mjs walks the tree).

import crypto from 'node:crypto';
import { sql } from '../db.js';
import { CODE_ALPHABET, INVITE_TOKEN_LENGTH, REFUSALS, parseInviteKey } from './code.js';
import { gamesFromRows } from './settings.js';
import { makeJoinCode } from './core.js';

export function makeInviteToken(rng = crypto.randomInt) {
  let out = '';
  for (let i = 0; i < INVITE_TOKEN_LENGTH; i += 1) out += CODE_ALPHABET[rng(CODE_ALPHABET.length)];
  return out;
}

/**
 * Why this reader cannot join, as a REFUSALS key - or null when they can.
 * Order: no league, already in (never refused), full, started.
 * `lg` needs members, max_members, late_joins, starts_at.
 */
export function joinRefusal(lg, { now = new Date(), already = false } = {}) {
  if (!lg) return 'no_league';
  if (already) return null;
  if (Number(lg.members) >= Number(lg.max_members)) return 'full';
  if (!lg.late_joins && lg.starts_at != null && new Date(lg.starts_at) <= new Date(now)) return 'started';
  return null;
}

async function leagueByKey(key) {
  if (!key) return null;
  const [lg] = await sql`
    SELECT l.id, l.name, l.owner_id, l.span, l.scoring, l.format, l.drop_worst,
           l.max_members, l.late_joins, l.starts_at, l.start_week, l.start_date,
           u.handle AS owner_handle,
           (SELECT count(*)::int FROM league_members m WHERE m.league_id = l.id) AS members
      FROM player_leagues l LEFT JOIN users u ON u.id = l.owner_id
     WHERE (${key.kind} = 'code' AND l.join_code = ${key.value})
        OR (${key.kind} = 'token' AND l.invite_token = ${key.value})
     LIMIT 1`;
  if (!lg) return null;
  const rows = await sql`SELECT game_type, sport FROM player_league_games WHERE league_id = ${lg.id}`;
  return { ...lg, games: gamesFromRows(rows) };
}

async function isMember(leagueId, userId) {
  if (userId == null) return false;
  const [r] = await sql`SELECT 1 AS x FROM league_members WHERE league_id = ${leagueId} AND user_id = ${Number(userId)}`;
  return !!r;
}

/**
 * What a key-holder sees BEFORE joining. NO WRITE. The league is named even
 * when the answer is no - a full league should say which league is full.
 * Never returns the code, the token or the roster.
 * -> { ok, reason (REFUSALS key) | null, league | null, already }
 */
export async function invitePreview(rawKey, userId = null, { now = new Date() } = {}) {
  const key = parseInviteKey(rawKey);
  if (!key) return { ok: false, reason: 'not_a_code', league: null, already: false };
  const lg = await leagueByKey(key);
  if (!lg) return { ok: false, reason: key.kind === 'token' ? 'dead_link' : 'no_league', league: null, already: false };
  const already = await isMember(lg.id, userId);
  const reason = joinRefusal(lg, { now, already });
  return { ok: reason == null, reason, league: lg, already };
}

/**
 * Join through a code or a link token. -> { ok, leagueId, name, already } or
 * { ok: false, reason (a REFUSALS sentence), code (its key) }.
 */
export async function joinByInvite(userId, rawKey) {
  const fail = (k) => ({ ok: false, reason: REFUSALS[k] ?? REFUSALS.failed, code: k });
  const uid = userId == null ? NaN : Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) return fail('signed_out');
  const key = parseInviteKey(rawKey);
  if (!key) return fail('not_a_code');
  const lg = await leagueByKey(key);
  if (!lg) return fail(key.kind === 'token' ? 'dead_link' : 'no_league');
  if (await isMember(lg.id, uid)) return { ok: true, leagueId: lg.id, name: lg.name, already: true };
  const pre = joinRefusal(lg);
  if (pre) return fail(pre);

  const [, inserted] = await sql.transaction([
    sql`SELECT id FROM player_leagues WHERE id = ${lg.id} FOR UPDATE`,
    sql`
      INSERT INTO league_members (league_id, user_id)
      SELECT l.id, ${uid} FROM player_leagues l
       WHERE l.id = ${lg.id}
         AND ((${key.kind} = 'code' AND l.join_code = ${key.value})
           OR (${key.kind} = 'token' AND l.invite_token = ${key.value}))
         AND (SELECT count(*) FROM league_members m WHERE m.league_id = l.id) < l.max_members
         AND (l.late_joins OR l.starts_at IS NULL OR l.starts_at > now())
      ON CONFLICT DO NOTHING
      RETURNING user_id`,
  ], { isolationLevel: 'ReadCommitted' });
  if (inserted.length) return { ok: true, leagueId: lg.id, name: lg.name, already: false };

  // Lost a race or a door: say which, from the state as it is now.
  if (await isMember(lg.id, uid)) return { ok: true, leagueId: lg.id, name: lg.name, already: true };
  const now = await leagueByKey(key);
  if (!now) return fail(key.kind === 'token' ? 'dead_link' : 'no_league');
  return fail(joinRefusal(now) ?? 'failed');
}

/**
 * THE OWNER'S RESET: a new code AND a new token, in one UPDATE, so there is no
 * moment where one door is new and the other old. The old ones match nothing
 * from the instant it commits. Retries on the (vanishingly rare) collision.
 */
export async function resetInvite(userId, leagueId, { rngCode, rngToken } = {}) {
  const uid = Number(userId);
  const [lg] = await sql`SELECT owner_id FROM player_leagues WHERE id = ${Number(leagueId)}`;
  if (!lg) return { ok: false, reason: REFUSALS.no_league, code: 'no_league' };
  if (lg.owner_id == null || Number(lg.owner_id) !== uid) return { ok: false, reason: REFUSALS.not_owner, code: 'not_owner' };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const [row] = await sql`
        UPDATE player_leagues
           SET join_code = ${makeJoinCode(rngCode)}, invite_token = ${makeInviteToken(rngToken)},
               code_reset_at = now()
         WHERE id = ${Number(leagueId)} AND owner_id = ${uid}
        RETURNING join_code, invite_token, code_reset_at`;
      if (!row) return { ok: false, reason: REFUSALS.not_owner, code: 'not_owner' };
      return { ok: true, joinCode: row.join_code, inviteToken: row.invite_token, resetAt: row.code_reset_at };
    } catch (e) {
      const m = String(e?.message ?? '');
      if (!m.includes('player_leagues_join_code_key') && !m.includes('player_leagues_invite_token_key')) throw e;
    }
  }
  return { ok: false, reason: REFUSALS.failed, code: 'failed' };
}
