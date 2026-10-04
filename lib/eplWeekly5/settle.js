// lib/eplWeekly5/settle.js - grade a gameweek, and grade it again when a stat
// is corrected.
//
// THE GATE IS THE FIXTURES AND THE RE-CHECK, NOT THE CLOCK. A gameweek settles
// when every fixture on its board is final (or will not be played) AND each
// final's +24h re-sync has run (matches.metadata.epl_stats.resyncAt, written by
// lib/soccer/eplLive.js) - so the first grade is already the corrected one.
// A fixture whose re-sync never comes (its full-time stats never landed) cannot
// hold the week forever: RESYNC_GRACE_H after the last kickoff the gameweek
// settles on what is stored.
//
// A CORRECTION AFTER THE GRADE RE-GRADES. The +24h re-sync hands every changed
// fixture to RESETTLE_HOOKS; registerResettle() puts resettleForMatch there, and
// it re-runs this same settle for any settled gameweek holding that fixture.
// Idempotent: grading twice from the same rows writes the same numbers.

import { sql } from '../db.js';
import { GAME_KEY, SPORT, SLOTS, OFF_STATUSES } from './rules.js';
import { fixturesNow, linesFor, scoreSlot, pickPairs, teamConceded, cleanName } from './data.js';
import { lineFromRow, scoreLine, posOf } from './scoring.js';
import { perfectFive } from './board.js';

export const RESYNC_GRACE_H = 72;
// 'moved' too: a fixture re-dated out of the gameweek (rules.js) never holds it.
const OFF = new Set(OFF_STATUSES);

/** Is the gameweek ready to grade? PURE over the fixtures as read. */
export function settleGate(board = [], fx = new Map(), now = new Date()) {
  const waiting = [];
  let lastKo = -Infinity;
  for (const g of board) {
    const m = fx.get(String(g.match_id));
    const ko = new Date(m?.kickoff_at ?? g.kickoff_at).getTime();
    if (Number.isFinite(ko)) lastKo = Math.max(lastKo, ko);
    if (!m) { waiting.push({ slug: g.slug, why: 'missing' }); continue; }
    if (OFF.has(m.status)) continue;
    if (m.status !== 'final') { waiting.push({ slug: g.slug, why: m.status }); continue; }
    if (!m.resync_at) waiting.push({ slug: g.slug, why: 'recheck' });
  }
  const graceOver = Number.isFinite(lastKo) && new Date(now).getTime() > lastKo + RESYNC_GRACE_H * 3600e3;
  const blocking = waiting.filter((w) => w.why !== 'recheck' || !graceOver);
  return { ready: blocking.length === 0, waiting: blocking };
}

/**
 * Stored lines -> the perfect five's candidates, ONE PER PLAYER: a player with
 * two fixtures in the gameweek is the sum of both. PURE.
 */
export function perfectCandidates(rows = [], fx = new Map(), abbrOf = new Map()) {
  const by = new Map();
  for (const r of rows) {
    const pos = posOf(r.position);
    if (!pos) continue;
    const m = fx.get(String(r.match_id));
    const pts = scoreLine(lineFromRow(r, { position: pos, teamConceded: teamConceded(m, r.team_id) }), { final: true }).points;
    const k = String(r.player_id);
    const have = by.get(k);
    if (have) { have.points += pts; continue; }
    by.set(k, { playerId: k, pos, clubId: r.team_id, club: abbrOf.get(String(r.team_id)) ?? null, name: cleanName(r.name), points: pts });
  }
  return [...by.values()];
}

