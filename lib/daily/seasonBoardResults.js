// lib/daily/seasonBoardResults.js - PURE shapes for a closed edition: the
// results route, the lobby's Yesterday line, Latest Answer and History. No
// database here; lib/games/read.js and app/daily/board/[date]/page.js feed
// these from daily_boards + daily_board_runs, and the tests feed them fixtures.
//
// STORED matched IS NOT TRUSTED. Row 1 (8 Sep) carries matched=0 from the
// grader that read undefined names; the receipt regrades from picks and gets
// 4. Everything here that shows a matched count takes it from a regrade, and
// score/pct from the stored row (those were always right).

import { shapeBestRoster, SLOTS, dailyResultsPath } from './boardShape.js';
import { editionLabel, editionNo } from './homeModule.js';

/** yyyy-mm-dd of the day before, in calendar terms (UTC parts only). */
export function dayBefore(ymd) {
  const t = Date.parse(`${ymd}T00:00:00Z`) - 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** The best roster as a display list: slot, abbr, name, points, meta. */
export function bestRosterLines(board) {
  return shapeBestRoster(board.best_roster).map((b, i) => ({
    slot: b.slot ?? SLOTS[i], abbr: b.abbr ?? b.teamKey, name: b.name, points: b.points, meta: b.meta,
  }));
}

/**
 * The lobby's Yesterday line. `grade` is regradeStoredRun(...).grade for the
 * user's submitted run on yesterday's board, or null. A DNF or no run -> no
 * line at all: the lobby does not advertise a result that does not exist.
 */
export function yesterdayLine({ date, grade, score }) {
  if (!date || !grade) return null;
  const pts = Number(score ?? grade.mine);
  return {
    text: `Yesterday · ${pts.toLocaleString('en-US')} · ${grade.pct}% · ${grade.matchedCount} of ${grade.slotCount}`,
    href: dailyResultsPath(date),
  };
}

/** The "you" cell for one edition. run is the user's daily_board_runs row or null. */
export function youCellV2(run, grade) {
  if (!run) return { played: false };
  if (run.picks == null) return { played: false, dnf: true };
  return {
    played: true, score: Number(run.score), pct: Math.round(Number(run.pct) * 100),
    matched: grade?.matchedCount ?? null, slotCount: grade?.slotCount ?? SLOTS.length,
  };
}

/**
 * One History row. `top` is the day's leaderboard leader ({ handle, score })
 * or null; `you` is youCellV2() or undefined for a signed-out reader.
 */
export function historyRow({ board, closed, top = null, you }) {
  const date = board.edition_date;
  const edition = editionLabel(editionNo(date));
  const label = edition ? `Ed. ${edition}` : date;
  if (!closed) return { date, edition, label, sealed: true };
  return {
    date, edition, label, sealed: false,
    season: board.season_year,
    perfect: Math.round(Number(board.ceiling) * 10) / 10,
    href: dailyResultsPath(date),
    top: top ? { name: top.handle, score: Number(top.score) } : null,
    ...(you === undefined ? {} : { you }),
  };
}

/** The Latest Answer pane: the newest CLOSED edition. */
export function latestAnswer({ board, top = null, you, grade = null }) {
  if (!board) return null;
  const date = board.edition_date;
  return {
    date, edition: editionLabel(editionNo(date)), season: board.season_year,
    perfect: Math.round(Number(board.ceiling) * 10) / 10,
    bestRoster: bestRosterLines(board),
    top: top ? { name: top.handle, score: Number(top.score) } : null,
    href: dailyResultsPath(date),
    ...(you === undefined ? {} : { you }),
    glyph: grade?.glyph ?? null,
  };
}
