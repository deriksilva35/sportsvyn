// lib/results/pickem.js - Pick'em's results, which are a SCOREBOARD and not a
// lineup. The mock says so in its caption and the shape follows it: no `mine`
// and no `ceiling` columns, a grid of entries by games instead.
//
// THE CORRECT SIDE PER GAME IS STORED. contests.perfect =
// { max, results: { matchId: 'home'|'away' } }, written at settle. A game that
// is not in `results` has not been decided - the mock's DASHED square - which is
// a THIRD state and not a loss.
//
// THE BEST RECORD IS NOT STORED, unlike the other three games' ceilings.
// `perfect.max` is the PERFECT record (the game count), not the best entry's -
// so "Best 13-2 · 3 entries tied" is derived from the field, and the ceiling bar
// measures the reader against the best ENTRY, because a perfect card nobody
// filled in is not a ceiling anybody was competing with.

import { sql } from '../db.js';
import { pickemBoardLeaderboard } from '../games/leaderboard.js';
import { pickemRecord } from '../games/v3Rows.js';
import { header, distribution, axisFor, noEntryLine } from './shape.js';

/** PURE. One entry's squares, in the board's own game order. */
export function squares(lineup = {}, games = [], results = {}) {
  return games.map((g) => {
    const id = String(g.match_id ?? g.id);
    const pick = lineup?.[id] ?? null;
    const winner = results?.[id] ?? null;
    return {
      key: id,
      // THE COLUMN HEADER IS THE SIDE THE READER PICKED, which is what the mock
      // prints - "WAS", "MIN" - rather than the fixture, because sixteen
      // fixtures do not fit and the pick is the thing being graded.
      pick,
      abbr: pick === 'home' ? (g.home ?? null) : pick === 'away' ? (g.away ?? null) : null,
      state: winner == null ? 'pending' : pick == null ? 'none' : pick === winner ? 'win' : 'loss',
    };
  });
}

export async function pickemResults(contestId, userId = null) {
  const [contest] = await sql`
    SELECT id, sport, season_year, week, settled, settled_at, perfect, board
      FROM contests WHERE id = ${Number(contestId)} AND game_type = 'pickem'`;
  if (!contest) return null;

  const games = contest.board ?? [];
  const results = contest.perfect?.results ?? {};
  const decided = games.filter((g) => results[String(g.match_id ?? g.id)] != null).length;

  const entries = await sql`
    SELECT e.user_id, e.score, e.lineup, u.handle, u.is_house
      FROM contest_entries e JOIN users u ON u.id = e.user_id
     WHERE e.contest_id = ${Number(contestId)} AND e.score IS NOT NULL
     ORDER BY e.score DESC, e.user_id ASC`;

  const asGames = Object.entries(results).map(([id, winner]) => ({ id, status: 'final', winner }));
  const rows = entries.map((e, i) => {
    const rec = pickemRecord({ picks: e.lineup ?? {}, games: asGames });
    return {
      rank: i + 1, userId: e.user_id,
      name: e.handle ?? `player ${e.user_id}`,
      house: e.is_house === true,
      you: userId != null && e.user_id === Number(userId),
      correct: rec.correct, played: rec.played,
      record: `${rec.correct}-${rec.played - rec.correct}`,
      squares: squares(e.lineup ?? {}, games, results),
    };
  });
  // DENSE RANK, so three entries on 13-2 are all 1st - which is what the mock
  // prints, and what the header's "3 entries tied" counts.
  let seen = null; let rank = 0;
  for (const r of rows) {
    if (seen == null || r.correct !== seen) { rank += 1; seen = r.correct; }
    r.rank = rank;
  }

  const mine = rows.find((r) => r.you) ?? null;
  const bestCorrect = rows.length ? rows[0].correct : null;
  const tied = bestCorrect == null ? 0 : rows.filter((r) => r.correct === bestCorrect).length;
  const lb = await pickemBoardLeaderboard(Number(contestId), userId == null ? null : Number(userId), { limit: 3 });

  const scores = rows.map((r) => r.correct);
  const dist = distribution(scores, { mine: mine?.correct ?? null, ceiling: bestCorrect, dnf: 0 });

  return {
    game: 'pickem',
    title: "Pick'em",
    subtitle: `${String(contest.sport).toUpperCase()} week ${contest.week}`,
    edition: `${games.length} games · ${decided} final${games.length - decided ? ` · ${games.length - decided} to come` : ''}`,
    ceilingWord: 'best',
    header: header({
      rank: mine?.rank ?? null, of: rows.length,
      score: mine?.correct ?? null, ceiling: bestCorrect,
    }),
    // THE RECORD IS THE HEADLINE, NOT THE WIN COUNT. "11-4" is what a reader
    // reads; 11 alone is a number that needs the denominator to mean anything.
    // THE SCOREBOARD IS THE FIELD HERE, so a reader with no entry still gets the
    // whole grid - they are simply not a row in it. What they must not get is a
    // record of "0-0" and a 0% hit rate, which is what a missing `mine` used to
    // produce.
    played: mine != null,
    noEntryLine: noEntryLine('week'),
    record: mine?.record ?? null,
    bestRecord: bestCorrect == null ? null
      : `${bestCorrect}-${(mine?.played ?? decided) - bestCorrect}`,
    tied,
    hitRate: mine && mine.played ? Math.round((mine.correct / mine.played) * 1000) / 10 : null,
    bestHitRate: bestCorrect != null && decided ? Math.round((bestCorrect / decided) * 1000) / 10 : null,
    scoreboard: {
      games: games.map((g) => ({
        key: String(g.match_id ?? g.id), away: g.away ?? null, home: g.home ?? null,
        slug: g.slug ?? null,
        winner: results[String(g.match_id ?? g.id)] ?? null,
      })),
      rows: [...rows.slice(0, 6), ...(mine && mine.rank > 6 ? [mine] : [])],
    },
    field: {
      distribution: dist,
      axis: axisFor(dist, { mine: mine?.correct ?? null, label: (n) => String(Math.round(Number(n))) }),
      median: dist.median, played: rows.length, dnf: 0,
      rows: [...lb.top, ...(lb.self ? [lb.self] : [])].map((r) => ({
        rank: r.rank, name: r.name, house: r.house === true,
        you: userId != null && r.userId === Number(userId),
        score: Number(r.score), pct: null, sub: r.method ?? null, userId: r.userId,
      })),
    },
  };
}
