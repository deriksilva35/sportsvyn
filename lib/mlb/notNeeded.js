// lib/mlb/notNeeded.js - a decided series' remaining games are NOT NEEDED, and
// we say so ourselves (thu-26, 1 Oct 2026).
//
// THE RECEIPT. Three Wild Card series ended 2-0 on 30 Sep. Their game 3s stayed
// on /scores as upcoming games, on October's 1 Oct card (three of its four
// games, and the contest's lock taken from the last of them), and in the card's
// player pool. The feed never said they were off: it stopped listing them, and
// the resync turned that silence into 'cancelled' hours later, one series at a
// time - 00:50Z, 04:50Z, 08:50Z.
//
// THE RULE. When a series has a winner, every one of its games that is not
// final is 'not_needed' - written by mlb-advance on the run after the clinch,
// logged, and never waiting on the provider. The schedule writer will not flip
// it back (lib/mlb/schedule.js), and the readers skip it.
//
// PURE first (which ids), then the one write.

import { NOT_PLAYED } from './status.js';
import { instantsOf, maxOf } from '../util/scoresOf.js';

/** Statuses a decided series' leftover game can be in when it is marked. */
const MARKABLE = new Set(['scheduled', 'postponed', 'cancelled']);

/**
 * WHICH GAMES ARE NOT NEEDED. `series` is lib/mlb/series.js shapeSeries output.
 * A series with no winner gives nothing - an undecided series' game 3 is the
 * most needed game there is. A live or final game is never marked: a series
 * cannot be decided while one of its games is in progress, and if the rows
 * say otherwise the rows are wrong and nothing here should act on them.
 */
export function notNeededGames(series = []) {
  const out = [];
  for (const s of series) {
    if (s?.winner == null) continue;
    for (const g of s.games ?? []) {
      if (MARKABLE.has(g.status)) out.push({ id: Number(g.id), slug: g.slug, series: s.key, from: g.status });
    }
  }
  return out;
}

/**
 * Mark them. Returns what was marked, for the import's log. The WHERE repeats
 * the status test so a game that went live between the read and the write is
 * left alone.
 *
 * THE OCTOBER DAY FOLLOWS. A contest's locks_at is its LAST first pitch, taken
 * when the day was created; a day whose last game is now not needed would keep
 * its join window open to a game that will never start. Unsettled October
 * contests holding a marked game get locks_at re-taken from their remaining
 * games (the later of frozen and current first pitch, as the slot locks read
 * it - lib/october/rules.js effectiveKickoff).
 */
export async function markNotNeeded(sql, series, { dryRun = false } = {}) {
  const games = notNeededGames(series);
  if (!games.length || dryRun) return { marked: [], wouldMark: games, relocked: [] };
  const ids = games.map((g) => g.id);
  const rows = await sql`
    UPDATE matches SET status = 'not_needed', updated_at = now()
     WHERE id = ANY(${ids}) AND status IN ('scheduled', 'postponed', 'cancelled')
     RETURNING id`;
  const done = new Set(rows.map((r) => Number(r.id)));
  const relocked = await relockOctober(sql, ids);
  return { marked: games.filter((g) => done.has(g.id)), wouldMark: games, relocked };
}

async function relockOctober(sql, ids) {
  const contests = await sql`
    SELECT c.id, c.locks_at, c.board FROM contests c
     WHERE c.game_type = 'october' AND NOT c.settled
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(c.board) g
                    WHERE (g->>'match_id')::int = ANY(${ids}))`;
  const out = [];
  for (const c of contests) {
    const matchIds = (c.board ?? []).map((g) => Number(g.match_id));
    const live = await sql`SELECT id, status, kickoff_at FROM matches WHERE id = ANY(${matchIds})`;
    const by = new Map(live.map((m) => [Number(m.id), m]));
    const kos = (c.board ?? [])
      .filter((g) => !NOT_PLAYED.includes(by.get(Number(g.match_id))?.status))
      .map((g) => maxOf(instantsOf([g.kickoff_at, by.get(Number(g.match_id))?.kickoff_at])))
      .filter((t) => t != null);
    if (!kos.length) continue; // a day with nothing left to play keeps its row as it was
    const lock = new Date(Math.max(...kos)).toISOString();
    if (new Date(c.locks_at).toISOString() === lock) continue;
    await sql`UPDATE contests SET locks_at = ${lock} WHERE id = ${c.id} AND NOT settled`;
    out.push({ id: c.id, from: new Date(c.locks_at).toISOString(), to: lock });
  }
  return out;
}
