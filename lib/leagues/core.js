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
import { planFormatChange, formatLocked, PICK_FORMAT_REFUSALS } from './pickFormat.js';
import { applyPendingPickFormat } from './rollover.js';
import { tuesdayOf } from './results.js';
import { etDateOf } from './start.js';
import { easternLocalToUtc } from '../gridiron/ingest.js';

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
  dropWorst: false, maxMembers: MEMBERS_DEFAULT, lateJoins: true, pickFormat: 'regular',
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
                                      format, max_members, late_joins, starts_at, start_season, start_week, start_date,
                                      pick_format)
          VALUES (${v.name}, ${userId}, ${code}, ${token}, ${st.span}, ${st.scoring}, ${st.dropWorst},
                  ${st.format}, ${st.maxMembers}, ${st.lateJoins}, ${start.startsAt}, ${start.startSeason},
                  ${start.startWeek}, ${start.startDate}, ${st.pickFormat})
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
           l.pick_format,
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
           l.drop_worst, l.max_members, l.late_joins, l.starts_at, l.start_week, l.start_date,
           l.pick_format, l.pick_format_prev, l.pick_format_from, l.pick_format_switch_open, l.pick_format_pending
      FROM player_leagues l
      JOIN league_members m ON m.league_id = l.id AND m.user_id = ${userId}
     WHERE l.id = ${leagueId}`;
  if (!lg) return null;   // not a member = not a league you can see
  lg.games = (await gamesFor([lg.id])).get(lg.id) ?? [];
  // A queued format change takes effect when the league's next season's boards first resolve.
  if (lg.pick_format_pending) Object.assign(lg, await applyPendingPickFormat(lg));
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

/*
 * NO NON-MEMBER READ BY ID (ruling sun-12 item 8). There was a leaguePreview()
 * here - name, member count and games for any id - behind the /leagues/[id]
 * sealed preview. Ids are serial, so it handed every league's name to anyone
 * counting. It is gone: a non-member gets a 404 (app/leagues/[id]/not-found.js),
 * and the only non-member read is by INVITE (lib/leagues/invite.js
 * invitePreview), because holding the code or link is the invitation.
 */

// ---------------------------------------------------------------------------
// HOW PICK'EM SCORES - the commissioner's change (S2, lib/leagues/pickFormat.js)
// ---------------------------------------------------------------------------

/**
 * The instant the first week NOT yet under way begins: this Tuesday 00:00 ET,
 * or next Tuesday's once one of the league's Pick'em boards of this week has
 * locked. A one-time switch never reaches into a week already being played.
 */
export async function firstOpenWeekStart(leagueId, now = new Date()) {
  const thisTue = tuesdayOf(etDateOf(now));
  const weekStart = await easternLocalToUtc(`${thisTue} 00:00:00`);
  const pairs = (await sql`SELECT game_type, sport FROM player_league_games WHERE league_id = ${leagueId} AND game_type = 'pickem'`)
    .map((g) => `${g.game_type}:${g.sport}`);
  const at = new Date(now).toISOString();
  const [locked] = pairs.length ? await sql`
    SELECT 1 AS x FROM contests c
     WHERE (c.game_type || ':' || c.sport) = ANY(${pairs})
       AND c.locks_at >= ${weekStart}::timestamptz AND c.locks_at <= ${at}::timestamptz
     LIMIT 1` : [];
  if (!locked) return weekStart;
  const [y, m, d] = thisTue.split('-').map(Number);
  const nextTue = new Date(Date.UTC(y, m - 1, d) + 7 * 86_400_000).toISOString().slice(0, 10);
  return easternLocalToUtc(`${nextTue} 00:00:00`);
}

/**
 * Change a league's Pick'em format. Before the first week locks it is a plain
 * change; after, only a pre-S2 league's ONE-TIME switch, effective from the
 * 20 Oct 2026 week at the earliest. The UPDATE re-checks every condition, so
 * two taps cannot spend the switch twice.
 */
export async function setLeaguePickFormat(userId, leagueId, rawNext, { now = new Date() } = {}) {
  const [lg] = await sql`
    SELECT id, owner_id, starts_at, pick_format, pick_format_switch_open, pick_format_pending FROM player_leagues WHERE id = ${leagueId}`;
  if (!lg) return { ok: false, reason: 'No such league' };
  lg.games = (await gamesFor([lg.id])).get(lg.id) ?? [];
  const next = String(rawNext ?? '').trim().toLowerCase();
  const isOwner = lg.owner_id != null && Number(lg.owner_id) === Number(userId);
  const weekStartsAt = isOwner && formatLocked(lg, now) ? await firstOpenWeekStart(lg.id, now) : null;
  const plan = planFormatChange(lg, next, { now, isOwner, weekStartsAt });
  if (!plan.ok) return plan;
  const at = new Date(now).toISOString();
  const rows = plan.kind === 'set'
    ? await sql`
        UPDATE player_leagues SET pick_format = ${next}, pick_format_prev = NULL, pick_format_from = NULL,
               pick_format_pending = NULL
         WHERE id = ${lg.id} AND owner_id = ${userId}
           AND (starts_at IS NULL OR starts_at > ${at}::timestamptz)
        RETURNING id`
    : plan.kind === 'queue'
    ? await sql`
        UPDATE player_leagues SET pick_format_pending = ${next}
         WHERE id = ${lg.id} AND owner_id = ${userId} AND pick_format <> ${next}
        RETURNING id`
    : plan.kind === 'clear'
    ? await sql`
        UPDATE player_leagues SET pick_format_pending = NULL
         WHERE id = ${lg.id} AND owner_id = ${userId} AND pick_format = ${next}
        RETURNING id`
    : await sql`
        UPDATE player_leagues
           SET pick_format_prev = pick_format, pick_format = ${next},
               pick_format_from = ${plan.from}::timestamptz, pick_format_switch_open = false,
               pick_format_pending = NULL
         WHERE id = ${lg.id} AND owner_id = ${userId} AND pick_format_switch_open AND pick_format <> ${next}
        RETURNING id`;
  if (!rows.length) return { ok: false, reason: 'The format changed under you - reload and try again' };
  return { ok: true, kind: plan.kind, from: plan.from, pickFormat: next };
}

/** Undo a queued format change (the league page's Undo). Owner only. */
export async function undoPendingPickFormat(userId, leagueId) {
  const [lg] = await sql`SELECT id, owner_id FROM player_leagues WHERE id = ${leagueId}`;
  if (!lg) return { ok: false, reason: 'No such league' };
  if (lg.owner_id == null || Number(lg.owner_id) !== Number(userId)) {
    return { ok: false, reason: PICK_FORMAT_REFUSALS.not_owner, code: 'not_owner' };
  }
  const rows = await sql`
    UPDATE player_leagues SET pick_format_pending = NULL
     WHERE id = ${lg.id} AND owner_id = ${userId} AND pick_format_pending IS NOT NULL RETURNING id`;
  if (!rows.length) return { ok: false, reason: PICK_FORMAT_REFUSALS.not_pending, code: 'not_pending' };
  return { ok: true, kind: 'clear' };
}
