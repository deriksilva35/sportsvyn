// lib/scores/statsMine.js - "In your games" on the Stats tab: which of the day's
// players are riding in the signed-in reader's entries, and in WHICH of them.
//
// SOURCES (each key maps to the set of sources it came from; the sheet's "Only"
// filter reads them):
//   weekly   NFL  the Weekly lineup            contests game_type 'weekly' (season + week of the day's games)
//   draft    NFL  the Draft roster             contests game_type 'draft'  (same key; meta.roster, else lineup)
//            both Game Drafts                  contests game_type 'draft_game' keyed to a match of the day
//                                              (the picks made from the reader's own seat); NBA Nightly
//                                              (meta.nightly = true, meta.day_et = the ET day)
//   six      NBA  Tonight's Six                contests game_type 'six' on the day (the entry's lineup slots)
//   league   NFL  fantasy-league rosters       the reader's Fantrax franchise's kept players
//                                              (draft_config_keepers on a config the reader owns or has
//                                              claimed a franchise in), matched to nfl_players by name
//
// WHAT "LEAGUE ROSTER" MEANS TODAY: the only roster the product stores for an imported
// league is the keeper list (draft_config_keepers, one row per kept player per franchise);
// in-season rosters are not imported. So "My leagues" is the reader's KEPT players.
//
// THE READS ARE SELECTS ON KEYED COLUMNS - a handful of round trips (contests, the
// reader's entries, memberships, keepers, name match). It never calls the draft entry
// module, whose draftState can write on read (lib/gridiron/inYourGames.js made the same rule).

import { sql as defaultSql } from '../db.js';

const idsOf = (v) => (Array.isArray(v) ? v : Object.values(v ?? {}))
  .map((x) => (x && typeof x === 'object' ? x.id : x))
  .filter((x) => x != null && x !== '')
  .map(String);

const add = (map, key, src) => {
  const set = map.get(key) ?? new Set();
  set.add(src);
  map.set(key, set);
};

/**
 * The key map from what the reads returned. PURE.
 * @param league   'nfl' | 'nba'
 * @param contests [{ id, game_type }]
 * @param entries  [{ contest_id, lineup, meta }]
 * @param leagueKeys  keys already resolved from fantasy-league rosters (NFL: 'n:<id>')
 * @returns Map of 'n:<nfl_player_id>' (NFL) or 'b:<bdl_player_id>' (NBA) -> Set of sources
 */
export function mineKeys({ league, contests = [], entries = [], leagueKeys = [] }) {
  const type = new Map(contests.map((c) => [Number(c.id), c.game_type]));
  const prefix = league === 'nba' ? 'b' : 'n';
  const out = new Map();
  for (const e of entries) {
    const kind = type.get(Number(e.contest_id));
    if (kind === 'weekly' && league === 'nfl') {
      for (const id of idsOf(e.lineup)) add(out, `n:${id}`, 'weekly');
    } else if (kind === 'draft' && league === 'nfl') {
      const roster = Array.isArray(e.meta?.roster) && e.meta.roster.length ? e.meta.roster : e.lineup;
      for (const id of idsOf(roster)) add(out, `n:${id}`, 'draft');
    } else if (kind === 'draft_game') {
      const room = e.meta?.room;
      if (!room) continue;
      for (const p of room.picks ?? []) {
        if (p?.seat === room.seat && p.id != null) add(out, `${prefix}:${p.id}`, 'draft');
      }
    } else if (kind === 'six' && league === 'nba') {
      // a Six lineup is { SLOT: { matchId, playerId, name, team } }; playerId is the BDL id
      for (const slot of Object.values(e.lineup ?? {})) {
        if (slot?.playerId != null) add(out, `b:${slot.playerId}`, 'six');
      }
    }
  }
  for (const k of leagueKeys) add(out, k, 'league');
  return out;
}

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * The reader's franchise keepers, as player NAMES. PURE.
 * @param memberships [{ config_id, fantrax_team_id, role, user_id, config_user_id, teams }]
 * @param keepers     [{ config_id, fantrax_team_id, player_name }]
 * A member's franchise is the one they claimed; an owner with no claim has the imported isMine team.
 */
export function leagueKeeperNames(memberships = [], keepers = []) {
  const franchise = new Map();
  for (const m of memberships) {
    let team = m.fantrax_team_id ?? null;
    if (team == null && m.role === 'owner') {
      team = (m.teams ?? []).find((t) => t?.isMine === true)?.fantraxTeamId ?? null;
    }
    if (team != null) franchise.set(`${m.config_id}:${team}`, true);
  }
  const names = new Set();
  for (const k of keepers) {
    if (franchise.has(`${k.config_id}:${k.fantrax_team_id}`)) names.add(norm(k.player_name));
  }
  return [...names].filter(Boolean);
}

/** The reader's Fantrax-league keys ('n:<nfl_player_id>'), through the name crosswalk. One chain of small reads. */
export async function readLeagueKeys({ userId, sql = defaultSql }) {
  const uid = Number(userId);
  const memberships = await sql`
    SELECT m.config_id, m.fantrax_team_id, m.role, c.teams
      FROM draft_config_members m
      JOIN draft_configs c ON c.id = m.config_id
     WHERE m.user_id = ${uid} AND c.source = 'fantrax'`;
  if (!memberships.length) return [];
  const keepers = await sql`
    SELECT config_id, fantrax_team_id, player_name FROM draft_config_keepers
     WHERE config_id = ANY(${memberships.map((m) => m.config_id)})`;
  const names = leagueKeeperNames(memberships, keepers);
  if (!names.length) return [];
  const players = await sql`
    SELECT id, full_name FROM nfl_players
     WHERE lower(regexp_replace(full_name, '[^A-Za-z ]', '', 'g')) = ANY(${names})`;
  return players.filter((p) => names.includes(norm(p.full_name))).map((p) => `n:${p.id}`);
}

/** Read the reader's keys for one league-day. Null when signed out. */
export async function readMineKeys({ userId, league, date, games = [], sql = defaultSql }) {
  if (userId == null) return null;
  if (!games.length) return new Map();
  const uid = Number(userId);
  const matchIds = games.map((g) => g.id);
  const [contests, leagueKeys] = await Promise.all([
    sql`
      SELECT c.id, c.game_type FROM contests c
       WHERE c.sport = ${league} AND (
         (c.game_type = 'draft_game' AND (c.match_id = ANY(${matchIds})
            OR (c.meta->>'nightly' = 'true' AND c.meta->>'day_et' = ${date})))
         OR (${league} = 'nba' AND c.game_type = 'six' AND c.puzzle_date = ${date}::date)
         OR (${league} = 'nfl' AND c.game_type IN ('weekly', 'draft')
            AND (c.season_year, c.week) IN (
              SELECT m.season_year, m.week FROM matches m
               WHERE m.id = ANY(${matchIds}) AND m.season_phase = 'REG' AND m.week IS NOT NULL)))`,
    league === 'nfl' ? readLeagueKeys({ userId: uid, sql }).catch(() => []) : [],
  ]);
  const entries = contests.length
    ? await sql`
        SELECT e.contest_id, e.lineup, e.meta FROM contest_entries e
         WHERE e.user_id = ${uid} AND e.contest_id = ANY(${contests.map((c) => c.id)})`
    : [];
  return mineKeys({ league, contests, entries, leagueKeys });
}
