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
import { gameRows, progressOf, recordOf, nextKickoff, nextUnlockedKickoff, boardPhase, hasKicked } from './view.js';
import { isPlaceholderKickoff } from '../mlb/kickoffTbd.js';
import { formatRecord } from '../standings/view.js';
import {
  isDayBoard, dayGameLocked, isVoidStatus, currentGames, withCurrentTips,
} from '../nba/dayPickem.js';

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
import { isVoidAll, VOID_ALL_LABEL } from '../settle/voidRule.js';
import { isConfidence, effectiveRanks, validateSheet, scoreConfidence, correctCount, pctOfMax } from './confidence.js';

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
    const next = contest.board.find((g) => new Date(g.kickoff_at).getTime() > t && !isPlaceholderKickoff(g.kickoff_at)) ?? null;
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
// Exported for lib/gridiron/todayPicks.js (TODAY TAB v2, Q5), which builds
// the Today tab's pick strip from the light pieces rather than calling the
// whole board view twice.
export async function myPicks(contestId, userId) {
  if (userId == null) return {};
  const r = await sql`
    SELECT lineup FROM contest_entries
     WHERE contest_id = ${contestId} AND user_id = ${userId} LIMIT 1`;
  return r[0]?.lineup ?? {};
}

/** MY picks AND rank sheet for a contest: { lineup, ranks } (both {} / null when none). */
export async function myEntry(contestId, userId) {
  if (userId == null) return { lineup: {}, ranks: null };
  const r = await sql`
    SELECT lineup, ranks FROM contest_entries
     WHERE contest_id = ${contestId} AND user_id = ${userId} LIMIT 1`;
  return { lineup: r[0]?.lineup ?? {}, ranks: r[0]?.ranks ?? null };
}

// Live status, scores, live_state (the clock a live row shows - v2 reader
// ruling b) and the CURRENT kickoff_at all come from lib/nba/dayPickem.js
// currentGames(): since ruling P1 every board reads the one map.

/**
 * The PRIMARY US broadcaster per match, or nothing.
 *
 * ONE ROW PER MATCH BY CONSTRUCTION: is_primary picks the single row the
 * provider marks as the main carrier, so a game on two networks does not
 * render two. A match with no row at all is ABSENT, not a dash - the foot
 * simply omits the network, because a dash claims we looked and found
 * nothing knowable, and here the data is merely not there.
 *
 * FAILURE-TOLERANT like the records and the line beside it: a broadcaster
 * table that cannot be read must never take the board down.
 */
async function networksFor(matchIds) {
  if (!matchIds.length) return new Map();
  const rows = await sql`
    SELECT match_id, broadcaster_name FROM match_broadcasters
     WHERE match_id = ANY(${matchIds}) AND is_primary = true`;
  return new Map(rows.map((r) => [r.match_id, r.broadcaster_name]));
}

/**
 * Everything /pickem renders, viewer-scoped. Phase 'preopen' (which covers
 * "no board yet") carries no games at all.
 */
