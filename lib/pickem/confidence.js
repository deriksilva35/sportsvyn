// lib/pickem/confidence.js - CONFIDENCE PICK'EM, the rules. PURE: no DB, no React.
//
// A confidence board asks for two things per game: the winner, and a RANK. Every
// game on the board is ranked 1..N (N = the board's size) and a right pick
// scores its rank. Your surest pick should carry N.
//
// WHICH BOARDS. The board says so, never the sport: contests.meta.scoring =
// 'confidence', stamped when the board is created. A board that is already open
// never changes. CONFIDENCE_START is the first instant a newly created NFL, CFB
// or NBA board is stamped (ruling tue-7: 20 Oct 2026, the three sports
// together). It is keyed to the board's OPENS_AT, so the NFL/CFB boards that
// open on 13 Oct stay REGULAR and the 20 Oct boards are the first confidence.
//
// THE SHEET. Pre-filled 1..N in kickoff order, latest kickoff = 1, so the
// earliest game carries the biggest number until the player moves it. Stored
// per entry in contest_entries.ranks {match_id: int}; a sheet is always a
// permutation of 1..N over the WHOLE board.
//
// SCORING. earned = sum of the rank of every correct pick. max = the sum of the
// entry's own ranks over the games that HAD A WINNER:
//   - an UNPICKED game stays in max and scores 0;
//   - a VOID or TIED game (result null) is off earned AND off max;
//   - a LATE pick (lib/nba/dayPickem.js onTimePicks) is stripped, so it is an
//     unpicked game - it earns nothing and keeps its rank in max.
//
// A LOCKED GAME'S RANK IS FROZEN. Once a game has kicked its pick AND its rank
// are sealed; the rest of the sheet may only be permuted among the ranks the
// locked games do not hold (validateSheet).

/** First instant a new board is stamped confidence: 20 Oct 2026 00:00 ET (EDT = UTC-4). */
export const CONFIDENCE_START = '2026-10-20T04:00:00.000Z';
export const CONFIDENCE_SPORTS = ['nfl', 'cfb', 'nba'];
/** An NBA night with fewer games than this gets no confidence board (ruling tue-7). */
export const NBA_MIN_GAMES = 3;

/** Is this board a confidence board? Asked of the row. PURE. */
export function isConfidence(contest) {
  return contest?.meta?.scoring === 'confidence';
}

/** Should a board with this sport and open instant be STAMPED confidence? PURE. */
export function stampsConfidence(sport, opensAt) {
  if (!CONFIDENCE_SPORTS.includes(sport)) return false;
  return new Date(opensAt).getTime() >= new Date(CONFIDENCE_START).getTime();
}

/** The board's game ids in the pre-fill order: kickoff ascending, id ascending. */
function kickoffOrder(board) {
  return [...(board ?? [])]
    .sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at) || Number(a.match_id) - Number(b.match_id))
    .map((g) => String(g.match_id));
}

/** {match_id: rank}, latest kickoff = 1, earliest = N. The sheet nobody touched. PURE. */
export function defaultRanks(board) {
  const order = kickoffOrder(board);
  const out = {};
  order.forEach((id, i) => { out[id] = order.length - i; });
  return out;
}

/**
 * The sheet an entry is actually scored on: its stored ranks, completed.
 * Stored ranks that are not usable (off-board id, non-integer, out of 1..N,
 * duplicated) are dropped, and every game left without one takes the unused
 * numbers in the pre-fill order (earliest kickoff gets the biggest). So a
 * never-saved sheet is exactly defaultRanks(), and a sheet missing one game
 * hands it back the one number nobody holds. Always a permutation of 1..N. PURE.
 */
export function effectiveRanks(board, stored = null) {
  const n = (board ?? []).length;
  const ids = new Set((board ?? []).map((g) => String(g.match_id)));
  const out = {}; const used = new Set();
  for (const [id, r] of Object.entries(stored ?? {})) {
    const v = Number(r);
    if (!ids.has(id) || !Number.isInteger(v) || v < 1 || v > n || used.has(v)) continue;
    out[id] = v; used.add(v);
  }
  const free = [];
  for (let v = n; v >= 1; v -= 1) if (!used.has(v)) free.push(v);
  for (const id of kickoffOrder(board)) {
    if (out[id] == null) out[id] = free.shift();
  }
  return out;
}