/** Grade one gameweek. `force` re-grades a settled one (the correction path). */
export async function settleGameweek(contest, { now = new Date(), force = false } = {}) {
  if (contest.settled && !force) return { contestId: contest.id, settled: true, skipped: 'already' };
  const board = contest.board ?? [];
  const ids = board.map((g) => g.match_id);
  const fx = await fixturesNow(board);
  const resync = ids.length ? await sql`
    SELECT id, metadata->'epl_stats'->>'resyncAt' AS resync_at FROM matches WHERE id = ANY(${ids})` : [];
  for (const r of resync) { const m = fx.get(String(r.id)); if (m) m.resync_at = r.resync_at; }
  const gate = settleGate(board, fx, now);
  if (!gate.ready) return { contestId: contest.id, settled: false, waitingOn: gate.waiting };

  const entries = await sql`SELECT id, lineup FROM contest_entries WHERE contest_id = ${contest.id}`;
  const pairs = entries.flatMap((e) => SLOTS.flatMap((s) => pickPairs(e.lineup?.[s], board)));
  const lines = await linesFor(pairs);
  for (const e of entries) {
    const slots = {};
    let total = 0;
    for (const s of SLOTS) {
      const p = e.lineup?.[s];
      if (!p?.playerId) continue;
      // EVERY FIXTURE HIS CLUB PLAYS ON THE BOARD (sat-5 E2), and THE GRADE
      // READS STORED STATS ONLY - never a provisional live line.
      const sc = scoreSlot(p, board, fx, lines, { statsOnly: true });
      slots[s] = sc.points ?? 0;
      total += sc.points ?? 0;
    }
    await sql`
      UPDATE contest_entries
         SET score = ${total}, base_score = ${total},
             meta = jsonb_set(CASE WHEN jsonb_typeof(meta) = 'object' THEN meta ELSE '{}'::jsonb END,
                              '{epl5}', ${JSON.stringify({ slots, graded_at: new Date(now).toISOString() })}::jsonb, true),
             locked_at = COALESCE(locked_at, now()), updated_at = now()
       WHERE id = ${e.id}`;
  }

  // THE PERFECT FIVE, from every stored line on the board's fixtures that
  // were played IN this gameweek (a 'moved' one's lines are another week's),
  // a double-gameweek player's two lines summed (sat-5 E2).
  const playedIds = ids.filter((id) => fx.get(String(id))?.status === 'final');
  const all = playedIds.length ? await sql`
    SELECT s.player_id, s.team_id, s.minutes_played, s.goals, s.assists, s.saves, s.yellow_cards, s.red_cards,
           s.own_goals, s.penalties_saved, s.penalties_missed, s.conceded_on_pitch, s.match_id,
           p.position, COALESCE(p.known_as, p.full_name) AS name
      FROM player_match_stats s JOIN players p ON p.id = s.player_id
     WHERE s.match_id = ANY(${playedIds}) AND s.minutes_played > 0 AND p.position IS NOT NULL` : [];
  const abbrOf = new Map(board.flatMap((g) => [[String(g.home?.id), g.home?.abbr], [String(g.away?.id), g.away?.abbr]]));
  const perfect = perfectFive(perfectCandidates(all, fx, abbrOf));
  await sql`
    UPDATE contests
       SET settled = true, settled_at = COALESCE(settled_at, now()),
           perfect = ${JSON.stringify(perfect ? { score: perfect.score, players: perfect.players } : null)}::jsonb
     WHERE id = ${contest.id}`;
  return { contestId: contest.id, settled: true, regraded: force && contest.settled, entries: entries.length, perfect: perfect?.score ?? null };
}

/** Every unsettled, opened gameweek. The cron calls this. */
export async function settleDueGameweeks({ now = new Date() } = {}) {
  const due = await sql`
    SELECT id, season_year, week, board, settled FROM contests
     WHERE game_type = ${GAME_KEY} AND sport = ${SPORT} AND NOT settled AND puzzle_date IS NULL
       AND opens_at <= ${new Date(now).toISOString()}
     ORDER BY season_year, week`;
  const out = [];
  for (const c of due) {
    try { out.push(await settleGameweek(c, { now })); } catch (e) { out.push({ contestId: c.id, error: String(e?.message ?? e) }); }
  }
  return { due: due.length, results: out };
}

/** The correction path: re-grade any SETTLED gameweek holding this fixture. */
export async function resettleForMatch({ matchId, now = new Date() } = {}) {
  const rows = await sql`
    SELECT id, season_year, week, board, settled FROM contests
     WHERE game_type = ${GAME_KEY} AND sport = ${SPORT} AND settled
       AND board @> ${JSON.stringify([{ match_id: Number(matchId) }])}::jsonb`;
  const out = [];
  for (const c of rows) out.push(await settleGameweek(c, { now, force: true }));
  return out;
}

/** Put the re-grade on the EPL poller's +24h hook point. Idempotent. */
export function registerResettle(hooks) {
  if (!hooks.some((h) => h?.eplWeekly5 === true)) {
    const hook = async ({ matchId }) => resettleForMatch({ matchId });
    hook.eplWeekly5 = true;
    hooks.push(hook);
  }
  return hooks;
}
