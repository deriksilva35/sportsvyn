// lib/sim/fantasyBoard.js — global (all-users) fantasy reads for the league-page
// Fantasy Board. Most-drafted REUSES aggregateExposure (the per-user exposure
// aggregator from exposureReport.js) fed the whole draft population instead of one
// user's picks. ADP movers diff the two most-recent FFC snapshots — dormant until
// a second snapshot exists (never inferred from one).

import { sql } from '../db.js';
import { aggregateExposure } from './exposureReport.js';

// Most-drafted across ALL completed drafts' user picks. { draftCount, mostDrafted }.
export async function getGlobalMostDrafted(limit = 10) {
  const draftCount = (await sql`SELECT count(*)::int n FROM drafts WHERE status = 'completed'`)[0]?.n ?? 0;
  if (draftCount === 0) return { draftCount: 0, mostDrafted: [] };
  const picks = await sql`
    SELECT dp.player_name, dp.position, dp.round, dp.overall_pick, dp.adp_at_pick::float AS adp
      FROM draft_picks dp
      JOIN drafts d ON d.id = dp.draft_id
     WHERE d.status = 'completed' AND dp.picked_by = 'user'`;
  const agg = aggregateExposure(picks, draftCount);
  return { draftCount, mostDrafted: agg.mostDrafted.slice(0, limit) };
}

// The single pool the public board's movers are read from: the flagship launch
// preset (draft_configs id 1, "Standard 12 PPR" — also the highest-volume FFC feed
// by a wide margin). Movers MUST come from ONE (scoring_format, teams_count) pair.
// sim_player_pool holds one row per player PER PAIR, so an unscoped read returns
// four rows per player and, worse, silently diffs one format's ADP against
// another's: a QB's 2QB-format ADP (~51) against his standard ADP (~161) is a
// 110-pick "move" that never happened. Every early mover list was all-QB for
// exactly that reason.
export const MOVERS_POOL = { scoringFormat: 'ppr', teamsCount: 12 };

// Pure: current + prior snapshot rows -> biggest ADP movers. delta = prior.adp -
// current.adp (positive = rising, drafted earlier now). Unit-tested.
// CONTRACT: both arrays must come from a SINGLE pool pair, so ffc_player_id is
// unique within each. Callers other than getAdpMovers must honour that.
export function adpMovers(currentRows, priorRows, limit = 8) {
  const prior = new Map(priorRows.map((r) => [r.ffc_player_id, Number(r.adp)]));
  const movers = [];
  for (const r of currentRows) {
    const p = prior.get(r.ffc_player_id);
    if (p == null) continue;
    const delta = Math.round((p - Number(r.adp)) * 10) / 10;
    if (delta === 0) continue;
    movers.push({ name: r.name, position: r.position, adp: Number(r.adp), delta });
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return movers.slice(0, limit);
}

// ADP movers between the two most-recent snapshots OF THE FLAGSHIP POOL.
// { available:false } when only one snapshot exists (the board stays dormant —
// absence over inference). Both the snapshot-date lookup and the row loads are
// scoped to MOVERS_POOL: scoping only the loads would still let a date on which
// some OTHER pair was written become one of the two dates we diff, yielding an
// empty or half-empty comparison.
export async function getAdpMovers(limit = 8) {
  const { scoringFormat, teamsCount } = MOVERS_POOL;
  const snaps = (await sql`
    SELECT DISTINCT snapshot_date FROM sim_player_pool
     WHERE scoring_format = ${scoringFormat} AND teams_count = ${teamsCount}
     ORDER BY snapshot_date DESC LIMIT 2`).map((r) => r.snapshot_date);
  if (snaps.length < 2) return { available: false, movers: [] };
  const load = (d) => sql`
    SELECT ffc_player_id, name, position, adp FROM sim_player_pool
     WHERE snapshot_date = ${d}
       AND scoring_format = ${scoringFormat} AND teams_count = ${teamsCount}`;
  const [currentRows, priorRows] = await Promise.all([load(snaps[0]), load(snaps[1])]);
  return { available: true, movers: adpMovers(currentRows, priorRows, limit) };
}
