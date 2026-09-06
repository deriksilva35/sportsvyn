// lib/games/gradePairing.js - the grade row pairing shared by the Weekly and
// the Draft (relay 2b items 2/3: "rows using the Daily's pairing rule
// verbatim").
//
// NOT THE DAILY'S OWN ALGORITHM, BY NAME. lib/daily/seasonBoardGrade.js
// matches SLOT-INDEX FIRST (your slot i against the best roster's own
// slot i, relabelled by name so a player you also hold lines up at your
// slot) - correct for a small, name-unique 64-player board, but the
// Weekly/Draft draw from a 1,000+ player pool where two different players
// can share a name and the only safe identity is the id. What is carried
// over is the CONCEPT the relay actually asks for - matched rows first,
// then the leftovers paired by value, with the same three verdicts and the
// same "same player, different slot" note - reimplemented for an id-keyed
// pool.
//
// PAIRING RULE, STATED EXACTLY: a player on both rosters is MATCHED,
// regardless of which slot each side started him in. Everyone left over is
// sorted by points descending on EACH side independently, then paired
// rank-for-rank (the highest scorer you missed against the highest scorer
// you have left, and so on) - not by chasing the closest number, which
// would let a small, coincidental gap hide a much bigger one two ranks
// down.

/**
 * @param {Array} yourPicks  your six/eight, each {label, id, name, pos, points, dropped}
 * @param {Array} bestPicks  the comparison roster, same shape
 * @returns {Array} rows in display order: matched first (in yourPicks' own
 *   order), then unmatched pairs by rank. Each row is
 *   {verdict: 'hit'|'ahead'|'miss', label, diff, you, best, note}
 */
export function pairRows(yourPicks, bestPicks) {
  const key = (p) => (p?.id != null ? String(p.id) : null);
  const bestById = new Map((bestPicks ?? []).filter((p) => key(p)).map((p) => [key(p), p]));
  const matchedIds = new Set((yourPicks ?? []).map(key).filter((id) => id && bestById.has(id)));

  const matched = (yourPicks ?? [])
    .filter((p) => matchedIds.has(key(p)))
    .map((p) => {
      const best = bestById.get(key(p));
      return {
        verdict: 'hit', label: p.label, diff: null, you: p, best,
        note: best.label !== p.label
          ? `You had him at ${p.label}. Same player, same points - it counts.`
          : null,
      };
    });

  const byPointsDesc = (a, b) => (Number(b.points) || 0) - (Number(a.points) || 0);
  const unmatchedYours = (yourPicks ?? []).filter((p) => !matchedIds.has(key(p))).slice().sort(byPointsDesc);
  const unmatchedBest = (bestPicks ?? []).filter((p) => !matchedIds.has(key(p))).slice().sort(byPointsDesc);

  const paired = unmatchedYours.map((you, i) => {
    const best = unmatchedBest[i] ?? null;
    const yv = Number(you.points) || 0;
    const bv = best ? Number(best.points) || 0 : 0;
    const ahead = yv >= bv;
    return {
      verdict: ahead ? 'ahead' : 'miss',
      label: 'SWAP',
      diff: Math.round((yv - bv) * 10) / 10,
      you, best, note: null,
    };
  });

  return [...matched, ...paired];
}

/**
 * The Draft's own row shape (relay 2b item 3): ROUND-INDEXED, not
 * matched-then-paired. A draft round is a stable axis both rosters share
 * (everyone has exactly eight), so round i on your card is compared
 * directly against round i of the field's best draft - hit when the same
 * player was taken there on both sides, else value-compared. This is
 * deliberately the Daily's OWN slot-index-first shape
 * (lib/daily/seasonBoardGrade.js), not pairRows() above: pairRows exists
 * because the Weekly's six SLOTS are chosen freely by best-ball and do not
 * correspond to anything shared between two lineups, but a draft ROUND is
 * exactly that shared axis, so there is no reason to search for a match
 * anywhere but the same round.
 *
 * @param {Array} yourRounds  your eight picks, in round order, each
 *   {label, round, id, name, pos, points, dropped}
 * @param {Array} bestRounds  the field-best drafter's eight, same shape
 */
export function draftGradeRows(yourRounds, bestRounds) {
  return (yourRounds ?? []).map((you, i) => {
    const best = bestRounds?.[i] ?? null;
    const sameId = you?.id != null && best?.id != null && String(you.id) === String(best.id);
    const yv = Number(you.points) || 0;
    const bv = best ? Number(best.points) || 0 : 0;
    const verdict = sameId ? 'hit' : (yv >= bv ? 'ahead' : 'miss');
    return {
      verdict, label: you.label, diff: sameId ? null : Math.round((yv - bv) * 10) / 10,
      you, best, note: null,
    };
  });
}

/** The earliest round your draft and the field-best's diverge - the "round
 * three shape" the Draft's story names. */
export function firstDivergentRound(rows) {
  return (rows ?? []).find((r) => r.verdict !== 'hit') ?? null;
}

/** 🟩 matched, 🟨 ahead, ⬛ missed, ⬜ dropped (your own pick did not count
 * toward the score - the Draft's own case, item 3) - one glyph per row. */
export function gradeGlyphRow(rows) {
  const GLYPH = { hit: '🟩', ahead: '🟨', miss: '⬛' };
  return rows.map((r) => (r.you?.dropped ? '⬜' : GLYPH[r.verdict] ?? '⬛')).join('');
}

/**
 * The three-sentence story, templated from this board's own numbers only -
 * no AI writer anywhere in this codebase (lib/daily/seasonBoardGrade.js's
 * boardStory is the precedent: a pure template, confirmed by a repo-wide
 * grep for every LLM call site).
 */
export function gradeStory(rows, { matchedNoun = 'six' } = {}) {
  const matchedCount = rows.filter((r) => r.verdict === 'hit').length;
  const misses = rows.filter((r) => r.verdict === 'miss' && r.best);
  const biggest = misses.slice().sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))[0] ?? null;
  const ahead = rows.filter((r) => r.verdict === 'ahead')[0] ?? null;

  const s1 = `${matchedCount} of your ${matchedNoun} were on the best roster.`;
  const s2 = biggest
    ? `The gap is ${biggest.you.label}: ${biggest.best.name} outscored ${biggest.you.name} by ${Math.abs(biggest.diff)}.`
    : 'You matched every slot the best roster filled.';
  const s3 = ahead
    ? `${ahead.you.name} over ${ahead.best?.name ?? 'the field'} was the right call.`
    : 'Nothing you started underperformed what it replaced.';
  return `${s1} ${s2} ${s3}`;
}
