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
import { fetchRoster, fetchSeasonStats, ppgOf, kindOfPosition, batWithOrder, orderIndex, misfiledRows } from '../october/pool.js';
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
export function clubRows({ roster = [], seasonStats = [], teamId, abbr, providerTeamId = null, g1StarterId = null }) {
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
      // THE PROVIDER'S OWN VERDICT, for misfiledRows() - see lib/october/pool.js.
      providerTeamId: p?.team?.id == null ? null : String(p.team.id),
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
  // AN EMPTY CLUB IS NOT A RESULT, AND CACHING ONE IS A DEAD PANEL FOREVER.
  // Measured: a rebuild of four rounds in a row hit balldontlie's rate limit
  // partway through round one and thirteen of its twenty-four clubs came back
  // with zero players. Every fetch here is `.catch(() => [])`, so that looked
  // exactly like a club nobody may pick from - and because octoberPool/runPool
  // only build when meta.pool is ABSENT, the cache would have served those
  // thirteen dead panels until somebody rebuilt by hand.
  //
  // A CLUB WITH NO PROVIDER ID IS A DIFFERENT THING and is allowed to be empty:
  // that is a mapping gap, it will not fix itself on a retry, and refusing to
  // cache for it would rebuild the whole round on every single read.
  let failed = 0;
  const misfiled = [];
  for (const c of clubs) {
    const t = bdlByTeam.get(c.teamId);
    if (!t?.pid) { byClub[String(c.teamId)] = []; continue; }
    const [roster, seasonStats] = await Promise.all([
      fetchRoster(t.pid).catch(() => []),
      fetchSeasonStats(contest.season_year, t.pid).catch(() => []),
    ]);
    const rows = clubRows({
      roster, seasonStats, teamId: c.teamId, abbr: c.abbr, providerTeamId: t.pid,
      g1StarterId: g1For(contest, c),
    });
    if (!rows.length) failed += 1;
    const wrong = misfiledRows(rows, { teamId: c.teamId, providerTeamId: t.pid });
    if (wrong.length) {
      misfiled.push(...wrong.map((r) => `${r.name} filed under ${c.abbr} but the provider says ${r.providerTeamId}`));
    }
    byClub[String(c.teamId)] = rows;
  }
  const pool = {
    builtAt: new Date().toISOString(), byClub,
    incomplete: failed > 0 || misfiled.length > 0,
    misfiled: misfiled.length ? misfiled : undefined,
  };
  if (failed === 0 && !misfiled.length) {
    await sql`
      UPDATE contests SET meta = COALESCE(meta, '{}'::jsonb) || ${JSON.stringify({ pool })}::jsonb
       WHERE id = ${contest.id}`.catch(() => {});
  }
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

/**
 * PURE. One club's panel, cut to the men who are actually in today's lineup.
 *
 * THE BATS RULE IS OCTOBER'S, SHARED, NOT COPIED - batWithOrder() and
 * orderIndex() are the same two functions the card next door uses, so the two
 * games cannot come to disagree about who is starting.
 *
 * THE ARMS RULE IS NOT OCTOBER'S, AND THAT IS DELIBERATE. October's arm slot is
 * ONE START on ONE night, so the probable is the only arm worth offering. A Run
 * arm scores every start his club gives him in the round, and a round is a
 * SERIES: the game-2 and game-3 starters are worth as much as game 1's and are
 * unpickable if the panel offers only the probable. So the arms are the club's
 * declared starters with the G1 probable flagged and first, which is what
 * clubRows already sorts them into - untouched here.
 *
 * @param rows   clubRows for ONE club
 * @param posted the club's own posted batting order, or null
 * @returns { rows, posted: boolean }
 */
export function clubStarters(rows = [], { posted = null } = {}) {
  const index = orderIndex(posted);
  const isPosted = index.size > 0;
  const out = [];
  for (const r of rows) {
    if (r.kind === 'arm') { out.push({ ...r, order: null, starting: null }); continue; }
    const bat = batWithOrder(r, index, isPosted);
    if (bat) out.push(bat);
  }
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'arm' ? -1 : 1;
    if (a.kind === 'arm') {
      if (a.g1 !== b.g1) return a.g1 ? -1 : 1;
      return (b.ppg ?? -Infinity) - (a.ppg ?? -Infinity) || a.name.localeCompare(b.name);
    }
    const ao = a.order == null ? Infinity : a.order;
    const bo = b.order == null ? Infinity : b.order;
    if (ao !== bo) return ao - bo;
    return (b.ppg ?? -Infinity) - (a.ppg ?? -Infinity) || a.name.localeCompare(b.name);
  });
  return { rows: out, posted: isPosted };
}

/**
 * Which posted batting order belongs to which club this round, read off the
 * round's own matches.
 *
 * A CLUB PLAYS AT MOST ONE GAME A DAY and a round is at most one day in the
 * preview, so one list per club is the whole truth there. In a real series a
 * club has one game IN FLIGHT at a time too: the earliest match of the round
 * that is not final is the one whose card is up, and a finished game's lineup is
 * history that would tell a picker nothing about tonight.
 *
 * @returns Map(String(teamId) -> the club's posted list, or null)
 */
/**
 * THE ROUND'S OWN MATCHES, read once: the status, the LIVE first pitch and the
 * posted cards, for every match meta.matchIds names.
 *
 * ONE QUERY, TWO READERS. The round's lock needs the statuses and the live
 * kickoffs (roundLockAt) and the panel needs the batting orders, off the same
 * rows - a second round trip for sibling columns is a round trip for nothing.
 */
export async function roundMatches(contest) {
  const ids = contest?.meta?.matchIds ?? [];
  if (!ids.length) return [];
  return sql`
    SELECT id, status, kickoff_at, home_team_id, away_team_id, metadata->'lineups' AS lineups
      FROM matches WHERE id = ANY(${ids})
     ORDER BY kickoff_at ASC`.catch(() => []);
}

/** PURE. Those rows -> what the lock reads: { matchId, kickoffAt, status }. */
export function roundGames(rows = []) {
  return rows.map((m) => ({
    matchId: String(m.id), kickoffAt: m.kickoff_at, status: m.status ?? null,
  }));
}

export async function lineupsByClub(contest, rows = null) {
  const list = rows ?? await roundMatches(contest);
  const out = new Map();
  for (const m of list) {
    if (m.status === 'final') continue;
    for (const [side, teamId] of [['away', m.away_team_id], ['home', m.home_team_id]]) {
      const key = String(teamId);
      if (out.has(key)) continue;                  // earliest unfinished wins
      const list = Array.isArray(m.lineups?.[side]) && m.lineups[side].length ? m.lineups[side] : null;
      out.set(key, list);
    }
  }
  return out;
}
