// lib/boards/view.js - the live boards' pure half: rank, movement, the view.
//
// No database import, on purpose: a page and a render test can shape a board
// without loading a driver. lib/boards/live.js re-exports all three.

import { competitionRank } from '../games/rank.js';

const round1 = (x) => Math.round(Number(x) * 10) / 10;

/**
 * PURE. Competition-ranked rows from { userId, points, submittedAt?, ... }:
 * points descending, ties share the higher place (1, 1, 3) and are listed
 * earliest submission first (lib/games/rank.js - the one tie rule). The user
 * id only keeps the order total, never decides a place.
 */
export function rankRows(rows = []) {
  return competitionRank(rows, (r) => r.points, (r) => r.submittedAt);
}

/**
 * PURE. Attach movement to ranked rows from each entry's standing THEN (a Map
 * userId -> { points, rank }). An entry with no standing then (joined the
 * board inside the window, or the snapshots have not reached back that far)
 * has no movement - null, drawn as a dash - never a fabricated zero.
 *   dPoints  points gained since then (+)
 *   dRank    places climbed since then (+ = up)
 */
export function withMovement(rows = [], then = new Map()) {
  return rows.map((r) => {
    const t = then.get(r.userId);
    if (!t) return { ...r, dPoints: null, dRank: null };
    return { ...r, dPoints: round1(r.points - Number(t.points)), dRank: Number(t.rank) - r.rank };
  });
}

/**
 * PURE. What the page draws: the top of the table, the reader's own row with
 * a neighbour either side (when it is not already in the top), the pinned
 * "you" card, and the top-10% line.
 */
export function boardView(rows = [], uid = null, { top = 10 } = {}) {
  const head = rows.slice(0, top);
  const i = uid == null ? -1 : rows.findIndex((r) => String(r.userId) === String(uid));
  const me = i < 0 ? null : rows[i];
  const around = i < 0 || i < top ? [] : rows.slice(Math.max(top, i - 1), i + 2);
  // THE TOP-10% LINE NEEDS A FIELD: under ten entries it is just first place.
  const cutRow = rows.length >= 10 ? rows[Math.ceil(rows.length * 0.1) - 1] : null;
  return {
    head, around, me, count: rows.length,
    gap: around.length > 0 && around[0] !== rows[top],
    // AND IT NEEDS A NUMBER: "Top 10% cutoff · 0.0" before anybody has scored
    // is a line about nothing (ruling 27 Sep) - shown only once it is above zero.
    topTenCut: cutRow && Number(cutRow.points) > 0 ? cutRow.points : null,
  };
}


/**
 * PURE. Which of the reader's OWN leagues ?league=<id> names, or null for the
 * national board. The match is against their memberships, never the URL alone,
 * so a guessed or stale id (a league they are not in, or have left) is the
 * national board - never somebody else's members.
 */
export function pickLeague(leagues = [], wanted = null) {
  if (wanted == null || wanted === '') return null;
  return leagues.find((l) => String(l.id) === String(wanted)) ?? null;
}

/**
 * PURE. The chip row for a board at `path`: National, then each of the
 * reader's leagues as `${path}?league=<id>`. The shape components/boards/
 * BoardChips.js draws.
 */
export function leagueChips(path, leagues = [], picked = null, { national = 'National' } = {}) {
  return [{ label: national, href: path, on: picked == null },
    ...leagues.map((l) => ({ label: l.name, href: `${path}?league=${l.id}`, on: picked != null && String(picked.id) === String(l.id) }))];
}