export async function pickemBoardView(userId, { sport = null, now = new Date() } = {}) {
  const contest = await currentPickemBoard({ sport, now }).catch(() => null);
  const phase = boardPhase(contest, now);
  if (!contest || phase === 'preopen') return { phase: 'preopen', contest: null, games: [] };

  const [liveById, mine] = await Promise.all([
    currentGames(contest.board),
    myEntry(contest.id, userId),
  ]);
  const picks = mine.lineup;
  // A CONFIDENCE BOARD (lib/pickem/confidence.js): the viewer's own rank sheet,
  // completed to the pre-fill where they have not saved one. Null on a regular board.
  const confidence = isConfidence(contest);
  const myRanks = confidence ? effectiveRanks(contest.board, mine.ranks) : null;
  // EVERY BOARD DRAWS THE CURRENT TIP (lib/nba/dayPickem.js; football since
  // ruling P1): the row's seal, its time and the countdown all read the
  // kickoff the save will be judged by.
  contest.board = withCurrentTips(contest.board, liveById);
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
  const allMatchIds = contest.board.map((g) => g.match_id);
  const [records, spreads, colors, networks, abbrs] = await Promise.all([
    recordMapFor(contest.sport, teamIds, contest.season_year).catch(() => new Map()),
    (async () => {
      // ONE SOURCE FOR THE LINE. getSpreadHome reads the same odds_markets
      // rows, guards and side-resolution the Market page reads; it is a second
      // question of one pipeline, never a second odds reader.
      const { getSpreadHome } = await import('../gridiron/oddsReader.js');
      return getSpreadHome(matchIds);
    })().catch(() => new Map()),
    teamColorMap(teamIds).catch(() => new Map()),
    // EVERY match, not only the pre-game ones: a network is as true at the
    // final whistle as it was at kickoff, unlike the line.
    networksFor(allMatchIds).catch(() => new Map()),
    // THE STORED ABBREVIATION, for the headgear lookup (lib/teams/headgear.js).
    // The board snapshot carries names only.
    teamAbbrMap(teamIds).catch(() => new Map()),
  ]);
  const settledResults = phase === 'settled' ? (contest.perfect?.results ?? null) : null;
  const games = gameRows({ board: contest.board, liveById, picks, now, apRanks, records, spreads, colors, networks, abbrs, ranks: myRanks, results: settledResults });
  // The receipt's field facts ride only the settled phase - null otherwise
  // and null for a stranger; receiptFor re-checks `settled` itself.
  // AN ALL-VOID CLOSE HAS NO RECEIPT (ruling sun-11 item 1): every score is
  // null, and a rank over nulls is a tie at 0 for the whole field.
  const voidAll = phase === 'settled' && isVoidAll(contest);
  const receipt = phase === 'settled' && !voidAll
    ? await receiptFor(contest.id, userId, {
      results: contest.perfect?.results ?? null,
      board: contest.board,
    }).catch(() => null)
    : null;
  // The reader's own confirmation stamp (relay 3 item 3) - viewer-scoped,
  // like every other per-entry field on this payload.
  const [myEntryRow] = userId == null ? [] : await sql`
    SELECT meta FROM contest_entries WHERE contest_id = ${contest.id} AND user_id = ${userId}`;

  // THE CONFIDENCE HEADLINE, viewer-scoped. Settled: the stored score and max.
  // Open: the sheet's live total (what is up for grabs) and what is already banked.
  const confidenceView = confidence ? await confidenceSummary(contest, games, userId, phase) : null;

  return {
    phase,
    receipt,
    confidence: confidenceView,
    confirmedAt: myEntryRow?.meta?.confirmed_at ?? null,
    contest: {
      id: contest.id,
      sport: contest.sport,
      // DISPLAY WEEK IS THE AP POLL'S, NOT contests.week - see pickemCardData's
      // own note above; the header names the week a reader would recognise,
      // never the internal board-sequencing number.
      displayWeek: contest.sport === 'cfb' ? apWeek : contest.sport === 'nfl' ? contest.week : null,
      // THE DAY A DAY BOARD IS FOR ('2026-10-20'), or null. Its week column is
      // a key (YYYYMMDD), never a label.
      dayEt: isDayBoard(contest) ? (contest.meta?.day_et ?? null) : null,
      gamesCount: contest.board.length,
      scoring: confidence ? 'confidence' : 'regular',
      opensAt: contest.opens_at,
      locksAt: contest.locks_at,
      settled: contest.settled,
      settledAt: contest.settled_at,
      boardNumber: contest.board_number,
      voidAll,
      voidLabel: voidAll ? VOID_ALL_LABEL : null,
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
    SELECT settled, meta FROM contests WHERE id = ${contestId} AND game_type = 'pickem' LIMIT 1`)[0];
  if (!c?.settled || userId == null) return null;
  // AN ALL-VOID CLOSE IS NOT GRADED: no rank, no 0 (ruling sun-11 item 1).
  if (isVoidAll(c)) return null;
  const entries = await sql`
    SELECT user_id, score, max_score, lineup FROM contest_entries WHERE contest_id = ${contestId}`;
  const mine = entries.find((e) => e.user_id === userId);
  if (!mine) return null;
  const field = entries.length;
  // A CONFIDENCE BOARD RANKS ON PERCENT OF MAX: every entry has its own max.
  const confidence = isConfidence(c);
  const standing = (e) => (confidence ? (pctOfMax(e.score, e.max_score) ?? 0) : Number(e.score ?? 0));
  const rank = 1 + entries.filter((e) => standing(e) > standing(mine)).length;
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
  return { score: Number(mine.score ?? 0), max: confidence ? Number(mine.max_score ?? 0) : null, rank, field, best };
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
      const [e] = await sql`SELECT score, max_score, lineup FROM contest_entries WHERE contest_id = ${contest.id} AND user_id = ${userId}`;
      if (e?.score != null && isConfidence(contest)) {
        // POINTS FIRST, RECORD SECOND (ruling tue-7): "76 of 93 - 11-2". `correct`
        // and `played` stay a WINS count over games that had a winner, so every
        // surface that prints "N of M right" still reads true; points/max ride along.
        const results = contest.perfect?.results ?? {};
        record = {
          correct: correctCount(e.lineup ?? {}, results),
          played: Object.values(results).filter((v) => v === 'home' || v === 'away').length,
          points: Number(e.score), max: Number(e.max_score ?? 0),
        };
      } else if (e?.score != null) record = { correct: Number(e.score), played: contest.board.length };
    }
    let settledDisplayWeek = null;
    if (contest.sport === 'cfb') {
      const { currentApWeek, latestPollSeason, AP_POLL } = await import('../cfb/rankings.js');
      const apSeason = await latestPollSeason(AP_POLL);
      settledDisplayWeek = apSeason ? await currentApWeek(apSeason) : null;
    } else if (contest.sport === 'nfl') {
      settledDisplayWeek = contest.week;
    }
    // AN ALL-VOID CLOSE: settled, nobody's record, and the label to say why.
    const voidAll = isVoidAll(contest);
    return {
      settled: true, entered: record != null, record,
      voidAll, voidLabel: voidAll ? VOID_ALL_LABEL : null,
      boardNumber: contest.board_number, sport: contest.sport, displayWeek: settledDisplayWeek,
    };
  }

  const picks = userId == null ? {} : await myPicks(contest.id, userId);
  const total = contest.board.length;
  const picked = Object.keys(picks).length;
  // EVERY BOARD COUNTS BY THE CURRENT TIP AND STATUS - the same lock its save
  // applies (lib/nba/dayPickem.js; football since ruling P1).
  const byId = await currentGames(contest.board);
  contest.board = withCurrentTips(contest.board, byId);
  const statusOf = (g) => byId.get(Number(g.match_id))?.status ?? 'scheduled';
  // PICKABLE = still open at `now` (GAMES TAB v2, Part A 3c): the lobby's
  // counts match the board's own "n of pickable" (fresh-user D4).
  const openRows = contest.board.filter((g) => !hasKicked(g, { status: statusOf(g), now }));
  const pickable = openRows.length;
  const pickedOpen = openRows.filter((g) => picks[g.match_id] != null).length;
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
    total, picked, pickable, pickedOpen, nextKickoff: nextUnlockedKickoff(contest.board, { statusOf, now }), entered: picked > 0,
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

/** team id -> the stored abbreviation, for teams that have one. */
export async function teamAbbrMap(teamIds) {
  const ids = [...new Set(teamIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await sql`SELECT id, abbreviation FROM teams WHERE id = ANY(${ids}::int[])`;
  return new Map(rows.filter((r) => r.abbreviation).map((r) => [r.id, r.abbreviation]));
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
    SELECT id, board, settled, opens_at, meta FROM contests
     WHERE id = ${contestId} AND game_type = 'pickem' LIMIT 1`)[0];
  if (!contest) return { ok: false, reason: 'no_board' };
  if (contest.settled) return { ok: false, reason: 'settled' };
  const t = new Date(now).getTime();
  if (new Date(contest.opens_at).getTime() > t) return { ok: false, reason: 'not_open' };

  const game = contest.board.find((g) => Number(g.match_id) === Number(matchId));
  if (!game) return { ok: false, reason: 'not_on_board' };
  // A DAY BOARD (NBA) LOCKS ON THE ROW'S CURRENT TIP, read here, now - never
  // on the snapshot (lib/nba/dayPickem.js says why).
  if (isDayBoard(contest)) return saveDayPick(userId, contestId, game, side, { now });
  // THE PER-GAME LOCK, FOOTBALL TOO (ruling P1, sat-5): the match row's
  // CURRENT kickoff_at and its live STATUS, read in this request - the NBA
  // rule (dayGameLocked), `<=` at the boundary. The snapshot kickoff used to
  // decide this, and a game moved EARLIER than the frozen board time stayed
  // pickable after it had really kicked; a game that went live early stayed
  // pickable until the snapshot time. A status off 'scheduled' (live, final,
  // postponed, cancelled) is locked whatever the clock says.
  const [m] = await sql`SELECT id, kickoff_at, status, COALESCE((metadata->>'kickoff_tbd')::boolean, false) AS kickoff_tbd
                      FROM matches WHERE id = ${Number(game.match_id)}`;
  if (!m) return { ok: false, reason: 'not_on_board' };
  // A CALLED-OFF GAME says so (the board's "is off - it counts for nobody"),
  // rather than reading as an ordinary kicked game (the void rule, sat-5).
  if (isVoidStatus(m.status)) return { ok: false, reason: 'game_off', status: m.status };
  if (dayGameLocked(m, now)) {
    return { ok: false, reason: 'game_locked', kickoffAt: new Date(m.kickoff_at).toISOString() };
  }

  // lineup is a FLAT map {match_id: side} - the top-level merge is the one
  // place jsonb || is honest (the shallow-merge law: never on nesting; there
  // is no nesting here by construction).
  const patch = JSON.stringify({ [String(game.match_id)]: side });
  await sql`
    INSERT INTO contest_entries (contest_id, user_id, lineup, submitted_at)
    VALUES (${contestId}, ${userId}, ${patch}::jsonb, ${new Date(now).toISOString()}::timestamptz)
    ON CONFLICT (contest_id, user_id)
    DO UPDATE SET lineup = contest_entries.lineup || ${patch}::jsonb, updated_at = now(),
                  submitted_at = EXCLUDED.submitted_at`;
  return { ok: true, matchId: game.match_id, side };
}

/**
 * One pick on a DAY BOARD. The lock is the match row's CURRENT kickoff_at and
 * status, read in this request; a void game cannot be picked at all.
 *
 * THE PICK IS STAMPED. meta.picked_at[match_id] = the server instant of the
 * save, so the settle can re-ask the lock against the tip as it finally stood
 * (a tip moved EARLIER underneath a saved pick). NESTED, so the merge is
 * written out (CLAUDE.md, the shallow-|| law): picked_at is merged into
 * itself and every sibling key of meta survives.
 */
async function saveDayPick(userId, contestId, game, side, { now = new Date() } = {}) {
  const [m] = await sql`SELECT id, kickoff_at, status, COALESCE((metadata->>'kickoff_tbd')::boolean, false) AS kickoff_tbd
                      FROM matches WHERE id = ${Number(game.match_id)}`;
  if (!m) return { ok: false, reason: 'not_on_board' };
  if (isVoidStatus(m.status)) return { ok: false, reason: 'game_off', status: m.status };
  if (dayGameLocked(m, now)) {
    return { ok: false, reason: 'game_locked', kickoffAt: new Date(m.kickoff_at).toISOString() };
  }
  const key = String(game.match_id);
  const patch = JSON.stringify({ [key]: side });
  const stamp = JSON.stringify({ [key]: new Date(now).toISOString() });
  await sql`
    INSERT INTO contest_entries (contest_id, user_id, lineup, meta, submitted_at)
    VALUES (${contestId}, ${userId}, ${patch}::jsonb, jsonb_build_object('picked_at', ${stamp}::jsonb), ${new Date(now).toISOString()}::timestamptz)
    ON CONFLICT (contest_id, user_id)
    DO UPDATE SET lineup = contest_entries.lineup || ${patch}::jsonb,
                  meta = COALESCE(contest_entries.meta, '{}'::jsonb) || jsonb_build_object('picked_at',
                    COALESCE(contest_entries.meta->'picked_at', '{}'::jsonb) || ${stamp}::jsonb),
                  updated_at = now(), submitted_at = EXCLUDED.submitted_at`;
  return { ok: true, matchId: game.match_id, side };
}


/**
 * The confidence summary for ONE viewer on one board.
 *   up      points up for grabs: the sum of the sheet's ranks over games with a
 *           winner still possible (not void)
 *   points  / max  / correct / played  once the board has settled (the stored
 *           entry score and max); while open, what is banked so far
 *   voidPoints  the rank a void game took off the max (the "came off your max" line)
 *   voidCount
 *   beatPct  share of the OTHER entrants this viewer out-scored on percent of max
 */
async function confidenceSummary(contest, games, userId, phase) {
  const mineRanks = Object.fromEntries(games.map((g) => [String(g.match_id), g.my_rank]));
  const live = games.filter((g) => !g.void);
  const up = live.reduce((s, g) => s + (g.my_rank ?? 0), 0);
  const voidRows = games.filter((g) => g.void);
  const voidPoints = voidRows.reduce((s, g) => s + (g.my_rank ?? 0), 0);
  const banked = games.reduce((s, g) => s + (g.my_points ?? 0), 0);
  const base = {
    n: games.length, up, voidCount: voidRows.length, voidPoints,
    banked, picked: games.filter((g) => g.my_side != null).length,
    ranks: mineRanks,
  };
  if (phase !== 'settled' || userId == null) return base;
  const entries = await sql`
    SELECT user_id, score, max_score FROM contest_entries
     WHERE contest_id = ${contest.id} AND score IS NOT NULL`;
  const me = entries.find((e) => e.user_id === userId);
  if (!me) return base;
  const myPct = pctOfMax(me.score, me.max_score) ?? 0;
  const others = entries.filter((e) => e.user_id !== userId);
  const beat = others.filter((e) => (pctOfMax(e.score, e.max_score) ?? 0) < myPct).length;
  const results = contest.perfect?.results ?? {};
  const mineLineup = Object.fromEntries(games.filter((g) => g.my_side).map((g) => [String(g.match_id), g.my_side]));
  return {
    ...base,
    points: Number(me.score), max: Number(me.max_score ?? 0),
    correct: correctCount(mineLineup, results),
    played: Object.values(results).filter((v) => v === 'home' || v === 'away').length,
    beatPct: others.length ? Math.round((beat / others.length) * 100) : null,
  };
}

/**
 * SAVE THE WHOLE CONFIDENCE SHEET: the picks and the ranks, one call, one
 * button ("Save picks"). Returns { ok:true, ranks, saved } or { ok:false, reason }.
 *
 * THE LOCK RULE, per game, the same one savePick applies (the match row's
 * CURRENT kickoff and status, read here, `<=` at the boundary): a LOCKED game's
 * pick AND rank are frozen. The incoming sheet must hold every locked game at
 * the number it already has (validateSheet), so the unkicked games permute
 * among the free numbers only - a swap ACROSS a locked game moves the numbers
 * on either side and never the locked game's own.
 *
 * @param picks  {match_id: 'home'|'away'} - sides for the games the player has picked
 * @param ranks  {match_id: int} - the FULL sheet, a permutation of 1..N
 */
export async function saveSheet(userId, contestId, { picks = {}, ranks = null } = {}, { now = new Date() } = {}) {
  const contest = (await sql`
    SELECT id, board, settled, opens_at, meta FROM contests
     WHERE id = ${contestId} AND game_type = 'pickem' LIMIT 1`)[0];
  if (!contest) return { ok: false, reason: 'no_board' };
  if (!isConfidence(contest)) return { ok: false, reason: 'not_confidence' };
  if (contest.settled) return { ok: false, reason: 'settled' };
  if (new Date(contest.opens_at).getTime() > new Date(now).getTime()) return { ok: false, reason: 'not_open' };

  const ids = contest.board.map((g) => String(g.match_id));
  for (const [id, side] of Object.entries(picks ?? {})) {
    if (!ids.includes(String(id))) return { ok: false, reason: 'not_on_board' };
    if (!['home', 'away'].includes(side)) return { ok: false, reason: 'bad_side' };
  }
  const byId = await currentGames(contest.board);
  const locked = new Set(contest.board
    .filter((g) => dayGameLocked(byId.get(Number(g.match_id)), now))
    .map((g) => String(g.match_id)));

  const mine = await myEntry(contestId, userId);
  const sheet = validateSheet({ board: contest.board, stored: mine.ranks, incoming: ranks, locked });
  if (!sheet.ok) return sheet;

  // PICKS: a locked game's pick is frozen exactly as its rank is. The incoming
  // map carries what the sheet shows, so it may repeat a locked pick unchanged
  // but may not change it, add one, or drop one.
  const patch = {}; const changed = [];
  for (const id of ids) {
    const was = mine.lineup?.[id] ?? null;
    const now_ = picks?.[id] ?? null;
    if (locked.has(id)) {
      if (now_ !== was) return { ok: false, reason: 'game_locked', matchId: Number(id) };
      continue;
    }
    if (now_ == null) continue;            // an unpicked game stays unpicked; a pick is never un-made
    if (now_ !== was) { patch[id] = now_; changed.push(id); }
  }
  const stampAt = new Date(now).toISOString();
  const stamp = JSON.stringify(Object.fromEntries(changed.map((id) => [id, stampAt])));
  const patchJson = JSON.stringify(patch);
  const ranksJson = JSON.stringify(sheet.ranks);
  // lineup is a FLAT map, so the top-level || is honest (the shallow-merge law).
  // meta.picked_at is NESTED, so it is merged into itself - and only the NBA day
  // board reads it, but stamping it everywhere is harmless and keeps one path.
  await sql`
    INSERT INTO contest_entries (contest_id, user_id, lineup, ranks, meta, submitted_at)
    VALUES (${contestId}, ${userId}, ${patchJson}::jsonb, ${ranksJson}::jsonb,
            jsonb_build_object('picked_at', ${stamp}::jsonb), ${stampAt}::timestamptz)
    ON CONFLICT (contest_id, user_id)
    DO UPDATE SET lineup = contest_entries.lineup || ${patchJson}::jsonb,
                  ranks = ${ranksJson}::jsonb,
                  meta = COALESCE(contest_entries.meta, '{}'::jsonb) || jsonb_build_object('picked_at',
                    COALESCE(contest_entries.meta->'picked_at', '{}'::jsonb) || ${stamp}::jsonb),
                  updated_at = now(), submitted_at = EXCLUDED.submitted_at`;
  return { ok: true, ranks: sheet.ranks, saved: changed.length };
}
