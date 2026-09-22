// lib/run/pool.js - who is pickable this round, and what they are worth.
//
// IT REUSES OCTOBER'S READERS, DELIBERATELY. fetchRoster(), fetchSeasonStats(),
// asGameRow(), ppgOf() and kindOfPosition() are already written, already
// measured against the feed (the active filter is client-side; the API's
// ?active=true is ignored) and already produce PPG through the ONE scorer.
// A second copy here would be a second answer to "how good is this player",
// which is the thing the shared scorer exists to prevent.
//
// WHAT IS DIFFERENT IS THE SCOPE. October's pool is one day's games; The Run's
// is a ROUND's clubs - every player on every club still alive in it - and the
// G1 starter is flagged rather than being the only arm worth having, because
// a Run arm scores every start his club gives him in the round.

import { sql } from '../db.js';
import { fetchRoster, fetchSeasonStats, ppgOf, kindOfPosition } from '../october/pool.js';
import { SLOTS } from './rules.js';

const shortName = (full) => {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
};

/**
 * PURE. One club's roster + season rows -> the panel's players.
 *
 * ARMS FIRST, THE G1 STARTER FLAGGED, then bats by PPG - the mock's own panel
 * order (McClanahan on top with "G1 starter", then the bats descending).
 */
export function clubRows({ roster = [], seasonStats = [], teamId, abbr, g1StarterId = null }) {
  const statBy = new Map(seasonStats.map((s) => [String(s?.player?.id), s]));
  return roster.map((p) => {
    const kind = kindOfPosition(p.position);
    const s = statBy.get(String(p.id)) ?? null;
    return {
      playerId: String(p.id),
      name: p.full_name,
      short: shortName(p.full_name),
      position: p.position,
      kind,
      teamId,
      team: abbr,
      ppg: s ? ppgOf(s, kind) : null,
      g1: g1StarterId != null && String(p.id) === String(g1StarterId),
    };
  }).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'arm' ? -1 : 1;
    if (a.g1 !== b.g1) return a.g1 ? -1 : 1;
    return (b.ppg ?? -Infinity) - (a.ppg ?? -Infinity) || a.name.localeCompare(b.name);
  });
}

/**
 * The round's whole pool, built once and cached onto the contest.
 *
 * BYE CLUBS ARE NOT IN IT. They are on the BOARD - the mock draws them dimmed
 * so a reader can see who is waiting - but they are not pickable, so building
 * their rosters would be fetching two clubs' worth of players a round to
 * populate a list nothing may choose from.
 */
export async function runPool(contest, { rebuild = false } = {}) {
  if (!rebuild && contest?.meta?.pool) return contest.meta.pool;
  const clubs = (contest?.board ?? []).filter((c) => !c.bye);
  const bdlByTeam = new Map((await sql`
    SELECT id, abbreviation, external_ids->>'bdl_team_id' AS pid
      FROM teams WHERE id = ANY(${clubs.map((c) => c.teamId)})`).map((t) => [t.id, t]));

  const byClub = {};
  for (const c of clubs) {
    const t = bdlByTeam.get(c.teamId);
    if (!t?.pid) { byClub[String(c.teamId)] = []; continue; }
    const [roster, seasonStats] = await Promise.all([
      fetchRoster(t.pid).catch(() => []),
      fetchSeasonStats(contest.season_year, t.pid).catch(() => []),
    ]);
    byClub[String(c.teamId)] = clubRows({
      roster, seasonStats, teamId: c.teamId, abbr: c.abbr,
      g1StarterId: g1For(contest, c),
    });
  }
  const pool = { builtAt: new Date().toISOString(), byClub };
  await sql`
    UPDATE contests SET meta = COALESCE(meta, '{}'::jsonb) || ${JSON.stringify({ pool })}::jsonb
     WHERE id = ${contest.id}`.catch(() => {});
  return pool;
}

/** The frozen probable for this club's game 1, if the seam gave us one. */
function g1For(contest, club) {
  const probs = contest?.meta?.probables ?? {};
  for (const v of Object.values(probs)) {
    for (const side of ['home', 'away']) {
      if (v?.[side]?.teamAbbr && String(v[side].teamAbbr) === String(club.abbr)) return v[side].id;
    }
  }
  return null;
}

/**
 * THE BURN, across rounds: every player this reader has committed in an
 * EARLIER round of this postseason, with the round they spent them in.
 *
 * COMMITTED, NOT SETTLED. A roster is spent the moment its round locks -
 * waiting for the round to settle would let a player be used in the Division
 * round while his Wild Card round was still being played.
 *
 * DERIVED FROM THE ENTRIES, no new table: a used_players table would be a
 * second copy of the rosters able to disagree with them. Migration 112's
 * (user_id, contest_id) index is what makes this a lookup rather than a scan.
 */
export async function usedPlayers(userId, season, { excludeContestId = null, preview = false } = {}) {
  if (userId == null) return new Map();
  // THE BURN DOES NOT CROSS THE PREVIEW LINE, for the reason October's does
  // not: preview and postseason are the same season, and without this a nine
  // spent in September would be gone from the real tournament. It applies
  // ACROSS THE FOUR PREVIEW DAYS and resets when the postseason rounds open.
  const rows = await sql`
    SELECT c.week, c.puzzle_date, c.meta->>'round' AS round, c.meta->>'label' AS label, e.lineup
      FROM contest_entries e
      JOIN contests c ON c.id = e.contest_id
     WHERE e.user_id = ${userId}
       AND c.game_type = 'run' AND c.sport = 'mlb' AND c.season_year = ${season}
       AND COALESCE((c.meta->>'preview')::boolean, false) = ${preview}
       AND (${excludeContestId}::int IS NULL OR c.id <> ${excludeContestId}::int)
     ORDER BY c.week ASC NULLS LAST, c.puzzle_date ASC NULLS LAST`;
  const out = new Map();
  for (const r of rows) {
    for (const slot of SLOTS) {
      const id = r.lineup?.[slot]?.playerId;
      if (id == null) continue;
      if (!out.has(String(id))) out.set(String(id), r.round ?? `round ${r.week ?? r.puzzle_date}`);
    }
  }
  return out;
}
