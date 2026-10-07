// lib/nba/dayPickem.js - the DAILY NBA PICK'EM: one board per ET day.
//
// IT IS THE SAME CONTEST ROW AS FOOTBALL'S. game_type 'pickem', sport 'nba',
// the board jsonb in the football shape ({match_id, slug, kickoff_at, home,
// away, home_team_id, away_team_id}), the lineup a flat {match_id: side}, the
// same savePick door, the same settle loop, the same board page. What makes it
// a DAY BOARD is meta.day_board = true and meta.day_et = 'YYYY-MM-DD' - asked
// of the row, never of the sport (the series board's rule: `sport === 'nba'`
// would be a claim about every NBA board this product may ever have).
//
// THE KEY. week = the ET day as an integer, YYYYMMDD (20261020). It is a pure
// function of the day, so a re-derivation can never disagree with a stored
// row, and 067's unique (game_type, sport, season_year, week) makes a second
// board for one day impossible. It is a KEY, never a label: display copy reads
// meta.day_et.
//
// THE LOCK READS matches.kickoff_at, NOT THE SNAPSHOT (Derik's ruling, Phase
// B). Football's boards seal each game at the kickoff frozen into the board at
// creation (067's locks-don't-chase law). An NBA tip is not settled until it
// happens - the 20 Oct opener is filed at a placeholder 19:00Z, and the hourly
// re-sync (lib/nba/schedule.js) and the live poller both re-write kickoff_at -
// so every decision on a day board reads the row's CURRENT kickoff_at at the
// moment it decides:
//   - savePick (lib/pickem/entry.js) refuses a game whose current tip has
//     passed, or whose status has left 'scheduled';
//   - the settle (settleDayBoard below) re-reads every tip and drops any pick
//     stamped at or after it (a tip moved EARLIER underneath a saved pick);
//   - the view and the lobby row draw the current tip, not the frozen one.
// The board's own kickoff_at is kept for order and for the shared readers that
// expect it; it decides nothing here.
//
// A GAME THAT DOES NOT HAPPEN IS VOID FOR EVERYONE. cancelled / not_needed
// (lib/mlb/status.js NOT_PLAYED) and postponed: the result is null, which every
// scorer and table in lib/pickem already reads as "off the board" - neither a
// win, a loss nor a game played. Basketball has no draws, so a final always has
// a winner; winnerOf()'s null-on-level is defended anyway.

import { sql } from '../db.js';
import { easternLocalToUtc } from '../gridiron/ingest.js';
import { winnerOf } from '../pickem/view.js';
import { isGameLocked, isKickoffTbd } from '../mlb/kickoffTbd.js';
import { VOID_STATUSES, isVoidStatus, dayLabel } from './dayRules.js';
import { stampsConfidence, NBA_MIN_GAMES } from '../pickem/confidence.js';
import { rolloverAfterCreate } from '../leagues/rollover.js';

export { VOID_STATUSES, isVoidStatus, dayLabel };

export const NBA_SPORT = 'nba';
/** A day board opens at this ET wall time (never after its first tip). */
export const OPEN_ET = '06:00:00';

/** IS THIS A DAY BOARD? Asked of the row. PURE. */
export function isDayBoard(contest) {
  return contest?.meta?.day_board === true;
}

/** The ET calendar day of an instant, 'YYYY-MM-DD'. Day bucketing of a STORED
 * instant (lib/today/signals.js's own expression), not a provider conversion. */
export function etDay(instant = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(instant));
}

/** 'YYYY-MM-DD' -> 20261020, the contest's week key. PURE. */
export function dayKey(dayEt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayEt ?? ''));
  return m ? Number(`${m[1]}${m[2]}${m[3]}`) : null;
}

