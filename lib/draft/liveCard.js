// lib/draft/liveCard.js - THE LOCKED DRAFT CARD'S EIGHT ROWS. PURE.
//
// Eight picks, six of which count. bestBall already chose the six - they are
// exactly what liveEntryRows returns as its rows - so this does not re-decide
// anything; it lines the choice up against the roster in draft order and hands
// the card a row per pick with its number, its game and whether it counts.
//
// LIVE BEST BALL MOVES. The six that count at halftime Sunday are not
// necessarily the six that count on Tuesday, and that is what best ball means
// mid-week rather than a defect in the marking. The card's label says so.
//
// ONE SCORER. Points arrive on the scored board from poolWithScores, which is
// lib/fantasy/scoring.js fantasyPoints over the week's stat rows - the same
// function the settle, the Weekly, the Daily and the game page all use. This
// module computes no points of its own and must never start.

import { slotState, countingIds } from '../weekly/slotState.js';

/**
 * @param {object} a
 * @param {Array}  a.roster       the entry's eight picks, in draft order
 * @param {Array}  a.scored       poolWithScores output
 * @param {Set}    a.playedIds    ids with at least one stat row
 * @param {Array}  a.liveRows     liveEntryRows(...).rows - the live best six
 * @param {Map}    a.gamesByTeam  team abbr -> {status, metadata, kickoffAt}
 * @returns {{rows: Array, total: number, startedCount: number, counting: number}}
 */
export function draftLiveRows({ roster = [], scored = [], playedIds = new Set(), liveRows = [], gamesByTeam = new Map() } = {}) {
  const byId = new Map((scored ?? []).map((p) => [p.id, p]));
  const counting = countingIds(liveRows);

  const rows = (roster ?? []).map((r) => {
    const p = r?.id != null ? byId.get(r.id) : null;
    // THE NAME COMES FROM THE PICK, not the board. A roster is a record of
    // what was drafted and it keeps its own copy; a board lookup that missed
    // would otherwise blank a row that is perfectly well known.
    const row = {
      id: r?.id ?? null,
      name: r?.name ?? p?.name ?? null,
      team: p?.team ?? r?.team ?? null,
      points: p ? Number(p.points) : 0,
      played: r?.id != null && playedIds.has(r.id),
    };
    const state = slotState({ row, game: row.team ? gamesByTeam.get(row.team) ?? null : null });
    return {
      round: r?.round ?? null,
      pos: r?.pos ?? null,
      key: r?.ffc ?? r?.id ?? `${r?.round}-${r?.name}`,
      ...row,
      state,
      counting: row.id != null && counting.has(row.id),
    };
  });

  // THE HEADER TOTAL IS THE SUM OF THE MARKED ROWS, and it is computed from
  // them rather than taken on trust, so the number over the card can always be
  // checked against the ticks under it. A dropped row contributes nothing.
  const total = Math.round(rows.filter((r) => r.counting)
    .reduce((a, r) => a + (r.state.points ?? 0), 0) * 10) / 10;

  return {
    rows,
    total,
    startedCount: rows.filter((r) => r.counting && r.state.started).length,
    counting: rows.filter((r) => r.counting).length,
  };
}
