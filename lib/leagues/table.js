// lib/leagues/table.js - one league's page data: the standings (FINAL results
// only), this bucket so far (provisional results too), and the labels. The
// rules are lib/leagues/standings.js's; the rows are lib/leagues/results.js's.
//
// THE WINDOW FOLLOWS THE SPAN: a season table counts every finished bucket
// since the start; a daily or weekly league names a fresh winner each bucket,
// so its table is the latest bucket with a final result.

//
// THE LEAGUE HOME (thu-4) adds the PERIOD CHIPS (Season · This week · the last
// two final days, lib/leagues/home.js) - the window is the chip's - and, in a
// league of several games, CREW POINTS (lib/leagues/crew.js): the "All games"
// table, or one game's own table under the league's scoring.

import { sql } from '../db.js';
import { computeStandings } from './standings.js';
import { loadLeagueResults, bucketLabel, shapeResults, bucketUnit, tuesdayOf } from './results.js';
import { periodChips, parsePeriod, windowFor, lastColLabel, rowExtras } from './home.js';
import { isCrewLeague, crewTable, crewThisWeek } from './crew.js';
import { etDateOf } from './start.js';

/** Pure: shaped results -> the page's numbers. */
export function buildTable({ league, members, results, nflWeeks = new Map(), unit, chopped = [], period = null, now = new Date() }) {
  const finals = results.filter((r) => r.final);
  const finalBuckets = [...new Set(finals.map((r) => r.bucket))].sort();
  const today = etDateOf(new Date(now));
  const chipLabels = Object.fromEntries(finalBuckets.map((b) => [b, bucketLabel(b, unit, nflWeeks)]));
  // A GUILLOTINE has no period chips: its board is who is still standing.
  const chips = league.format === 'guillotine' ? [] : periodChips({ span: league.span, unit, finalBuckets, labels: chipLabels });
  const periodKey = parsePeriod(period, chips);
  const window = chips.length
    ? windowFor(periodKey, { span: league.span, unit, finalBuckets, today })
    : (league.span === 'season' ? finalBuckets : finalBuckets.slice(-1));
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
  // THE GUILLOTINE (P3): who is still standing, who is on the block in the live
  // bucket so far (the lowest live total among the standing - provisional, the
  // cron decides), and who went in which bucket.
  const out = new Map(chopped.map((c) => [c.userId, c.bucket]));
  const standing = thisBucket.rows.filter((r) => !out.has(r.userId)).sort((a, b) => b.current - a.current);
  // Everyone level (nobody has played yet) puts nobody on the block.
  const low = standing.length > 1 && new Set(standing.map((r) => r.current)).size > 1
    ? Math.min(...standing.map((r) => r.current)) : null;
  const guillotine = league.format === 'guillotine' ? {
    standing: standing.map((r) => ({ ...r, onBlock: low != null && r.current === low })),
    chopped: chopped.slice().sort((a, b) => (a.bucket < b.bucket ? 1 : -1))
      .map((c) => ({ ...c, handle: members.find((m) => m.userId === c.userId)?.handle ?? null, label: bucketLabel(c.bucket, unit, nflWeeks) })),
  } : null;
  const extras = rowExtras(standings.rows, finals, window);
  return {
    unit, standings, thisBucket, live, liveFinal, guillotine,
    chips, period: periodKey, window, lastCol: lastColLabel({ unit, window, today }),
    extras: Object.fromEntries(extras),
    liveLabel: live ? bucketLabel(live, unit, nflWeeks) : null,
    tableLabel: window.length ? bucketLabel(window[window.length - 1], unit, nflWeeks) : null,
    labels: Object.fromEntries([...new Set([...allBuckets, ...window])].map((b) => [b, bucketLabel(b, unit, nflWeeks)])),
  };
}

/**
 * PURE: the crew layer over loaded results. game: 'all' or one game key.
 * -> { games: [key], game, table?, week? } (table/week only for 'all')
 */
export function buildCrew({ league, members, results, game = null, now = new Date() }) {
  const games = league.games ?? [];
  const g = games.includes(game) ? game : 'all';
  if (g !== 'all') return { games, game: g };
  return {
    games, game: g,
    table: crewTable({ members, results, now }),
    week: crewThisWeek({ members, results, now }),
  };
}

export async function leagueTable(league, { now = new Date(), period = null, game = null } = {}) {
  const gameRows = await sql`SELECT game_type, sport FROM player_league_games WHERE league_id = ${league.id}`;
  const members = league.members.map((m) => ({ userId: Number(m.user_id), handle: m.handle }));
  const loaded = await loadLeagueResults({ ...league, gameRows }, members.map((m) => m.userId), { now });
  const chopped = league.format === 'guillotine'
    ? (await sql`SELECT user_id, period_key FROM player_league_eliminations WHERE league_id = ${league.id}`)
      .map((e) => ({ userId: Number(e.user_id), bucket: e.period_key }))
    : [];
  if (!isCrewLeague(league.games ?? [])) return buildTable({ league, members, ...loaded, chopped, period, now });
  // A CREW LEAGUE: "All games" is the crew table; a game chip is that game's
  // own table, in that game's own unit, under the league's scoring.
  const crew = buildCrew({ league, members, results: loaded.results, game, now });
  if (crew.game === 'all') return { ...buildTable({ league, members, ...loaded, chopped, period, now }), crew };
  const unit = bucketUnit({ span: league.span, games: [crew.game] });
  const one = shapeAgain(loaded.results.filter((r) => r.game === crew.game), unit);
  return { ...buildTable({ league, members, results: one, nflWeeks: loaded.nflWeeks, unit, chopped, period, now }), crew };
}

/** Re-bucket results for a different unit (a game chip in a crew league). */
function shapeAgain(results, unit) {
  return results.map((r) => {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(r.period) ? r.period : r.bucket;
    return { ...r, bucket: unit === 'week' ? tuesdayOf(day) : day };
  });
}
