// lib/pickem/entry.js - the Pick'em board against the database.
//
// SEALED PER-GAME: the wire payload carries the VIEWER'S picks and nobody
// else's - the reveal of the field is per-game and belongs to Relay 3's
// field data; until then no other player's side ever leaves the server.
// Pinned by leak test with a planted second entry as the negative control.
//
// THE SAVE IS WHERE THE LOCK LIVES. The GAME's snapshot kickoff against the
// SERVER clock is the only authority - no client clock is trusted, the
// OS-outranks-column law's cousin. A save for a kicked game is rejected with
// a kind error naming the lock, whatever the client believed.

import { sql } from '../db.js';
import { gameRows, progressOf, recordOf, nextKickoff, nextUnlockedKickoff, boardPhase } from './view.js';
import { formatRecord } from '../standings/view.js';

export const PICKEM_SPORTS = ['nfl', 'cfb'];

/** The board the route serves. RE-EXPORTED, NOT REIMPLEMENTED (relay 4
 * item 1): the ordering key and the board number both live in
 * lib/pickem/sequence.js now, because four copies of
 * `count(opens_at < mine) + 1` and one untied `ORDER BY opens_at DESC`
 * disagreed with each other on PROD and hid an open board behind a settled
 * one. Kept exported from here so the ~30 existing import sites do not all
 * have to move at once; sequence.js is the definition.
 */
import { currentPickemBoard } from './sequence.js';

export { currentPickemBoard };

/**
 * WHICH SPORT THE BARE /pickem ROUTE REDIRECTS TO (relay 2c item 6):
 * whichever sport's own NEXT LOCK is soonest.
 *
 * "Next lock" reads differently depending on whether a board is open:
 *   - a sport with an open, unsettled board: the nearest un-kicked game's
 *     kickoff (falling back to the contest's own locks_at once every game
 *     has kicked - there is still a real board to point at).
 *   - a sport with NO open board (its window hasn't opened, or its whole
 *     season hasn't started): boardPlan()'s own read-only opens_at for the
 *     NEXT board that would be created - the honest comparison when
 *     neither sport has anything to pick yet, since nothing is inserted
 *     until the open gate passes.
 * Both sports absent (nothing scheduled at all, either way): 'cfb', the
 * long-standing single-sport default.
 */
export async function soonestPickemSport(now = new Date()) {
  const open = [];
  for (const sport of PICKEM_SPORTS) {
    const contest = await currentPickemBoard({ sport, now }).catch(() => null);
    if (!contest || contest.settled) continue;
    const t = new Date(now).getTime();
    const next = contest.board.find((g) => new Date(g.kickoff_at).getTime() > t) ?? null;
    open.push({ sport, at: next ? new Date(next.kickoff_at) : new Date(contest.locks_at) });
  }
  if (open.length) return open.sort((a, b) => a.at - b.at)[0].sport;

  const { boardPlan } = await import('./create.js');
  const upcoming = [];
  for (const sport of PICKEM_SPORTS) {
    const { plan } = await boardPlan({ leagueSlug: sport, now }).catch(() => ({ plan: null }));
    if (plan) upcoming.push({ sport, at: plan.opensAt });
  }
  if (upcoming.length) return upcoming.sort((a, b) => a.at - b.at)[0].sport;

  return 'cfb';
}

/** MY flat lineup for a contest - {} when I have no entry yet. */
async function myPicks(contestId, userId) {
  if (userId == null) return {};
  const r = await sql`
    SELECT lineup FROM contest_entries
     WHERE contest_id = ${contestId} AND user_id = ${userId} LIMIT 1`;
  return r[0]?.lineup ?? {};
}

/** Live status + scores for the board's games - display only; deadlines stay
 * with the snapshot. */
