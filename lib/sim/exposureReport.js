// lib/sim/exposureReport.js — the Draft Pass's anchor feature. Aggregates the
// user's own draft picks across completed drafts into an honest v1 exposure view:
//   · most-drafted players (count + % of drafts, avg round)
//   · value tendency by round: avg (ADP - overall pick) — positive = value (got
//     the player later than ADP), negative = reach
// Aggregation only, no new tables. The SQL fetches the user's picks; the pure
// aggregateExposure() does the math (unit-tested with synthetic picks).

import { sql } from '../db.js';

const round1 = (x) => Math.round(x * 10) / 10;

export function aggregateExposure(picks, draftCount) {
  const players = new Map();
  const rounds = new Map();
  let valSum = 0;
  let valN = 0;

  for (const p of picks) {
    const pl = players.get(p.player_name) ?? { player: p.player_name, position: p.position, count: 0, roundSum: 0 };
    pl.count += 1;
    pl.roundSum += Number(p.round);
    players.set(p.player_name, pl);

    if (p.adp != null && p.overall_pick != null) {
      const v = Number(p.adp) - Number(p.overall_pick); // + value (later than ADP), - reach
      const r = rounds.get(p.round) ?? { round: p.round, sum: 0, n: 0 };
      r.sum += v;
      r.n += 1;
      rounds.set(p.round, r);
      valSum += v;
      valN += 1;
    }
  }

  const mostDrafted = [...players.values()]
    .map((pl) => ({
      player: pl.player,
      position: pl.position,
      count: pl.count,
      pctOfDrafts: draftCount > 0 ? round1((pl.count / draftCount) * 100) : 0,
      avgRound: round1(pl.roundSum / pl.count),
    }))
    .sort((a, b) => b.count - a.count || a.avgRound - b.avgRound)
    .slice(0, 12);

  const valueByRound = [...rounds.values()]
    .map((r) => ({ round: r.round, avgValue: round1(r.sum / r.n), n: r.n }))
    .sort((a, b) => a.round - b.round);

  const avgValue = valN > 0 ? round1(valSum / valN) : null;
  const lean = avgValue == null ? 'even' : avgValue > 1 ? 'value' : avgValue < -1 ? 'reach' : 'even';

  return { draftCount, totalPicks: picks.length, mostDrafted, valueByRound, overallLean: { avgValue, lean } };
}

const EMPTY = { draftCount: 0, totalPicks: 0, mostDrafted: [], valueByRound: [], overallLean: { avgValue: null, lean: 'even' } };

export async function getExposureReport(userId) {
  if (userId == null) return EMPTY;
  const draftCount = (await sql`
    SELECT count(*)::int n FROM drafts WHERE user_id = ${userId} AND status = 'completed'`)[0]?.n ?? 0;
  if (draftCount === 0) return EMPTY;
  const picks = await sql`
    SELECT dp.player_name, dp.position, dp.round, dp.overall_pick, dp.adp_at_pick::float AS adp
      FROM draft_picks dp
      JOIN drafts d ON d.id = dp.draft_id
     WHERE d.user_id = ${userId} AND d.status = 'completed' AND dp.picked_by = 'user'`;
  return aggregateExposure(picks, draftCount);
}
