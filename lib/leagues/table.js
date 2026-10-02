// lib/leagues/table.js - one league's page data: the standings (FINAL results
// only), this bucket so far (provisional results too), and the labels. The
// rules are lib/leagues/standings.js's; the rows are lib/leagues/results.js's.
//
// THE WINDOW FOLLOWS THE SPAN: a season table counts every finished bucket
// since the start; a daily or weekly league names a fresh winner each bucket,
// so its table is the latest bucket with a final result.

import { sql } from '../db.js';
import { computeStandings } from './standings.js';
import { loadLeagueResults, bucketLabel, shapeResults, bucketUnit } from './results.js';

/** Pure: shaped results -> the page's numbers. */
export function buildTable({ league, members, results, nflWeeks = new Map(), unit }) {
  const finals = results.filter((r) => r.final);
  const finalBuckets = [...new Set(finals.map((r) => r.bucket))].sort();
  const window = league.span === 'season' ? finalBuckets : finalBuckets.slice(-1);
  const standings = computeStandings({
    members, results: finals.filter((r) => window.includes(r.bucket)),
    scoring: league.scoring, dropWorst: league.drop_worst && league.span === 'season', bucketOrder: window,
  });
  const allBuckets = [...new Set(results.map((r) => r.bucket))].sort();
  const live = allBuckets[allBuckets.length - 1] ?? null;
  const thisBucket = computeStandings({
    members, results: results.filter((r) => r.bucket === live), scoring: league.scoring, bucketOrder: live ? [live] : [],
  });
  const liveFinal = live != null && results.filter((r) => r.bucket === live).every((r) => r.final);
  return {
    unit, standings, thisBucket, live, liveFinal,
    liveLabel: live ? bucketLabel(live, unit, nflWeeks) : null,
    tableLabel: window.length ? bucketLabel(window[window.length - 1], unit, nflWeeks) : null,
    labels: Object.fromEntries([...new Set([...allBuckets, ...window])].map((b) => [b, bucketLabel(b, unit, nflWeeks)])),
  };
}

export async function leagueTable(league, { now = new Date() } = {}) {
  const gameRows = await sql`SELECT game_type, sport FROM player_league_games WHERE league_id = ${league.id}`;
  const members = league.members.map((m) => ({ userId: Number(m.user_id), handle: m.handle }));
  const loaded = await loadLeagueResults({ ...league, gameRows }, members.map((m) => m.userId), { now });
  return buildTable({ league, members, ...loaded });
}

export { shapeResults, bucketUnit };