/**
 * Score one entry. PURE.
 * @param lineup  {match_id: 'home'|'away'} - the picks that COUNT
 * @param ranks   the stored ranks, or null
 * @param results {match_id: 'home'|'away'|null} - null = void or tie
 * @returns {{ score, max, correct, played }} played = games that had a winner
 */
export function scoreConfidence({ board, lineup = {}, ranks = null, results = {} }) {
  const eff = effectiveRanks(board, ranks);
  let score = 0; let max = 0; let correct = 0; let played = 0;
  for (const g of board ?? []) {
    const id = String(g.match_id);
    const res = results?.[id];
    if (res !== 'home' && res !== 'away') continue;      // void/tie: off both
    played += 1; max += eff[id];
    if (lineup?.[id] === res) { score += eff[id]; correct += 1; }
  }
  return { score, max, correct, played };
}

/** The share of the max an entry earned, 0..1, or null when there was no max. PURE. */
export function pctOfMax(score, max) {
  const m = Number(max);
  return Number.isFinite(m) && m > 0 ? Number(score ?? 0) / m : null;
}

/**
 * Validate a whole-sheet save. PURE.
 * @param board    the board (snapshot rows)
 * @param stored   the entry's stored ranks, or null
 * @param incoming {match_id: rank} the client's full sheet
 * @param locked   Set of match_id strings that are locked NOW (kicked / off 'scheduled')
 * @returns {{ok:true, ranks}} the sheet to write, or {ok:false, reason}
 *
 * The incoming sheet must cover the whole board as a permutation of 1..N, and
 * every LOCKED game must keep the rank it already holds (the stored one, or the
 * pre-fill default if the entry never saved). The unlocked games then hold
 * exactly the remaining numbers, so a swap can only happen among unkicked
 * games - a swap ACROSS a locked game is a swap of the free numbers around it,
 * and the locked game's own number never moves.
 */
export function validateSheet({ board, stored = null, incoming, locked = new Set() }) {
  const ids = (board ?? []).map((g) => String(g.match_id));
  const n = ids.length;
  if (!incoming || typeof incoming !== 'object') return { ok: false, reason: 'bad_ranks' };
  const keys = Object.keys(incoming);
  if (keys.length !== n || !keys.every((k) => ids.includes(k))) return { ok: false, reason: 'bad_ranks' };
  const seen = new Set();
  for (const k of keys) {
    const v = incoming[k];
    if (!Number.isInteger(v) || v < 1 || v > n || seen.has(v)) return { ok: false, reason: 'bad_ranks' };
    seen.add(v);
  }
  const held = effectiveRanks(board, stored);
  for (const id of ids) {
    if (locked.has(id) && incoming[id] !== held[id]) return { ok: false, reason: 'rank_locked', matchId: Number(id) };
  }
  return { ok: true, ranks: Object.fromEntries(ids.map((id) => [id, incoming[id]])) };
}

/** The label for a confidence score: "76 of 93". PURE. */
export function pointsLine(score, max) {
  return `${Number(score ?? 0)} of ${Number(max ?? 0)}`;
}

/** How many of these picks were right, against a results map. PURE. */
export function correctCount(lineup = {}, results = {}) {
  let n = 0;
  for (const [id, side] of Object.entries(lineup ?? {})) {
    if ((results?.[id] === 'home' || results?.[id] === 'away') && results[id] === side) n += 1;
  }
  return n;
}

/**
 * Move row `id` along the sheet: swap its number with the nearest UNLOCKED row
 * in the direction (dir > 0 = up, toward the bigger numbers). A locked row is
 * stepped OVER, never swapped with, so its number stays exactly where it is.
 * PURE; `games` need only {match_id, kicked}. Returns the new ranks map.
 */
export function moveRank(ranks, games, id, dir) {
  const order = [...games].sort((a, b) => ranks[b.match_id] - ranks[a.match_id]);   // biggest number first
  const i = order.findIndex((g) => g.match_id === id);
  if (i < 0 || order[i].kicked) return ranks;
  const step = dir > 0 ? -1 : 1;
  let j = i + step;
  while (j >= 0 && j < order.length && order[j].kicked) j += step;
  if (j < 0 || j >= order.length) return ranks;
  return { ...ranks, [id]: ranks[order[j].match_id], [order[j].match_id]: ranks[id] };
}
