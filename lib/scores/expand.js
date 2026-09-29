// lib/scores/expand.js - the expanded arcade card (scores-v4 step 2): pure shaping.
//
// Three things the card shows when it opens, each in ONE shape whatever the
// sport, so the card never asks which league it is holding:
//   · line    the line score by period (board B's columns): football quarters
//             (+OT), baseball innings plus R H E. Built FROM THE ROW, so the
//             card draws it before the fetch lands - the same function runs on
//             the server for the first paint and in the route for the payload.
//   · scoring the key moments: every scoring play, oldest first, with the
//             score after it (how the game got to the number on the card).
//   · last    the last five plays, newest first.
// The readers that feed these are the game pages' own (lib/scores/expandRead.js).

import { lineScoreGrid } from '../gridiron/lineScore.js';
// SERVER-SIDE ONLY: the two game-page modules import the database client. The
// card never imports this file - it is handed `line` as a prop.
import { lineScoreGrid as mlbLineScoreGrid } from '../mlb/gameDetail.js';
import { scoringFromPlays, scoringByQuarter } from '../gridiron/gameDetail.js';
import { byGameClock, isStoppage } from '../gridiron/driveStrip.js';

export const LAST_N = 5;

/** Cache-Control per state (ruling e): 30 s while live, an hour once final. */
export function cacheControlFor(status) {
  if (status === 'live') return 'public, s-maxage=30, stale-while-revalidate=30';
  if (status === 'final') return 'public, s-maxage=3600, stale-while-revalidate=600';
  return 'public, s-maxage=300, stale-while-revalidate=60';
}

const abbrOf = (t) => t?.abbreviation ?? String(t?.shortName ?? t?.name ?? '').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();

/**
 * THE LINE, one shape: { columns: [label], rows: [{ side, abbr, cells, total }], extra: [label] }.
 * Away first, home second - the order both codes print a line score in.
 * `extra` is baseball's H and E, carried as cells after the total.
 * Null when the row has no line score yet (a scheduled game, a feed gap).
 */
export function lineFor(game, { mlbLine = null, mlbGrid = null } = {}) {
  if (!game) return null;
  if (game.leagueSlug === 'mlb') {
    // The MLB page's own grid when the caller has it (the route), else built
    // from the row's raw metadata.line_score (the card's first paint).
    const g = mlbGrid ?? mlbLineScoreGrid(mlbLine);
    if (!g) return null;
    const row = (side) => ({
      side, abbr: abbrOf(game[side]),
      cells: g[side].innings.map((v) => (v == null ? '' : String(v))),
      total: g[side].runs ?? game[side === 'home' ? 'homeScore' : 'awayScore'] ?? '',
      extra: [g[side].hits ?? '', g[side].errors ?? ''],
    });
    return { columns: g.columns.map(String), rows: [row('away'), row('home')], total: 'R', extra: ['H', 'E'] };
  }
  const g = lineScoreGrid(game);
  if (!g) return null;
  return {
    columns: g.columns,
    rows: g.rows.map((r, i) => ({ side: i === 0 ? 'away' : 'home', abbr: r.abbr, cells: r.cells.map(String), total: r.total, extra: [] })),
    total: 'T', extra: [],
  };
}

/** Key moments, gridiron: the plays table first, the events table otherwise (the game page's rule). */
export function gridironScoring({ plays = [], game, teamAbbr = new Map() }) {
  // GAME ORDER FIRST (byGameClock): the plays table puts drive-less rows last.
  const quarters = plays.length ? scoringFromPlays(byGameClock(plays)) : scoringByQuarter(game);
  const out = [];
  for (const q of quarters) {
    for (const p of q.plays) {
      const abbr = teamAbbr.get(p.team_id) ?? (p.team_id === game?.home?.id ? abbrOf(game.home) : p.team_id === game?.away?.id ? abbrOf(game.away) : null);
      out.push({
        when: [q.label, p.clock].filter(Boolean).join(' '),
        abbr, kind: p.scoring_type ?? null,
        text: p.description ?? '',
        score: p.away_score != null && p.home_score != null ? `${p.away_score}-${p.home_score}` : null,
      });
    }
  }
  return out;
}

const qLabel = (period) => {
  const n = Number(period);
  if (!Number.isFinite(n) || n < 1) return null;
  return n > 4 ? (n === 5 ? 'OT' : `OT${n - 4}`) : `Q${n}`;
};

/**
 * The last five plays, gridiron: newest first, BY THE GAME CLOCK and without
 * the stoppages - the drive strip's own two rules (lib/gridiron/driveStrip.js).
 * The plays table sorts drive-less rows (timeouts, quarter ends) LAST, so
 * "the last five rows" on the first preview (29 Sep) was four timeouts and
 * an END QUARTER 1 under a Q2 4:28 card.
 */
export function gridironLast(plays = [], n = LAST_N) {
  return byGameClock(plays).filter((p) => p.text && !isStoppage(p.playType)).slice(-n).reverse().map((p) => ({
    when: [qLabel(p.period), p.clock].filter(Boolean).join(' '),
    text: p.text,
    scoring: p.scoring === true,
  }));
}

/** Key moments, baseball: the scoring plays the MLB page prints, oldest first. */
export function mlbScoring(scoringPlays = []) {
  return scoringPlays.map((p) => ({
    when: `${p.half === 'top' ? 'Top' : 'Bot'} ${p.inning}`,
    abbr: null, kind: null,
    text: p.text ?? '',
    score: p.awayScore != null && p.homeScore != null ? `${p.awayScore}-${p.homeScore}` : null,
  }));
}

/** The last five plate appearances, baseball: the plays tab's halves, flattened newest first. */
export function mlbLast(halves = [], n = LAST_N) {
  const out = [];
  for (const h of halves) {
    for (const ab of h.atBats ?? []) {
      if (!ab.result) continue;
      out.push({ when: h.label ?? null, text: ab.result, scoring: ab.scoring === true });
      if (out.length >= n) return out;
    }
  }
  return out;
}
