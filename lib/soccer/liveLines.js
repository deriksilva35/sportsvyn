// lib/soccer/liveLines.js - per-player lines for an EPL fixture IN PLAY.
//
// The live poller's /fixtures?ids= tick embeds each fixture's players and
// events. player_match_stats is written only at full time (and other readers
// show it), so the in-play lines go to their own table, epl_live_lines
// (migration 121): one row per fixture, replaced whole, in the SAME column
// vocabulary as player_match_stats so the scorer reads either through
// lib/eplWeekly5/scoring.js lineFromRow().

import { mapStatLine, factColumns } from './playerStatsImport.js';
import { playerMatchFacts } from './playerMatchFacts.js';

/** PURE. A fixture payload -> { "<provider id>": row }. */
export function linesFromFixture(f) {
  const facts = playerMatchFacts(f);
  const out = {};
  for (const t of f?.players ?? []) {
    for (const entry of t.players ?? []) {
      const id = entry?.player?.id;
      const stats = mapStatLine(entry?.statistics?.[0]);
      if (id == null || !stats) continue;
      out[String(id)] = { ...stats, ...factColumns(facts, id), team_api_id: t.team?.id ?? null };
    }
  }
  return out;
}

/** Replace one fixture's live lines. One statement. */
export async function writeLiveLines(sql, matchId, fixture) {
  if (!Array.isArray(fixture?.players) || !fixture.players.length) return { skipped: 'no players' };
  const lines = linesFromFixture(fixture);
  const elapsed = Number.isFinite(Number(fixture?.fixture?.status?.elapsed)) ? Number(fixture.fixture.status.elapsed) : null;
  await sql`
    INSERT INTO epl_live_lines (match_id, lines, elapsed, updated_at)
    VALUES (${matchId}, ${JSON.stringify(lines)}::jsonb, ${elapsed}, now())
    ON CONFLICT (match_id) DO UPDATE SET lines = EXCLUDED.lines, elapsed = EXCLUDED.elapsed, updated_at = now()`;
  return { wrote: Object.keys(lines).length };
}
