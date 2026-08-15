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

// ---------------------------------------------------------------------------
// THE CAREER STAT
// ---------------------------------------------------------------------------
/**
 * RATES, NEVER TOTALS, AND THE REASON IS THE CORPUS.
 *
 * Our box scores begin in 2015. Any player who was already playing before that
 * has the front of his career missing, so a TOTAL taken from these tables is
 * simply wrong - Tom Brady shows 126 games where he played about 335, and a
 * career yardage total would understate him by two thirds. A RATE survives the
 * truncation intact: he really did average 285 yards over the 126 games we
 * hold. A rate is honest where a total lies, which is why this is a rate.
 *
 * THE GAMES COUNT IS THE DISCLOSURE, not decoration. It sits beside the rate so
 * the denominator is visible and a small sample reads as one.
 *
 * WEEK-INVARIANT BY CONSTRUCTION: the value is career-to-today across the whole
 * corpus, identical on every board, so it cannot narrow which week is on the
 * screen. It is not as-of the puzzle week - that would vary with the draw and
 * leak the era. One consequence worth knowing: the live season is in the index,
 * so the number drifts as games land. Boards are frozen at generation, so each
 * board keeps the figure it was built with and two boards a month apart can
 * disagree by a yard. That is correct behaviour, not drift to be fixed.
 *
 * RUNNING BACKS ARE MEASURED BY SCRIMMAGE YARDS, not rushing. Rushing alone
 * lies about the job: it prints 2 yds/gm next to Kyle Juszczyk, which reads as
 * "useless" when the truth is "different role", and it halves every receiving
 * back on the board. Scrimmage is honest for both kinds of back and costs a
 * pure runner almost nothing.
 */
export const CAREER_STAT = {
  QB: { of: (c) => c.passYds, label: 'pass yds/gm' },
  RB: { of: (c) => (c.rushYds ?? 0) + (c.recYds ?? 0), label: 'scrim yds/gm' },
  WR: { of: (c) => c.recYds, label: 'rec yds/gm' },
  TE: { of: (c) => c.recYds, label: 'rec yds/gm' },
};

/** `285 pass yds/gm · 126 g`, or null when there is nothing honest to say. */
export function careerStat(pos, career) {
  const spec = CAREER_STAT[pos];
  const g = Number(career?.g ?? 0);
  if (!spec || !Number.isFinite(g) || g <= 0) return null;
  const yds = Number(spec.of(career) ?? 0);
  if (!Number.isFinite(yds)) return null;
  return `${Math.round(yds / g)} ${spec.label} · ${g} g`;
}

/**
 * nflverse lists schools REVERSE-CHRONOLOGICALLY - "Tennessee; Hutchinson CC;
 * Alabama" for Alvin Kamara, "Wisconsin; N.C. State" for Russell Wilson - so
 * the first entry is the school the player is known for. The rest is transfer
 * trivia that costs 30 characters on a row that truncates.
 */
export function firstCollege(college) {
  return String(college ?? '').split(';')[0].trim() || null;
}

/**
 * A resume line that does not tell you what year it is.
 *
 * CAREER SPAN IS DELIBERATELY ABSENT. "2006-2015" next to a 2015 board hands
 * over the era, and a few overlapping spans across six players intersect to pin
 * the season. Team is absent for the same reason and is stripped from the
 * payload besides. What is left - a career rate, college and where he was
 * drafted - is flavour that does not narrow the answer.
 *
 * ORDER IS LOAD-BEARING: the stat comes FIRST because the row truncates from
 * the tail. Put college first and a long school name ellipsizes away the number
 * this line exists to carry; this way the draft slot is what goes.
 *
 * NO POSITION PREFIX: the UI owns the slot label, and repeating it here would
 * print it twice on every row. NO 'undrafted' FILLER either - an undrafted
 * player is his college and nothing else, and a player with nothing to say gets
 * an empty string rather than a word standing in for one. Absence over
 * inference.
 */
export function resumeLine({ college, draftRound, draftPick, pos, career } = {}) {
  const bits = [];
  const stat = careerStat(pos, career);
  if (stat) bits.push(stat);
  const school = firstCollege(college);
  if (school) bits.push(school);
  // `R6 #199` rather than `Rd 6, pick 199`: the same information in seven fewer
  // characters, on a line where characters are the constraint.
  if (draftRound && draftPick) bits.push(`R${draftRound} #${draftPick}`);
  else if (draftRound) bits.push(`R${draftRound}`);
  return bits.join(' · ');
}
