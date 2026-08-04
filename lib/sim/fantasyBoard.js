// lib/sim/fantasyBoard.js — global (all-users) fantasy reads for the league-page
// Fantasy Board. Most-drafted REUSES aggregateExposure (the per-user exposure
// aggregator from exposureReport.js) fed the whole draft population instead of one
// user's picks.
//
// ADP MOVERS USED TO LIVE HERE (MOVERS_POOL / adpMovers / getAdpMovers) and were
// deleted when the gated Movement board took over ADP movement. They diffed the
// two most-recent snapshots of the ppr/12 pool with no epoch and no sample floor.
// Anything needing ADP movement now reads lib/fantasy/movement.js, which gates
// every column on the history it actually has.

import { sql } from '../db.js';
import { aggregateExposure } from './exposureReport.js';

// Most-drafted across ALL completed drafts' user picks. { draftCount, mostDrafted }.
//
// SIM DRAFTS ONLY (mode = 'sim'). This board is a public read of how the mock-draft
// population behaves. Tracker drafts are records of real draft rooms — arguably
// richer signal, but a DIFFERENT claim, and folding them in would silently change
// what the number on a public page means. Both the draftCount denominator and the
// pick numerator carry the filter; filtering only one would report a real rate
// against a mock population.
export async function getGlobalMostDrafted(limit = 10) {
  const draftCount = (await sql`SELECT count(*)::int n FROM drafts WHERE status = 'completed' AND mode = 'sim'`)[0]?.n ?? 0;
  if (draftCount === 0) return { draftCount: 0, mostDrafted: [] };
  const picks = await sql`
    SELECT dp.player_name, dp.position, dp.round, dp.overall_pick, dp.adp_at_pick::float AS adp
      FROM draft_picks dp
      JOIN drafts d ON d.id = dp.draft_id
     WHERE d.status = 'completed' AND d.mode = 'sim' AND dp.picked_by = 'user'`;
  const agg = aggregateExposure(picks, draftCount);
  return { draftCount, mostDrafted: agg.mostDrafted.slice(0, limit) };
}
