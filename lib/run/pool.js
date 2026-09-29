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
import { fetchRoster, fetchSeasonStats, ppgOf, kindOfPosition, orderIndex, misfiledRows } from '../october/pool.js';
import { SLOTS } from './rules.js';
import { normName } from '../mlb/names.js';

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
 * PURE. One club's pool rows -> the panel's rows, IN FOUR GROUPS (tue-5):
 *
 *   lead     the arms worth a slot: the G1 probable, then the G2 probable when
 *            BDL has him (the 36-hour refresh brings Game 2s in). With no G1
 *            probable, the frozen G1 starter (`g1`) leads instead, and with
 *            neither, the club's SPs.
 *   bullpen  every other arm, by PPG - collapsed in the panel, never hidden.
 *   nine     the bats: the POSTED card in batting order ("bats 4th"), or
 *            before it posts, the PROJECTED nine - the club's card from its
 *            last final, in order ("projected · bats 4th").
 *   bench    every other bat, by PPG - collapsed.
 *
 * THIS REVERSES TWO EARLIER CUTS, on Derik's tue-5 relay: a reliever used to
 * be dropped outright and a bat off the posted card was not offered. Both are
 * now in a collapsed group - the default a reader sees is still the starters -
 * and lib/house/run.js still reads only `lead` and `nine`.
 *
 * A club with neither a posted nor a projected card has no nine to lead with,
 * so every bat is in `nine` by PPG, unordered, exactly as before.
 *
 * @param posted     the club's posted batting order, or null
 * @param probable   { name } of the club's G1 probable, or null
 * @param probable2  { name } of the club's G2 probable, or null
 * @param projected  the club's card from its last final, or null
 */
export function clubStarters(rows = [], { posted = null, probable = null, probable2 = null, projected = null } = {}) {
  const index = orderIndex(posted);
  const isPosted = index.size > 0;
  const proj = isPosted ? new Map() : orderIndex(projected);
  const isProjected = !isPosted && proj.size > 0;
  const want1 = normName(probable?.name ?? '');
  const want2 = normName(probable2?.name ?? '');
  // NOBODY ANNOUNCED: the frozen G1 starter leads if the board has one, else
  // the club's SPs - never an empty front with every arm in the Bullpen.
  const anyG1 = rows.some((r) => r.kind === 'arm' && r.g1 === true);
  const isSP = (r) => String(r.position ?? '').trim().toUpperCase() === 'SP';
  const out = [];
  for (const r of rows) {
    if (r.kind === 'arm') {
      const n = normName(r.name);
      const gameNo = want1 && n === want1 ? 1 : want2 && n === want2 ? 2 : null;
      // PROBABLE UNTIL THE CLUB'S CARD IS UP, THEN STARTING (tue-4). The card
      // that confirms him is G1's; a G2 probable is never "starting" today.
      const starting = gameNo === 1 && isPosted ? true : null;
      const lead = gameNo != null || (!want1 && (anyG1 ? r.g1 === true : isSP(r)));
      out.push({ ...r, probable: gameNo != null, gameNo, order: null, starting, group: lead ? 'lead' : 'bullpen' });
      continue;
    }
    if (isPosted) {
      const order = index.get(normName(r.name));
      out.push(order === undefined
        ? { ...r, order: null, starting: false, projected: false, group: 'bench' }
        : { ...r, order: order ?? null, starting: true, projected: false, group: 'nine' });
      continue;
    }
    if (isProjected) {
      const order = proj.get(normName(r.name));
      out.push(order === undefined
        ? { ...r, order: null, starting: null, projected: false, group: 'bench' }
        : { ...r, order: order ?? null, starting: null, projected: true, group: 'nine' });
      continue;
    }
    out.push({ ...r, order: null, starting: null, projected: false, group: 'nine' });
  }
  const G = { lead: 0, bullpen: 1, nine: 2, bench: 3 };
  const byPpg = (a, b) => (b.ppg ?? -Infinity) - (a.ppg ?? -Infinity) || a.name.localeCompare(b.name);
  out.sort((a, b) => {
    if (G[a.group] !== G[b.group]) return G[a.group] - G[b.group];
    if (a.group === 'lead') return (a.gameNo ?? 1.5) - (b.gameNo ?? 1.5) || byPpg(a, b);
    // THE NINE IN BATTING ORDER when there is an order - the relay's "in order".
    if (a.group === 'nine' && a.order != null && b.order != null) return a.order - b.order;
    return byPpg(a, b);
  });
  return { rows: out, posted: isPosted, projected: isProjected };
}

/** The groups a reader sees first - and the only ones the house picks from. */
export const LEAD_GROUPS = Object.freeze(['lead', 'nine']);

/**
 * PURE. Each club's G1 and G2 probables off the round's own matches: the
 * club's unfinished games in kickoff order, numbered by their place among ALL
 * the club's games in the round (so a club whose G1 is final reads G2 next).
 * Map(teamId -> { g1: {gameNo, name, id} | null, g2: ... | null }).
 */