/** The day before an ET day string. PURE (calendar arithmetic on a date). */
export function previousDay(dayEt) {
  const t = Date.parse(`${dayEt}T12:00:00Z`) - 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * THE LOCK, one rule. A game on a day board is locked when its CURRENT tip has
 * passed or it has left 'scheduled' (started early, gone final, been called
 * off). `<=` at the boundary. PURE: the caller supplies the row it just read.
 */
export function dayGameLocked(match, now = new Date()) {
  // ONE RULE, lib/mlb/kickoffTbd.js: a TBD game (flag on the row) never locks
  // on its midnight-ET placeholder; it locks at the real time once one posts.
  return isGameLocked(match, now);
}

/** The day's slate: every game whose CURRENT tip falls on the ET day, tip order.
 * A game already void when the board is built is left off - nobody can pick it. */
async function daySlate(leagueSlug, dayEt) {
  return sql`
    SELECT m.id AS match_id, m.slug, m.kickoff_at, m.season_year, m.status,
           m.home_team_id, m.away_team_id,
           COALESCE(ht.short_name, ht.name) AS home,
           COALESCE(at.short_name, at.name) AS away
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
      JOIN teams ht ON ht.id = m.home_team_id
      JOIN teams at ON at.id = m.away_team_id
     WHERE l.slug = ${leagueSlug}
       -- DAY BUCKETING of a STORED timestamptz (lib/pickem/create.js's own
       -- note): not the provider-datetime conversion ingest.js reserves.
       AND (m.kickoff_at AT TIME ZONE 'America/New_York')::date = ${dayEt}::date
       AND m.status <> ALL(${VOID_STATUSES}::text[])
     ORDER BY m.kickoff_at ASC, m.id ASC`;
}

/**
 * The plan for one ET day's board, WITHOUT writing. ensureNbaDayBoard()
 * consumes it, and the preopen ghost reads it.
 *
 * dayEt omitted means the ET day of the NEXT game still to tip.
 */
export async function nbaDayBoardPlan({ leagueSlug = NBA_SPORT, sport = leagueSlug, dayEt = null, now = new Date() } = {}) {
  let day = dayEt;
  if (!day) {
    const [r] = await sql`
      SELECT min(m.kickoff_at) AS ko FROM matches m JOIN leagues l ON l.id = m.league_id
       WHERE l.slug = ${leagueSlug} AND m.kickoff_at >= ${new Date(now).toISOString()}
         AND m.status = 'scheduled'`;
    if (!r?.ko) return { plan: null, reason: 'no-upcoming-games' };
    day = etDay(r.ko);
  }
  const slate = await daySlate(leagueSlug, day);
  if (!slate.length) return { plan: null, reason: 'no-games-today', dayEt: day };

  const firstTip = new Date(slate[0].kickoff_at);
  const lastTip = new Date(slate[slate.length - 1].kickoff_at);
  const openAt = new Date(await easternLocalToUtc(`${day} ${OPEN_ET}`));
  const opensAt = new Date(Math.min(openAt.getTime(), firstTip.getTime()));
  // CONFIDENCE NEEDS A SLATE TO RANK (ruling tue-7): from the confidence start,
  // a night with fewer than three games gets no board at all. Before it, the
  // old rule stands - any night with a game has a board.
  const confidence = stampsConfidence(sport, opensAt);
  if (confidence && slate.length < NBA_MIN_GAMES) {
    return { plan: null, reason: 'thin-slate', dayEt: day, games: slate.length };
  }
  return {
    plan: {
      sport,
      dayEt: day,
      seasonYear: slate[0].season_year,
      week: dayKey(day),
      // OPENS AT 6 AM ET - after the previous night's last game has ended - and
      // never after the first tip, so an early international tip still opens.
      opensAt,
      confidence,
      // THE JOIN WINDOW'S CLOSE, the football convention: the LAST tip. It is
      // refreshed from matches every hour (refreshDayBoardLocks); the per-game
      // lock never reads it.
      locksAt: lastTip,
      firstKickoff: firstTip,
      // ADVISORY ONLY - the gate decides; the stale alarm adds 48h to this.
      settlesAt: new Date(lastTip.getTime() + 6 * 3_600_000),
      board: slate.map((g) => ({
        match_id: g.match_id,
        slug: g.slug,
        kickoff_at: new Date(g.kickoff_at).toISOString(),
        home_team_id: g.home_team_id,
        away_team_id: g.away_team_id,
        home: g.home,
        away: g.away,
      })),
    },
    reason: null,
  };
}

/**
 * Create TODAY's board (the ET day of `now`) once its open has arrived.
 * IDEMPOTENT the house way: existence check on the day key, then an insert a
 * race loses harmlessly against 067's unique index.
 */
export async function ensureNbaDayBoard({ leagueSlug = NBA_SPORT, sport = leagueSlug, dayEt = null, now = new Date() } = {}) {
  const day = dayEt ?? etDay(now);
  const existing = await sql`
    SELECT id FROM contests WHERE game_type = 'pickem' AND sport = ${sport} AND week = ${dayKey(day)}`;
  if (existing.length) return { id: existing[0].id, created: false, reason: 'exists', dayEt: day };

  const { plan, reason } = await nbaDayBoardPlan({ leagueSlug, sport, dayEt: day, now });
  if (!plan) return { created: false, reason, dayEt: day };
  if (new Date(now) < plan.opensAt) {
    return { created: false, reason: 'before-open', dayEt: day, opensAt: plan.opensAt.toISOString() };
  }
  const meta = { day_board: true, day_et: plan.dayEt, ...(plan.confidence ? { scoring: 'confidence' } : {}) };
  const r = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at, meta)
    VALUES ('pickem', ${plan.sport}, ${plan.seasonYear}, ${plan.week},
            ${JSON.stringify(plan.board)}::jsonb, ${plan.opensAt.toISOString()},
            ${plan.locksAt.toISOString()}, ${plan.settlesAt.toISOString()}, ${JSON.stringify(meta)}::jsonb)
    ON CONFLICT DO NOTHING
    RETURNING id`;
  if (!r.length) {
    const again = await sql`
      SELECT id FROM contests WHERE game_type = 'pickem' AND sport = ${plan.sport}
        AND season_year = ${plan.seasonYear} AND week = ${plan.week}`;
    return { id: again[0]?.id, created: false, reason: 'raced', dayEt: day };
  }
  // THE SAME STEP THAT STAMPS SCORING applies a league's queued format at the
  // next season's board (S2, lib/leagues/rollover.js).
  await rolloverAfterCreate({ sport: plan.sport, seasonYear: plan.seasonYear });
  return { id: r[0].id, created: true, dayEt: day, games: plan.board.length,
    locksAt: plan.locksAt.toISOString() };
}

/**
 * The board's games as they stand NOW: status, scores, live_state and the
 * CURRENT kickoff_at for each, keyed by match id.
 */
export async function currentGames(board) {
  const ids = (board ?? []).map((g) => Number(g.match_id));
  if (!ids.length) return new Map();
  const rows = await sql`
    SELECT id, status, home_score, away_score, kickoff_at, metadata->'live_state' AS live_state,
           COALESCE((metadata->>'kickoff_tbd')::boolean, false) AS kickoff_tbd
      FROM matches WHERE id = ANY(${ids})`;
  return new Map(rows.map((r) => [r.id, r]));
}

/** The board with each game's CURRENT tip written over the frozen one, in tip
 * order. PURE given the map currentGames() returned. */
export function withCurrentTips(board, byId) {
  return (board ?? [])
    .map((g) => {
      const row = byId.get(Number(g.match_id));
      const ko = row?.kickoff_at;
      // The TBD flag rides the board row so hasKicked() and the client agree.
      return ko ? { ...g, kickoff_at: new Date(ko).toISOString(), kickoff_tbd: row.kickoff_tbd === true } : g;
    })
    .sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at) || a.match_id - b.match_id);
}

/**
 * THE RESULTS, and the gate. A day board settles when every game on it is
 * final OR void. PURE given the rows.
 *   results: { [match_id]: 'home' | 'away' | null }   null = void
 */
export function dayResults(board, byId) {
  const results = {}; let remaining = 0; const voided = [];
  for (const g of board ?? []) {
    const m = byId.get(Number(g.match_id));
    const status = m?.status ?? 'scheduled';
    if (isVoidStatus(status)) { results[String(g.match_id)] = null; voided.push(Number(g.match_id)); continue; }
    if (status !== 'final') { remaining += 1; continue; }
    results[String(g.match_id)] = winnerOf(m);
  }
  return remaining
    ? { complete: false, remaining, results: null, voided }
    : { complete: true, remaining: 0, results, voided };
}

/**
 * THE SETTLE-TIME LOCK. A pick counts only if it was saved before the game's
 * CURRENT tip. The save already refuses a pick after the tip it could see; this
 * catches the tip that moved EARLIER after a pick was saved against the old
 * one. A pick with no stamp (none are written without one) is given the
 * benefit. PURE.
 * @returns {{ lineup, late }} lineup = the picks that count; late = the rest
 */
export function onTimePicks(lineup = {}, pickedAt = {}, byId = new Map()) {
  const kept = {}; const late = {};
  for (const [mid, side] of Object.entries(lineup ?? {})) {
    const at = pickedAt?.[mid];
    const row = byId.get(Number(mid));
    const tip = row?.kickoff_at;
    // A TBD tip is a placeholder, not a tip: a pick saved after it was saved
    // before any real first pitch, and it scores.
    if (at && tip && !isKickoffTbd(row) && new Date(at).getTime() >= new Date(tip).getTime()) {
      late[mid] = { side, picked_at: at, tip: new Date(tip).toISOString() };
    } else kept[mid] = side;
  }
  return { lineup: kept, late };
}

/**
 * Settle one day board. Called by lib/pickem/settle.js when the row it holds is
 * a day board. Idempotent: the final UPDATE is guarded by NOT settled.
 */
export async function settleDayBoard(contest) {
  const board = contest.board ?? [];
  const byId = await currentGames(board);
  const r = dayResults(board, byId);
  if (!r.complete) return { contestId: contest.id, settled: false, remaining: r.remaining };
  if (board.length > 0 && r.voided.length === board.length) {
    // EVERY GAME VOID is not a day (ruling sun-12 a): CLOSED AS VOID -
    // settled, meta.void_all, meta.void = every game, entries unscored, no
    // rank, perfect null, and settled:false in the result so no hook fires.
    const { closeVoidAll } = await import('../settle/voidRule.js');
    const { closed, void: ids } = await closeVoidAll(sql, contest.id, r.voided);
    return { contestId: contest.id, settled: false, dayBoard: true, voidAll: true, closed, void: ids };
  }
  const { scoreLineup } = await import('../pickem/settle.js');

  const { isConfidence, scoreConfidence } = await import('../pickem/confidence.js');
  const confidence = isConfidence(contest);
  const entries = await sql`
    SELECT id, lineup, ranks, meta FROM contest_entries WHERE contest_id = ${contest.id}`;
  let lateTotal = 0;
  for (const e of entries) {
    const { lineup, late } = onTimePicks(e.lineup ?? {}, e.meta?.picked_at ?? {}, byId);
    const lateKeys = Object.keys(late);
    lateTotal += lateKeys.length;
    if (confidence) {
      // THE LATE PICK'S RANK GOES WITH IT: the stripped game is an unpicked game
      // (earns 0, keeps a slot in max - scoreConfidence hands the freed number back).
      const stored = Object.fromEntries(Object.entries(e.ranks ?? {}).filter(([k]) => !(k in late)));
      const { score, max } = scoreConfidence({ board, lineup, ranks: stored, results: r.results });
      await sql`
        UPDATE contest_entries
           SET lineup = lineup - ${lateKeys}::text[],
               ranks = ${JSON.stringify(stored)}::jsonb,
               meta = CASE WHEN ${lateKeys.length}::int > 0
                           THEN COALESCE(meta, '{}'::jsonb) || jsonb_build_object('late_picks', ${JSON.stringify(late)}::jsonb)
                           ELSE meta END,
               score = ${score}, base_score = ${score}, max_score = ${max},
               locked_at = COALESCE(locked_at, now()), updated_at = now()
         WHERE id = ${e.id}`;
      continue;
    }
    const score = scoreLineup(lineup, r.results);
    // A LATE PICK LEAVES THE LINEUP, so every reader that grades from the
    // lineup (the season table, the grade card, the receipt) agrees with the
    // score. It is kept, whole, under meta.late_picks - a top-level key of
    // ours, so the shallow || is exact here.
    await sql`
      UPDATE contest_entries
         SET lineup = lineup - ${lateKeys}::text[],
             meta = CASE WHEN ${lateKeys.length}::int > 0
                         THEN COALESCE(meta, '{}'::jsonb) || jsonb_build_object('late_picks', ${JSON.stringify(late)}::jsonb)
                         ELSE meta END,
             score = ${score}, base_score = ${score},
             locked_at = COALESCE(locked_at, now()), updated_at = now()
       WHERE id = ${e.id}`;
  }
  const played = Object.values(r.results).filter((v) => v != null).length;
  await sql`
    UPDATE contests
       SET settled = true, settled_at = now(),
           perfect = ${JSON.stringify({ results: r.results, max: played, void: r.voided })}::jsonb
     WHERE id = ${contest.id} AND NOT settled`;
  // dayBoard rides the result so pickem-settle's push hook can leave it out
  // (no NBA push copy in this phase).
  return { contestId: contest.id, settled: true, dayBoard: true, entries: entries.length, voided: r.voided.length, late: lateTotal };
}

/**
 * KEEP locks_at TRUE. A day board's locks_at is its last tip, and tips move.
 * Refreshed from matches for every unsettled day board of the sport; void
 * games do not hold the window open. Returns the boards it moved.
 */
export async function refreshDayBoardLocks({ sport = NBA_SPORT } = {}) {
  return sql`
    UPDATE contests c
       SET locks_at = t.last_tip
      FROM (
        SELECT c2.id, max(m.kickoff_at) AS last_tip
          FROM contests c2
          CROSS JOIN LATERAL jsonb_array_elements(c2.board) g
          JOIN matches m ON m.id = (g->>'match_id')::int
         WHERE c2.game_type = 'pickem' AND c2.sport = ${sport} AND NOT c2.settled
           AND COALESCE((c2.meta->>'day_board')::boolean, false)
           AND m.status <> ALL(${VOID_STATUSES}::text[])
         GROUP BY c2.id) t
     WHERE c.id = t.id AND t.last_tip IS NOT NULL AND c.locks_at IS DISTINCT FROM t.last_tip
    RETURNING c.id, c.locks_at`;
}

/**
 * THE HOURLY TICK, run by /api/cron/nba-schedule after the re-sync (so it reads
 * the tips the re-sync just wrote): open today's board, keep every open board's
 * window true, settle what is complete. Each step is caught on its own - a
 * failed open must not stop yesterday's board from settling.
 */
export async function nbaPickemTick({ now = new Date(), sport = NBA_SPORT, leagueSlug = sport } = {}) {
  const out = {};
  out.board = await ensureNbaDayBoard({ leagueSlug, sport, now }).catch((e) => ({ error: String(e?.message ?? e) }));
  out.locks = await refreshDayBoardLocks({ sport }).then((r) => r.length).catch((e) => ({ error: String(e?.message ?? e) }));
  const { settleDuePickem } = await import('../pickem/settle.js');
  out.settle = await settleDuePickem({ now, sport }).catch((e) => ({ error: String(e?.message ?? e) }));
  return out;
}

/** The day board for an ET day, or null. */
export async function dayBoardFor({ sport = NBA_SPORT, dayEt }) {
  const [c] = await sql`
    SELECT id, sport, season_year, week, board, opens_at, locks_at, settled, settled_at, meta, perfect
      FROM contests
     WHERE game_type = 'pickem' AND sport = ${sport} AND week = ${dayKey(dayEt)}
     LIMIT 1`;
  return c ?? null;
}
