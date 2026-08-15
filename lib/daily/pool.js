// lib/daily/pool.js - the Daily's board, generated deterministically.
//
// PURE. A date, a secret, a list of eligible players and the set of weeks
// already used go in; a board comes out. No database, no clock, no network -
// which is the only way "every user provably sees the same board" is a claim
// anyone can check rather than a hope.
//
// DETERMINISM IS THE WHOLE CONTRACT. The same (puzzle_date, secret, eligible
// set) must produce byte-identical output on any machine, any run. That rules
// out Math.random(), Set/Map iteration order over anything not explicitly
// sorted, and Array.prototype.sort on equal keys (unstable historically, and
// not worth relying on). Everything below sorts on a total key before it
// shuffles.
//
// THE BOARD IS FROZEN BY THE CALLER, not regenerated per request. See
// migrations/064_daily_puzzle.sql for why: the corpus tables move.

import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Seeded RNG
// ---------------------------------------------------------------------------
// A counter-mode hash rather than a stateful PRNG: draw(n) depends only on the
// seed and the call index, so a change to how many numbers an earlier step
// consumes cannot silently reshuffle a later one.
export function makeRng(seed) {
  let i = 0;
  return function next() {
    const h = crypto.createHash('sha256').update(`${seed}:${i++}`).digest();
    // 53 bits, the most a double holds exactly.
    const hi = h.readUInt32BE(0) & 0x1fffff;      // 21 bits
    const lo = h.readUInt32BE(4);                  // 32 bits
    return (hi * 4294967296 + lo) / 9007199254740992;
  };
}

export function seedFor(puzzleDate, secret) {
  return crypto.createHash('sha256').update(`${puzzleDate}|${secret}`).digest('hex').slice(0, 32);
}

/** Fisher-Yates over a COPY, driven by the injected rng. */
export function shuffled(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------
// The draw
// ---------------------------------------------------------------------------
export const POOL_SHAPE = { QB: 12, RB: 18, WR: 24, TE: 10 };
export const PPR_FLOOR = 4;

/**
 * Choose (season, week) uniformly from the candidates, skipping any already
 * used, and recycling once every one has been.
 *
 * NO-REPEAT UNTIL EXHAUSTED. 174 weeks is about five and a half months at one a
 * day; drawing with replacement would repeat inside a fortnight by the birthday
 * problem, which reads as a bug to anyone playing daily.
 *
 * @param {Array<{season_year:number, week:number}>} candidates
 * @param {Array<{season_year:number, week:number}>} used
 */
export function drawWeek(candidates, used, rng) {
  const key = (c) => `${c.season_year}-${String(c.week).padStart(2, '0')}`;
  // Sorted before anything random touches it: the caller's row order is a
  // database detail and must not reach the outcome.
  const all = [...candidates].sort((a, b) => key(a).localeCompare(key(b)));
  if (!all.length) return null;
  const usedKeys = new Set((used ?? []).map(key));
  const fresh = all.filter((c) => !usedKeys.has(key(c)));
  const from = fresh.length ? fresh : all;      // every week used -> start over
  return { ...from[Math.floor(rng() * from.length)], recycled: fresh.length === 0 };
}

/**
 * Build the board from the week's eligible players.
 *
 * @param {Array} eligible  { nfl_player_id, name, position, team, points, resume }
 * @returns {{ ok:boolean, board?:Array, reason?:string, short?:object }}
 */
export function buildBoard(eligible, rng, shape = POOL_SHAPE) {
  const byPos = {};
  for (const p of eligible ?? []) (byPos[p.position] ??= []).push(p);

  const short = {};
  for (const [pos, want] of Object.entries(shape)) {
    const have = (byPos[pos] ?? []).length;
    if (have < want) short[pos] = { have, want };
  }
  // REFUSE RATHER THAN SHRINK. A board one running back light is not a smaller
  // puzzle, it is a different one, and it would be indistinguishable from a
  // working day in the logs.
  if (Object.keys(short).length) return { ok: false, reason: 'pool depth', short };

  const board = [];
  for (const pos of Object.keys(shape).sort()) {            // stable position order
    const sorted = [...byPos[pos]].sort((a, b) =>
      String(a.nfl_player_id).padStart(9, '0').localeCompare(String(b.nfl_player_id).padStart(9, '0')));
    for (const p of shuffled(sorted, rng).slice(0, shape[pos])) {
      board.push({
        id: p.nfl_player_id,
        name: p.name,
        pos: p.position,
        resume: p.resume ?? null,
        // BOTH OF THESE ARE SERVER-SIDE ONLY until the puzzle closes.
        // publicBoard() below is the only sanctioned way to send a board out.
        points: p.points,
        team: p.team,
      });
    }
  }
  return { ok: true, board };
}

/**
 * The ONLY sanctioned pre-close serialization.
 *
 * Deletes rather than picks, on purpose: a whitelist silently drops a field
 * added later, which is the failure that looks fine in review. A blacklist
 * leaks a field added later - loudly, in a test that asserts on the serialized
 * payload. Given the choice, leak loudly.
 */
export function publicBoard(board) {
  return (board ?? []).map((p) => {
    const { points, team, ...rest } = p;
    return rest;
  });
}

/**
 * A resume line that does not tell you what year it is.
 *
 * CAREER SPAN IS DELIBERATELY ABSENT. "2006-2015" next to a 2015 board hands
 * over the era, and a few overlapping spans across six players intersect to pin
 * the season. Team is absent for the same reason and is stripped from the
 * payload besides. What is left - college and where he was drafted - is flavour
 * that does not narrow the answer.
 *
 * NO POSITION PREFIX: the UI owns the slot label, and repeating it here would
 * print it twice on every row. NO 'undrafted' FILLER either - an undrafted
 * player is his college and nothing else, and a player with neither college nor
 * draft slot gets an empty string rather than a word standing in for one.
 * Absence over inference.
 */
export function resumeLine({ college, draftRound, draftPick } = {}) {
  const bits = [];
  if (college) bits.push(college);
  if (draftRound && draftPick) bits.push(`Rd ${draftRound}, pick ${draftPick}`);
  else if (draftRound) bits.push(`Rd ${draftRound}`);
  return bits.join(' · ');
}
