// lib/october/pool.js - who is pickable today, and what they are worth.
//
// ACTIVE IS A CLIENT-SIDE FILTER, and this was measured, not assumed:
// /mlb/v1/players?active=true RETURNS THE SAME PAGE as no filter at all -
// team 8 gives 100 rows and 24 active either way, first row Ryan Thompson,
// active:false, in both. The parameter is ignored. Filtering on the `active`
// field of the rows is the only thing that works, and a build that trusted
// the query string would have put 76 retired players in the picker.
//
// PPG IS SEASON POINTS THROUGH THE SCORING FUNCTION - the same function that
// settles the card, so the number in the picker and the number on the
// leaderboard are produced by one table. It reads the SEASON AGGREGATE rather
// than summing game rows: /mlb/v1/season_stats is one call a club against
// hundreds, and its totals are the same totals.
//
// CACHED DAILY, onto the contest that owns the day. One build a day, frozen
// beside the lineups and probables the board already freezes, so the PPG a
// reader sorted by at 10am is the PPG they picked against at 6pm.

import { sql } from '../db.js';
import { batPoints, armPoints, round1 } from '../mlb/fantasyPoints.js';
import { normName, byName } from '../mlb/names.js';

const BDL = 'https://api.balldontlie.io';
// THE LONG FORMS ARE REAL. BDL spells an active player's position as an
// abbreviation ("RP", "SS") and an INACTIVE one's out in full ("Relief
// Pitcher", "Shortstop") - measured across three clubs' full lists. The active
// filter should mean only abbreviations ever reach here, and the long forms are
// in the set anyway: the one place this matters is the bats fallback, where a
// pitcher misread as a bat is offered for a bat slot and scores by the wrong
// table.
const PITCHER = new Set(['SP', 'RP', 'P', 'PITCHER', 'STARTING PITCHER', 'RELIEF PITCHER']);

async function bdl(path) {
  const key = process.env.BDL_API_KEY;
  if (!key) throw new Error('BDL_API_KEY missing in env');
  const res = await fetch(`${BDL}${path}`, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`BDL ${res.status} on ${path}`);
  return (await res.json())?.data ?? [];
}

/**
 * One club's roster, ACTIVE ONLY - filtered here because the API will not.
 *
 * AND PAGED, because one page is not a club. BDL's player list is every player
 * who has ever worn the uniform: TB returns 160 rows and NYY 173, in two pages
 * of 100, and only 34 and 37 of those are active. Reading page one alone put a
 * THIRD of each club's active roster out of reach of the picker - five of the
 * eighteen men who actually started 2026-09-22's TB @ NYY (Ben Rice, Liam
 * Hicks, Chandler Simpson, George Lombard Jr., Spencer Jones) were simply not
 * offerable, and the card gave no sign that anyone was missing. Measured, both
 * ways, before this loop was written.
 *
 * THE CURSOR IS BDL'S OWN (meta.next_cursor). The page cap is a guard against
 * a provider that stops sending one, not a limit anybody is expected to reach.
 */