export function probablesByClubGames(rows = []) {
  const sorted = [...(rows ?? [])].sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at));
  const games = new Map();
  for (const m of sorted) {
    for (const [side, teamId] of [['away', m.away_team_id], ['home', m.home_team_id]]) {
      const key = String(teamId);
      if (!games.has(key)) games.set(key, []);
      games.get(key).push({ m, side, gameNo: games.get(key).length + 1 });
    }
  }
  const out = new Map();
  for (const [key, list] of games) {
    const open = list.filter((g) => g.m.status !== 'final');
    const at = (g) => {
      const p = g?.m?.probables?.[g.side];
      return p?.name ? { gameNo: g.gameNo, name: p.name, id: p.id ?? null } : null;
    };
    out.set(key, { g1: at(open[0]), g2: at(open[1]) });
  }
  return out;
}

/**
 * THE PROJECTED NINE: each club's card from its most recent FINAL with one
 * stored, any game (the regular season's last one counts before G1).
 * Map(teamId -> { list, kickoffAt }). Bounded to the last 30 days - a card
 * from April projects nothing about October.
 */
export async function lastLineupsByClub(teamIds = [], { now = new Date() } = {}) {
  const ids = [...new Set((teamIds ?? []).filter((x) => x != null).map(Number))];
  if (!ids.length) return new Map();
  const since = new Date(new Date(now).getTime() - 30 * 86_400_000).toISOString();
  const rows = await sql`
    SELECT DISTINCT ON (team_id) team_id, kickoff_at, card FROM (
      SELECT m.home_team_id AS team_id, m.kickoff_at, m.metadata->'lineups'->'home' AS card
        FROM matches m JOIN leagues l ON l.id = m.league_id AND l.slug = 'mlb'
       WHERE m.status = 'final' AND m.home_team_id = ANY(${ids}) AND m.kickoff_at >= ${since}
         AND jsonb_typeof(m.metadata->'lineups'->'home') = 'array'
      UNION ALL
      SELECT m.away_team_id, m.kickoff_at, m.metadata->'lineups'->'away'
        FROM matches m JOIN leagues l ON l.id = m.league_id AND l.slug = 'mlb'
       WHERE m.status = 'final' AND m.away_team_id = ANY(${ids}) AND m.kickoff_at >= ${since}
         AND jsonb_typeof(m.metadata->'lineups'->'away') = 'array'
    ) x
    WHERE jsonb_array_length(card) > 0
    ORDER BY team_id, kickoff_at DESC`;
  return new Map(rows.map((r) => [String(r.team_id), { list: r.card, kickoffAt: new Date(r.kickoff_at).toISOString() }]));
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
 * kickoffs (clubStarted) and the panel needs the batting orders, off the same
 * rows - a second round trip for sibling columns is a round trip for nothing.
 */
export async function roundMatches(contest) {
  const ids = contest?.meta?.matchIds ?? [];
  if (!ids.length) return [];
  return sql`
    SELECT id, status, kickoff_at, home_team_id, away_team_id,
           metadata->'lineups' AS lineups, metadata->'probables' AS probables
      FROM matches WHERE id = ANY(${ids})
     ORDER BY kickoff_at ASC`.catch(() => []);
}

/** PURE. Those rows -> what the lock reads: { matchId, kickoffAt, status }. */
export function roundGames(rows = []) {
  return rows.map((m) => ({
    matchId: String(m.id), kickoffAt: m.kickoff_at, status: m.status ?? null,
    homeTeamId: m.home_team_id ?? null, awayTeamId: m.away_team_id ?? null,
  }));
}

/**
 * PURE. Each club's announced probable, off its EARLIEST UNFINISHED game in
 * the round - the same "next game" lineupsByClub reads. Map(teamId -> {name}).
 */
export function probablesByClub(rows = []) {
  const out = new Map();
  const sorted = [...(rows ?? [])].sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at));
  for (const m of sorted) {
    if (m.status === 'final') continue;
    for (const [side, teamId] of [['away', m.away_team_id], ['home', m.home_team_id]]) {
      const key = String(teamId);
      if (out.has(key)) continue;                  // earliest unfinished wins
      const p = m.probables?.[side];
      out.set(key, p?.name ? { name: p.name, id: p.id ?? null } : null);
    }
  }
  return out;
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

/**
 * When each club's card went up, off the same "earliest unfinished game" the
 * lineups come from: Map(teamId -> ISO string | null). null for a card posted
 * before postedAt was recorded (tue-5) - the panel then says "lineup posted"
 * without a time rather than inventing one.
 */
export function postedAtByClub(rows = []) {
  const out = new Map();
  const sorted = [...(rows ?? [])].sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at));
  for (const m of sorted) {
    if (m.status === 'final') continue;
    for (const [side, teamId] of [['away', m.away_team_id], ['home', m.home_team_id]]) {
      const key = String(teamId);
      if (out.has(key)) continue;
      out.set(key, m.lineups?.postedAt?.[side] ?? null);
    }
  }
  return out;
}