async function liveGames(board) {
  const ids = board.map((g) => g.match_id);
  const rows = await sql`
    SELECT id, status, home_score, away_score FROM matches WHERE id = ANY(${ids})`;
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Everything /pickem renders, viewer-scoped. Phase 'preopen' (which covers
 * "no board yet") carries no games at all.
 */
export async function pickemBoardView(userId, { sport = null, now = new Date() } = {}) {
  const contest = await currentPickemBoard({ sport, now }).catch(() => null);
  const phase = boardPhase(contest, now);
  if (!contest || phase === 'preopen') return { phase: 'preopen', contest: null, games: [] };

  const [liveById, picks] = await Promise.all([
    liveGames(contest.board),
    myPicks(contest.id, userId),
  ]);
  // AP ranks for the board's teams - one query for the whole board, resolved
  // server-side so the client never needs a rankings table of its own.
  const { apRankMap, currentApWeek, latestPollSeason, AP_POLL } = await import('../cfb/rankings.js');
  const apSeason = contest.sport === 'cfb' ? await latestPollSeason(AP_POLL) : null;
  const apWeek = apSeason ? await currentApWeek(apSeason) : null;
  const apRanks = apWeek ? await apRankMap({ season: apSeason, week: apWeek }) : new Map();
  // RECORDS AND THE LINE, both nullable and both failure-tolerant.
  //
  // .catch(() => empty) on each is deliberate and load-bearing: board 2 is
  // created by a cron on Tuesday, and a board that cannot be SERVED because a
  // standings row or a priced spread is missing would be a decoration taking
  // the page down with it. Absent is the default everywhere in this chain.
  // isPreGame AT THE FETCH, not only at the render. A spread on a game that
  // has kicked is a fossil (the ingest freezes at kickoff), so those matches
  // are never even asked for - the same freeze-at-kickoff discipline the game
  // page and the /market reads already apply.
  const { isPreGame } = await import('../gridiron/oddsFormat.js');
  const matchIds = contest.board
    .filter((g) => isPreGame(liveById.get(g.match_id)?.status ?? 'scheduled'))
    .map((g) => g.match_id);
  const teamIds = contest.board.flatMap((g) => [g.home_team_id, g.away_team_id]).filter(Boolean);
  // POSITIONAL: the destructure names the three maps in THIS order. The
  // helmets relay slipped the color map into the spreads' seat and shipped a
  // board with home_colors null and spread_home null on every row.
  const [records, spreads, colors] = await Promise.all([
    recordMapFor(contest.sport, teamIds, contest.season_year).catch(() => new Map()),
    (async () => {
      // ONE SOURCE FOR THE LINE. getSpreadHome reads the same odds_markets
      // rows, guards and side-resolution the Market page reads; it is a second
      // question of one pipeline, never a second odds reader.
      const { getSpreadHome } = await import('../gridiron/oddsReader.js');
      return getSpreadHome(matchIds);
    })().catch(() => new Map()),
    teamColorMap(teamIds).catch(() => new Map()),
  ]);
  const games = gameRows({ board: contest.board, liveById, picks, now, apRanks, records, spreads, colors });
  // The receipt's field facts ride only the settled phase - null otherwise
  // and null for a stranger; receiptFor re-checks `settled` itself.
  const receipt = phase === 'settled'
    ? await receiptFor(contest.id, userId, {
      results: contest.perfect?.results ?? null,
      board: contest.board,
    }).catch(() => null)
    : null;
  // The reader's own confirmation stamp (relay 3 item 3) - viewer-scoped,
  // like every other per-entry field on this payload.
  const [myEntry] = userId == null ? [] : await sql`
    SELECT meta FROM contest_entries WHERE contest_id = ${contest.id} AND user_id = ${userId}`;

  return {
    phase,
    receipt,
    confirmedAt: myEntry?.meta?.confirmed_at ?? null,
    contest: {
      id: contest.id,
      sport: contest.sport,
      // DISPLAY WEEK IS THE AP POLL'S, NOT contests.week - see pickemCardData's
      // own note above; the header names the week a reader would recognise,
      // never the internal board-sequencing number.
      displayWeek: contest.sport === 'cfb' ? apWeek : contest.sport === 'nfl' ? contest.week : null,
      gamesCount: contest.board.length,
      opensAt: contest.opens_at,
      locksAt: contest.locks_at,
      settled: contest.settled,
      settledAt: contest.settled_at,
      boardNumber: contest.board_number,
    },
    games,
    progress: progressOf(games),
    record: recordOf(games),
    nextKickoff: nextKickoff(games),
  };
}

/**
 * The settled receipt's FIELD facts - rank and rarest correct pick. POST-
 * SETTLE ONLY, enforced here: before `settled` the field's picks are sealed
 * per game and this returns null without touching entries. After settle every
 * game is final, the per-game reveal condition is met for the whole board,
 * and the aggregate (counts, never named picks) is the only thing served.
 */
export async function receiptFor(contestId, userId, { results, board }) {
  const c = (await sql`
    SELECT settled FROM contests WHERE id = ${contestId} AND game_type = 'pickem' LIMIT 1`)[0];
  if (!c?.settled || userId == null) return null;
  const entries = await sql`
    SELECT user_id, score, lineup FROM contest_entries WHERE contest_id = ${contestId}`;
  const mine = entries.find((e) => e.user_id === userId);
  if (!mine) return null;
  const field = entries.length;
  const rank = 1 + entries.filter((e) => Number(e.score ?? 0) > Number(mine.score ?? 0)).length;
  // Rarest correct pick: among MY wins, the side the fewest entrants shared.
  let best = null;
  for (const [matchId, side] of Object.entries(mine.lineup ?? {})) {
    if (results?.[matchId] !== side) continue;
    const same = entries.filter((e) => (e.lineup ?? {})[matchId] === side).length;
    if (!best || same < best.same) {
      const g = board.find((x) => String(x.match_id) === matchId);
      best = { name: side === 'home' ? g?.home : g?.away, same, pct: Math.round((same / field) * 100) };
    }
  }
  return { score: Number(mine.score ?? 0), rank, field, best };
}

/**
 * The lobby card's one-line summary - viewer-scoped or null. Null (caught or
 * genuine) reads as "no live board" and the card stays ghosted, the lobby's
 * safe direction.
 */
export async function pickemCardData(userId, { sport = null, now = new Date() } = {}) {
  const contest = await currentPickemBoard({ sport, now });
  if (!contest) return null;

  // SETTLED, WITH NOTHING NEWER OPEN YET (relay 2b item 6): the lobby row
  // must not fall through to "no board yet" here - currentPickemBoard()
  // only ever returns a NEWER contest once one has actually opened, so
  // reaching this branch at all already means "Tuesday morning, before the
  // next board" is the true state, the same window weeklyHome/draftHome's
  // own settled states describe. `record` is null for a signed-out reader
  // or one who never picked - a settled board with nothing to report about
  // THIS viewer, not an error.
  if (contest.settled) {
    let record = null;
    if (userId != null) {
      const [e] = await sql`SELECT score FROM contest_entries WHERE contest_id = ${contest.id} AND user_id = ${userId}`;
      if (e?.score != null) record = { correct: Number(e.score), played: contest.board.length };
    }
    let settledDisplayWeek = null;
    if (contest.sport === 'cfb') {
      const { currentApWeek, latestPollSeason, AP_POLL } = await import('../cfb/rankings.js');
      const apSeason = await latestPollSeason(AP_POLL);
      settledDisplayWeek = apSeason ? await currentApWeek(apSeason) : null;
    } else if (contest.sport === 'nfl') {
      settledDisplayWeek = contest.week;
    }
    return {
      settled: true, entered: record != null, record,
      boardNumber: contest.board_number, sport: contest.sport, displayWeek: settledDisplayWeek,
    };
  }

  const picks = userId == null ? {} : await myPicks(contest.id, userId);
  const total = contest.board.length;
  const picked = Object.keys(picks).length;
  // ONE SOURCE WITH THE BOARD PAGE. This used to compute its own
  // `kickoff_at > now` here AND carry a second `firstKickoff` (the board's
  // earliest kickoff) for the lobby row. firstKickoff is what made /games say
  // "first lock Mon Sep 7" on CFB board 3 all of Tuesday - a lock that had
  // already passed, on a board with 23 games still to play. The board's own
  // earliest kickoff is a fact about the board's past, never about what a
  // reader can still do, so it is gone rather than merely unused.
  // DISPLAY WEEK IS THE SPORT'S OWN CALENDAR, NOT contests.week - the latter is
  // an internal board-sequencing field for CFB (a synthetic fixture can hold
  // week=36 for a board that opens in September), never a number a reader
  // would recognise there. For CFB the AP poll's current week IS that
  // calendar, absent it the card drops the week clause. NFL IS DIFFERENT
  // (relay 2c item 5): its contests.week IS the provider's own real REG
  // week, derived the same way the Weekly's is - a genuine display week, not
  // an internal key, so it needs no poll lookup at all.
  let displayWeek = null;
  if (contest.sport === 'cfb') {
    const { currentApWeek, latestPollSeason, AP_POLL } = await import('../cfb/rankings.js');
    const apSeason = await latestPollSeason(AP_POLL);
    displayWeek = apSeason ? await currentApWeek(apSeason) : null;
  } else if (contest.sport === 'nfl') {
    displayWeek = contest.week;
  }
  return {
    total, picked, nextKickoff: nextUnlockedKickoff(contest.board, { now }), entered: picked > 0,
    boardNumber: contest.board_number,
    sport: contest.sport, displayWeek,
    opensAt: contest.opens_at,
  };
}

/**
 * PURE: team_records-shaped rows -> Map(team_id -> "9-3"). Exported for a
 * unit test that needs no live team_records table (relay 2c-fix item 2) -
 * recordMapFor() below is this function plus the one DB read.
 *
 * '0-0' vs ABSENT IS THE ROW'S OWN EXISTENCE, not the score: a row at 0-0
 * is a real team_records fact (this team's season hasn't started, or it
 * has and nobody has scored) and renders as '0-0'; a team with no row here
 * AT ALL is simply absent from the returned Map, and recordLine() is what
 * turns that absence into '-'.
 */
/** Map(team_id -> { primary, secondary }) for the teams that have both. */
export async function teamColorMap(teamIds) {
  const ids = [...new Set(teamIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await sql`SELECT id, color_primary, color_secondary FROM teams WHERE id = ANY(${ids}::int[])`;
  return new Map(rows.filter((r) => r.color_primary && r.color_secondary).map((r) => [r.id, { primary: r.color_primary, secondary: r.color_secondary }]));
}

export function recordMapFromRows(rows, teamIds) {
  const want = new Set(teamIds);
  const out = new Map();
  for (const r of rows ?? []) {
    if (!want.has(r.team_id)) continue;
    const s = formatRecord(r.wins, r.losses, r.ties);
    if (s) out.set(r.team_id, s);
  }
  return out;
}

/**
 * team_id -> "9-3", for the board's record chips.
 *
 * REG-ONLY BY CONSTRUCTION: it goes through getLeagueRecords' own reader,
 * which filters season_type = 'regular', so a preseason row can never reach
 * a board card.
 */
async function recordMapFor(sport, teamIds, season) {
  if (!teamIds.length || !season) return new Map();
  const { getLeagueRecords } = await import('../standings/read.js');
  const rows = await getLeagueRecords(sport, season);
  return recordMapFromRows(rows, teamIds);
}

/**
 * Save one pick. Returns { ok:true, matchId, side } or { ok:false, reason }.
 * Reasons are KIND and specific: 'game_locked' names the per-game seal.
 */
export async function savePick(userId, contestId, matchId, side, { now = new Date() } = {}) {
  if (!['home', 'away'].includes(side)) return { ok: false, reason: 'bad_side' };
  const contest = (await sql`
    SELECT id, board, settled, opens_at FROM contests
     WHERE id = ${contestId} AND game_type = 'pickem' LIMIT 1`)[0];
  if (!contest) return { ok: false, reason: 'no_board' };
  if (contest.settled) return { ok: false, reason: 'settled' };
  const t = new Date(now).getTime();
  if (new Date(contest.opens_at).getTime() > t) return { ok: false, reason: 'not_open' };

  const game = contest.board.find((g) => Number(g.match_id) === Number(matchId));
  if (!game) return { ok: false, reason: 'not_on_board' };
  // THE PER-GAME LOCK: the snapshot kickoff, `<=` at the boundary. A game
  // that has kicked is sealed however the request found its way here.
  if (new Date(game.kickoff_at).getTime() <= t) {
    return { ok: false, reason: 'game_locked', kickoffAt: game.kickoff_at };
  }

  // lineup is a FLAT map {match_id: side} - the top-level merge is the one
  // place jsonb || is honest (the shallow-merge law: never on nesting; there
  // is no nesting here by construction).
  const patch = JSON.stringify({ [String(game.match_id)]: side });
  await sql`
    INSERT INTO contest_entries (contest_id, user_id, lineup)
    VALUES (${contestId}, ${userId}, ${patch}::jsonb)
    ON CONFLICT (contest_id, user_id)
    DO UPDATE SET lineup = contest_entries.lineup || ${patch}::jsonb, updated_at = now()`;
  return { ok: true, matchId: game.match_id, side };
}