export async function fetchRoster(bdlTeamId, { maxPages = 6 } = {}) {
  const out = [];
  let cursor = null;
  for (let i = 0; i < maxPages; i += 1) {
    const q = `/mlb/v1/players?team_ids[]=${encodeURIComponent(bdlTeamId)}&per_page=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const page = await bdlPage(q);
    out.push(...page.rows);
    cursor = page.next;
    if (!cursor) break;
  }
  return out.filter((p) => p?.active === true);
}

/** One page, with the cursor that follows it. */
async function bdlPage(path) {
  const key = process.env.BDL_API_KEY;
  if (!key) throw new Error('BDL_API_KEY missing in env');
  const res = await fetch(`${BDL}${path}`, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`BDL ${res.status} on ${path}`);
  const j = await res.json();
  return { rows: j?.data ?? [], next: j?.meta?.next_cursor ?? null };
}

/** One club's season aggregates. */
export async function fetchSeasonStats(season, bdlTeamId) {
  return bdl(`/mlb/v1/season_stats?season=${encodeURIComponent(season)}&team_id=${encodeURIComponent(bdlTeamId)}&per_page=100`);
}

/**
 * THE ADAPTER, and it exists so there is exactly ONE scoring table in this
 * product. season_stats names its columns batting_h / pitching_k; the scoring
 * function speaks the game row's hits / strikeouts_pitched. Mapping here keeps
 * lib/mlb/fantasyPoints.js ignorant of which endpoint a number came from - and
 * keeps a second, drifting copy of the table from being written against these
 * names.
 */
export function asGameRow(s) {
  return {
    at_bats: s?.batting_ab, hits: s?.batting_h, doubles: s?.batting_2b,
    triples: s?.batting_3b, home_runs: s?.batting_hr, rbi: s?.batting_rbi,
    runs: s?.batting_r, walks: s?.batting_bb, stolen_bases: s?.batting_sb,
    // INNINGS BACK TO OUTS. season_stats sends pitching_ip as 182.1 meaning
    // 182 and a third; the scoring table pays per OUT, so the decimal is a
    // count of thirds and never a fraction. 182.1 -> 547, not 546.3.
    outs_recorded: ipToOuts(s?.pitching_ip),
    strikeouts_pitched: s?.pitching_k, wins: s?.pitching_w,
    earned_runs: s?.pitching_er, hits_allowed: s?.pitching_h, walks_allowed: s?.pitching_bb,
  };
}

export function ipToOuts(ip) {
  if (ip == null || ip === '') return null;
  const n = Number(ip);
  if (!Number.isFinite(n) || n < 0) return null;
  const whole = Math.floor(n);
  // ONE DECIMAL PLACE, AND IT IS THIRDS. Rounded rather than truncated because
  // 5.2 arrives from JSON as 5.199999999999999 often enough to matter.
  const thirds = Math.round((n - whole) * 10);
  return whole * 3 + (thirds >= 1 && thirds <= 2 ? thirds : 0);
}

/**
 * PPG for one player. PURE.
 *
 * THE KIND DECIDES THE DENOMINATOR as well as the table: a starter's value is
 * per START, not per appearance, and dividing a season's pitching by 162 would
 * rank every arm below every bat.
 */
export function ppgOf(seasonRow, kind) {
  const row = asGameRow(seasonRow);
  if (kind === 'arm') {
    const gp = Number(seasonRow?.pitching_gp) || 0;
    return gp > 0 ? round1(armPoints(row) / gp) : null;
  }
  const gp = Number(seasonRow?.batting_gp) || 0;
  return gp > 0 ? round1(batPoints(row) / gp) : null;
}

export const kindOfPosition = (pos) => (PITCHER.has(String(pos ?? '').trim().toUpperCase()) ? 'arm' : 'bat');

/**
 * PURE. Rosters + season stats -> the picker's rows for one game.
 *
 * SORTED ARM FIRST, THEN BATS BY PPG, which is the mock's own panel order:
 * Wheeler on top, then Acuña, Schwarber, Harper, Olson, Turner by descending
 * PPG. A player with no season line sorts last rather than being dropped - a
 * September call-up is pickable, he simply has no number yet.
 */
export function poolRows({
  roster = [], seasonStats = [], matchId, teamAbbr, teamId = null,
  providerTeamId = null, probableId = null, probableName = null,
}) {
  const statBy = new Map(seasonStats.map((s) => [String(s?.player?.id), s]));
  // THE PROBABLE ARRIVES FROM THE OTHER PROVIDER AND SO DOES ITS NAME.
  // `probableId` is an MLBAM id and `p.id` is a BDL id - the comparison below
  // used to be that id against this one and was therefore false on every row
  // of every game, which is why `probable` never lit and the starter sorted
  // like any other arm. See lib/mlb/names.js.
  const wantName = normName(probableName);
  return roster.map((p) => {
    const kind = kindOfPosition(p.position);
    const s = statBy.get(String(p.id)) ?? null;
    return {
      playerId: String(p.id),
      name: p.full_name,
      short: shortName(p.full_name),
      position: p.position,
      kind,
      team: teamAbbr,
      // OUR team id ON THE ROW. It was not there, so nothing could ask the one
      // question that settles a "wrong club" report in a line: does this row's
      // club equal the club it is filed under? See misfiledRows().
      teamId,
      matchId,
      ppg: s ? ppgOf(s, kind) : null,
      // THE PROVIDER'S OWN VERDICT ON WHOSE PLAYER THIS IS, carried so the
      // guard compares two independent facts rather than echoing the filter it
      // was built from.
      providerTeamId: p?.team?.id == null ? null : String(p.team.id),
      // THE PROBABLE IS THE ONLY ARM WORTH OFFERING FIRST. A bullpen arm may
      // not appear at all, and the card's arm slot is a start.
      probable: (probableId != null && String(p.id) === String(probableId))
        || (Boolean(wantName) && normName(p.full_name) === wantName),
    };
  }).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'arm' ? -1 : 1;
    if (a.probable !== b.probable) return a.probable ? -1 : 1;
    return (b.ppg ?? -Infinity) - (a.ppg ?? -Infinity) || a.name.localeCompare(b.name);
  });
}

/**
 * PURE. THE ROWS THAT ARE FILED UNDER THE WRONG CLUB.
 *
 * WHY THIS EXISTS: a "wrong club" report - Skubal listed in LAD's arms - took a
 * dozen queries to answer, and the answer turned out to be that the row was
 * RIGHT. Nothing on a pool row said which club it belonged to, so the only way
 * to check was to go back to both providers by hand. One row's worth of fields
 * and one comparison turns that into a line of output on every rebuild.
 *
 * IT COMPARES TWO INDEPENDENT FACTS, not one fact with itself. `team`/`teamId`
 * are OURS, copied from the club being built; `providerTeamId` is what the
 * provider puts on the PLAYER. A guard that checked `row.team === teamAbbr`
 * would be asserting that an assignment happened.
 *
 * A ROW WITH NO PROVIDER TEAM IS NOT A VIOLATION. Some feeds omit it, and
 * "unknown" must not read as "wrong" - that turns a thin payload into a refusal
 * to build the day at all.
 */
export function misfiledRows(rows = [], { teamId = null, providerTeamId = null } = {}) {
  return rows.filter((r) => {
    if (teamId != null && r?.teamId != null && String(r.teamId) !== String(teamId)) return true;
    if (providerTeamId == null || r?.providerTeamId == null) return false;
    return String(r.providerTeamId) !== String(providerTeamId);
  });
}

/**
 * PURE. One bat against one posted card. Shared by October (two clubs in one
 * game) and The Run (one club at a time), because "who is in the lineup" is the
 * same question either way and answering it twice is how the two games would
 * come to disagree about whether somebody is starting.
 *
 * @returns the row with `order` and `starting`, or NULL when the card is posted
 *   and he is not on it - a bat who is not playing is not offered.
 */
export function batWithOrder(row, orderBy = null, posted = false) {
  if (!posted || !orderBy) return { ...row, order: null, starting: null };
  const order = orderBy.get(normName(row?.name));
  if (order === undefined) return null;
  return { ...row, order: order ?? null, starting: true };
}

/** PURE. A posted side -> Map(normName -> batting order). */
export function orderIndex(list) {
  const out = new Map();
  // AN EMPTY ARRAY IS NOT A LINEUP. statsapi sends [] for a card that has not
  // been posted - see lineupsFrom() - and a truthy check on the array alone
  // would call that a posted lineup with nobody in it, which offers no bats.
  if (!Array.isArray(list) || !list.length) return out;
  for (const e of list) {
    const n = normName(e?.name);
    if (n && !out.has(n)) out.set(n, e?.order ?? null);
  }
  return out;
}

/**
 * PURE. One game's pool rows -> STARTERS ONLY, in the order they hit.
 *
 * THIS IS AN OVERLAY, NOT PART OF THE BUILD, and that is the whole design. The
 * pool is cached onto the contest once a day (rosters and season PPG do not
 * move); a batting order is posted two or three hours before first pitch and is
 * changed again when somebody is scratched. Freezing it into the cached pool
 * would have shown a 10am reader a lineup that did not exist yet and a 6pm
 * reader the one from before the scratch. So the cached pool stays the full
 * roster and this cuts it down at READ time, from metadata.lineups, which the
 * poller keeps current.
 *
 * ARMS ARE THE PROBABLE AND NOTHING ELSE. The arm slot is a START - the scoring
 * table pays per out and pays a win - so offering a middle reliever for it
 * offers a slot that will most likely score nothing at all. A club with no
 * announced starter falls back to its DECLARED STARTERS (position SP), never to
 * the bullpen, and says "starter not announced": a card that offered no arm on
 * a one-game night would be a DNF for everyone who opened it.
 *
 * BATS ARE THE POSTED CARD, IN BATTING ORDER, WHEN IT IS POSTED. Before it is
 * posted there is nothing better than the active roster by PPG, and the panel
 * says so rather than implying those nine are starting.
 *
 * A BAT WHO IS NOT ON A POSTED CARD IS NOT OFFERED. He is not "low PPG", he is
 * not playing, and a picker that still listed him would be selling a zero.
 *
 * @param rows pool rows for ONE game, both clubs, as poolRows built them
 * @param lineup matches.metadata.lineups: { away, home } with either side null
 * @returns { rows, posted: { away, home } } - `posted` is what the panel reads
 */
export function startersOnly(rows = [], { lineup = null, probables = null, awayAbbr = null, homeAbbr = null } = {}) {
  const sideOf = (r) => (String(r?.team) === String(awayAbbr) ? 'away'
    : String(r?.team) === String(homeAbbr) ? 'home' : null);

  const orderBy = { away: orderIndex(lineup?.away), home: orderIndex(lineup?.home) };
  const posted = { away: orderBy.away.size > 0, home: orderBy.home.size > 0 };

  // THE LIVE PROBABLE OVERRIDES THE FROZEN ONE. `row.probable` was decided when
  // the pool was built - once a day - and a starter announced at 4pm would
  // otherwise not reach the picker until tomorrow's build, so "starter not
  // announced" was a permanent state for the one afternoon it mattered on. The
  // poller refreshes metadata.probables on the pre-kick pass; this is where that
  // reaches the card, within one pass and with no rebuild.
  const liveProbable = {
    away: normName(probables?.away?.name),
    home: normName(probables?.home?.name),
  };
  const isProbable = (r, side) => {
    if (r?.probable) return true;
    const want = side ? liveProbable[side] : '';
    return Boolean(want) && normName(r?.name) === want;
  };

  const hasProbable = { away: false, home: false };
  for (const r of rows) {
    const side = sideOf(r);
    if (side && r.kind === 'arm' && isProbable(r, side)) hasProbable[side] = true;
  }

  const out = [];
  for (const r of rows) {
    const side = sideOf(r);
    if (r.kind === 'arm') {
      if (isProbable(r, side)) {
        out.push({ ...r, probable: true, order: null, starting: true, probablePending: false });
        continue;
      }
      // No announced starter for this club: its declared SPs, flagged.
      if (side && !hasProbable[side] && String(r.position ?? '').trim().toUpperCase() === 'SP') {
        out.push({ ...r, order: null, starting: null, probablePending: true });
      }
      continue;
    }
    const bat = batWithOrder(r, side ? orderBy[side] : null, side ? posted[side] : false);
    if (bat) out.push({ ...bat, side });
  }

  // ARMS FIRST, THEN BATS BY PPG DESCENDING ACROSS BOTH CLUBS. THE BATTING
  // ORDER NEVER SORTS, and that is a ruling, not an oversight: the panel is a
  // list a reader picks the best available player from, so the number they are
  // comparing is PPG, and grouping by club or ordering by lineup slot buries the
  // best bat in the game halfway down. The order is a FACT ABOUT the row - it
  // rides in the sub-line as "CLUB · bats Nth" - not a way to rank it.
  //
  // (It did sort by club-then-order for one evening. Two batting orders one
  // under the other read cleanly and ranked nothing, which is the wrong job for
  // this panel.)
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'arm' ? -1 : 1;
    if (a.kind === 'arm' && Boolean(a.probable) !== Boolean(b.probable)) return a.probable ? -1 : 1;
    return (b.ppg ?? -Infinity) - (a.ppg ?? -Infinity) || a.name.localeCompare(b.name);
  });
  return { rows: out, posted };
}

/**
 * PURE. Is this picked bat off the posted card?
 *
 * ANSWERED ONLY WHEN THERE IS A CARD TO BE OFF. An unposted lineup is not
 * evidence of a benching, and saying "not starting" three hours before the
 * lineup goes up would tell every reader to swap every pick.
 *
 * IT DOES NOT NEED THE CLUB, AND THAT IS DELIBERATE. A saved pick carries
 * playerId, matchId, kind and name - a `team` was only added to the patch
 * alongside this - so the check reads BOTH sides of the game. With one side
 * posted and the pick's club unknown, absence is not an answer: he may be on
 * the side that has not posted. That case returns false, which is the honest
 * "we do not know yet".
 *
 * AND ONLY UNTIL FIRST PITCH. After the lock the reader cannot swap, so telling
 * them to would be cruelty with a button attached. A lineup that posts LATE -
 * after the game has started, which a lagging feed does - therefore never
 * produces a swap nobody can act on.
 */
export function notStarting(pick, { lineup = null, awayAbbr = null, homeAbbr = null, locked = false } = {}) {
  if (locked || !pick?.playerId) return false;
  const want = normName(pick.name);
  if (!want) return false;
  const listOf = (side) => (Array.isArray(lineup?.[side]) && lineup[side].length ? lineup[side] : null);
  const away = listOf('away'); const home = listOf('home');
  if (!away && !home) return false;
  const inList = (l) => Boolean(l) && l.some((e) => normName(e?.name) === want);
  if (inList(away) || inList(home)) return false;

  // WHICH SIDE IS HIS, IF WE KNOW IT. A pick that carries its club is answered
  // by that club's card alone; one that does not needs both sides posted.
  const side = pick.team == null ? null
    : String(pick.team) === String(awayAbbr) ? 'away'
      : String(pick.team) === String(homeAbbr) ? 'home' : null;
  if (side) return Boolean(listOf(side));
  return Boolean(away && home);
}

function shortName(full) {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

/**
 * The day's whole pool, built once and cached onto the contest.
 *
 * BUILT FROM THE BOARD, not from the schedule: the board is the frozen
 * snapshot of which games this card covers, and a game added to the day after
 * the card opened is not on it.
 */
export async function octoberPool(contest, { rebuild = false } = {}) {
  if (!rebuild && contest?.meta?.pool) return contest.meta.pool;
  const board = contest?.board ?? [];
  const teamIds = [...new Set(board.flatMap((g) => [g.home_team_id, g.away_team_id]).filter((x) => x != null))];
  const bdlByTeam = new Map((await sql`
    SELECT id, abbreviation, external_ids->>'bdl_team_id' AS pid FROM teams WHERE id = ANY(${teamIds})`)
    .map((t) => [t.id, t]));

  const byGame = {};
  // AN EMPTY SIDE IS NOT A RESULT - see lib/run/pool.js for the measurement.
  // Every fetch below is `.catch(() => [])`, and a cached empty side is a game
  // nobody may pick from that nothing will ever retry.
  let failed = 0;
  const misfiled = [];
  for (const g of board) {
    const rows = [];
    for (const [side, teamId] of [['home', g.home_team_id], ['away', g.away_team_id]]) {
      const t = bdlByTeam.get(teamId);
      if (!t?.pid) continue;
      const [roster, seasonStats] = await Promise.all([
        fetchRoster(t.pid).catch(() => []),
        fetchSeasonStats(contest.season_year, t.pid).catch(() => []),
      ]);
      const side_rows = poolRows({
        roster, seasonStats, matchId: g.match_id, teamAbbr: t.abbreviation,
        teamId: t.id, providerTeamId: t.pid,
        probableId: g.probables?.[side]?.id ?? null,
        probableName: g.probables?.[side]?.name ?? null,
      });
      if (!side_rows.length) failed += 1;
      const wrong = misfiledRows(side_rows, { teamId: t.id, providerTeamId: t.pid });
      if (wrong.length) {
        misfiled.push(...wrong.map((r) => `${r.name} filed under ${t.abbreviation} but the provider says ${r.providerTeamId}`));
      }
      rows.push(...side_rows);
    }
    byGame[String(g.match_id)] = rows;
  }
  const pool = {
    builtAt: new Date().toISOString(), byGame,
    incomplete: failed > 0 || misfiled.length > 0,
    misfiled: misfiled.length ? misfiled : undefined,
  };
  // CACHED ONTO THE DAY IT DESCRIBES. Top-level key, so the shallow merge is
  // the right depth and every sibling meta key survives. NOT CACHED AT ALL when
  // a side came back empty: the next read rebuilds rather than serving a dead
  // panel until somebody notices.
  if (!failed && !misfiled.length) {
    await sql`
      UPDATE contests SET meta = COALESCE(meta, '{}'::jsonb) || ${JSON.stringify({ pool })}::jsonb
       WHERE id = ${contest.id}`.catch(() => {});
  }
  return pool;
}

/**
 * THE BURN READ: every player this reader has already spent this postseason,
 * with the day they spent them - the picker prints "used Sep 29".
 *
 * DERIVED FROM THE ENTRIES, no new table (the relay's own preference, and the
 * right one): a used_players table would be a second copy of the lineups able
 * to disagree with them, and the first disagreement would refuse a reader a
 * player they never picked. Migration 112 adds the one index this needs.
 *
 * IT COUNTS EVERY ENTRY, NOT JUST SETTLED ONES. A player picked into today's
 * card is spent the moment the slot locks - waiting for the day to settle
 * would let one player be used twice in the same week.
 */
export async function usedPlayers(userId, season, { excludeContestId = null, preview = false } = {}) {
  if (userId == null) return new Map();
  // THE BURN DOES NOT CROSS THE PREVIEW LINE. A preview day and a postseason
  // day are the same season, so without this a reader who spent Judge in a
  // September preview could not pick him in the World Series - the preview
  // would have eaten the real tournament's pool. The burn applies INSIDE the
  // preview and RESETS when the postseason days are created, which is exactly
  // "same season, different tournament".
  const rows = await sql`
    SELECT c.puzzle_date, e.lineup
      FROM contest_entries e
      JOIN contests c ON c.id = e.contest_id
     WHERE e.user_id = ${userId}
       AND c.game_type = 'october' AND c.sport = 'mlb'
       AND c.season_year = ${season}
       AND COALESCE((c.meta->>'preview')::boolean, false) = ${preview}
       AND (${excludeContestId}::int IS NULL OR c.id <> ${excludeContestId}::int)
     ORDER BY c.puzzle_date ASC`;
  const out = new Map();
  for (const r of rows) {
    for (const pick of Object.values(r.lineup ?? {})) {
      const id = pick?.playerId;
      if (id == null) continue;
      // FIRST USE WINS the label - a player cannot be used twice, so a second
      // row for one id means the data is wrong and the earlier date is the
      // one that made him unavailable.
      if (!out.has(String(id))) out.set(String(id), String(r.puzzle_date).slice(0, 10));
    }
  }
  return out;
}
