// lib/scores/statsMine.js - "In your games" on the Stats tab: which of the day's
// players are riding in the signed-in reader's entries.
//
// SOURCES COVERED
//   NFL  the Weekly lineup            contests game_type 'weekly' (season + week of the day's games)
//        the Draft roster             contests game_type 'draft'  (same key; meta.roster, else lineup)
//        Game Drafts                  contests game_type 'draft_game' keyed to a match of the day
//                                     (the picks made from the reader's own seat)
//   NBA  the Nightly Draft            draft_game with meta.nightly = true and meta.day_et = the ET day
//        Game Drafts                  draft_game keyed to a match of the day
// NOT COVERED (no cheap existing reader): fantasy league rosters (Fantrax), and
// Tonight's Six (lib/six). Listed in the PR.
//
// THE READS ARE SELECTS ON KEYED COLUMNS - two round trips (contests, then the
// reader's entries). It never calls the draft entry module, whose draftState can
// write on read (lib/gridiron/inYourGames.js made the same rule).

import { sql as defaultSql } from '../db.js';

const idsOf = (v) => (Array.isArray(v) ? v : Object.values(v ?? {}))
  .map((x) => (x && typeof x === 'object' ? x.id : x))
  .filter((x) => x != null && x !== '')
  .map(String);

/**
 * The key set from what the two reads returned. PURE.
 * @param league   'nfl' | 'nba'
 * @param contests [{ id, game_type }]
 * @param entries  [{ contest_id, lineup, meta }]
 * @returns Set of 'n:<nfl_player_id>' (NFL) or 'b:<bdl_player_id>' (NBA)
 */
export function mineKeys({ league, contests = [], entries = [] }) {
  const type = new Map(contests.map((c) => [Number(c.id), c.game_type]));
  const prefix = league === 'nba' ? 'b' : 'n';
  const out = new Set();
  for (const e of entries) {
    const kind = type.get(Number(e.contest_id));
    if (kind === 'weekly' && league === 'nfl') {
      for (const id of idsOf(e.lineup)) out.add(`n:${id}`);
    } else if (kind === 'draft' && league === 'nfl') {
      const roster = Array.isArray(e.meta?.roster) && e.meta.roster.length ? e.meta.roster : e.lineup;
      for (const id of idsOf(roster)) out.add(`n:${id}`);
    } else if (kind === 'draft_game') {
      const room = e.meta?.room;
      if (!room) continue;
      for (const p of room.picks ?? []) {
        if (p?.seat === room.seat && p.id != null) out.add(`${prefix}:${p.id}`);
      }
    }
  }
  return out;
}

/** Read the reader's keys for one league-day. Null when signed out. */
export async function readMineKeys({ userId, league, date, games = [], sql = defaultSql }) {
  if (userId == null || !games.length) return userId == null ? null : new Set();
  const uid = Number(userId);
  const matchIds = games.map((g) => g.id);
  const contests = await sql`
    SELECT c.id, c.game_type FROM contests c
     WHERE c.sport = ${league} AND (
       (c.game_type = 'draft_game' AND (c.match_id = ANY(${matchIds})
          OR (c.meta->>'nightly' = 'true' AND c.meta->>'day_et' = ${date})))
       OR (${league} = 'nfl' AND c.game_type IN ('weekly', 'draft')
          AND (c.season_year, c.week) IN (
            SELECT m.season_year, m.week FROM matches m
             WHERE m.id = ANY(${matchIds}) AND m.season_phase = 'REG' AND m.week IS NOT NULL)))`;
  if (!contests.length) return new Set();
  const entries = await sql`
    SELECT e.contest_id, e.lineup, e.meta FROM contest_entries e
     WHERE e.user_id = ${uid} AND e.contest_id = ANY(${contests.map((c) => c.id)})`;
  return mineKeys({ league, contests, entries });
}
