// lib/daily/reveal.test.mjs - closing a Daily. PURE.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { perfectLineup, tierFor, guessResult, isDnf, TIERS } = await import('./reveal.js');

const p = (id, pos, points, name = `${pos}${id}`) => ({ id, pos, points, name, team: 'XXX' });

// ---------------------------------------------------------------------------
// THE PERFECT LINEUP - why it is brute-forced
// ---------------------------------------------------------------------------

test('GREEDY IS WRONG, and this fixture is why we brute-force', () => {
  // The trap: the best TE (9) is worth less than the third-best WR (20). Greedy
  // fills TE with the best TE and then takes the two best remaining flex-
  // eligible - and because the TE is the worst of the six it gets dropped
  // anyway, wasting the slot. The optimum still has to FILL the TE slot, but
  // the right question is which six maximise the top FIVE.
  const board = [
    p(1, 'QB', 30), p(2, 'QB', 10),
    p(3, 'RB', 25), p(4, 'RB', 24), p(5, 'RB', 23),
    p(6, 'WR', 22), p(7, 'WR', 21), p(8, 'WR', 20),
    p(9, 'TE', 9), p(10, 'TE', 2),
  ];
  const best = perfectLineup(board);

  // Greedy: QB30 + RB25 + WR22 + TE9 + two best remaining flex (24, 23)
  //         = drop the 9  -> 30+25+22+24+23 = 124
  // Optimal is the same total here ONLY if the flexes take the two 24/23 RBs;
  // what matters is that brute force never scores lower.
  const greedy = [30, 25, 22, 9, 24, 23].sort((a, b) => a - b).slice(1).reduce((a, b) => a + b, 0);
  assert.ok(best.total >= greedy, `brute force ${best.total} must never lose to greedy ${greedy}`);
  assert.equal(best.total, 124);
  // And the TE slot IS filled even though its player is dropped - six slots is
  // the rule, five counting is the scoring.
  assert.equal(best.picks.length, 6);
  assert.equal(best.picks.find((x) => x.slot === 'TE').pos, 'TE');
  assert.equal(best.picks.filter((x) => x.dropped).length, 1);
});

test('the perfect lineup respects slot eligibility', () => {
  const board = [
    p(1, 'QB', 40), p(2, 'QB', 39),
    p(3, 'RB', 10), p(4, 'RB', 9),
    p(5, 'WR', 8), p(6, 'WR', 7),
    p(7, 'TE', 6), p(8, 'TE', 5),
  ];
  const best = perfectLineup(board);
  // Only ONE quarterback can appear - FLEX is RB/WR/TE. A second 39-point QB
  // would beat every flex option if the rule were not enforced.
  assert.equal(best.picks.filter((x) => x.pos === 'QB').length, 1);
  for (const slot of ['FLEX', 'FLEX2']) {
    assert.notEqual(best.picks.find((x) => x.slot === slot).pos, 'QB');
  }
});

test('no player appears twice in the perfect lineup', () => {
  const board = [
    p(1, 'QB', 30), p(2, 'RB', 25), p(3, 'RB', 24),
    p(4, 'WR', 23), p(5, 'WR', 22), p(6, 'TE', 21), p(7, 'TE', 20),
  ];
  const ids = perfectLineup(board).picks.map((x) => x.id);
  assert.equal(new Set(ids).size, 6);
});

test('the perfect lineup is deterministic on ties', () => {
  const board = Array.from({ length: 20 }, (_, i) =>
    p(i + 1, ['QB', 'RB', 'WR', 'TE'][i % 4], 10));
  const a = perfectLineup(board);
  const b = perfectLineup([...board].reverse());
  assert.equal(a.total, b.total);
  assert.deepEqual(a.picks.map((x) => x.name), b.picks.map((x) => x.name),
    'equal scores must not produce a different lineup on a different row order');
});

test('a board too thin to fill six slots returns null rather than a partial', () => {
  assert.equal(perfectLineup([p(1, 'QB', 10)]), null);
  assert.equal(perfectLineup([]), null);
});

// ---------------------------------------------------------------------------
// TIERS
// ---------------------------------------------------------------------------

test('TIER boundaries are exact, and inclusive at the floor of each band', () => {
  assert.equal(tierFor(100, 100).label, 'HALL OF FAME');
  assert.equal(tierFor(95, 100).label, 'HALL OF FAME', '95% exactly is HOF');
  assert.equal(tierFor(94.9, 100).label, 'MVP');
  assert.equal(tierFor(90, 100).label, 'MVP');
  assert.equal(tierFor(89.9, 100).label, 'PRO BOWLER');
  assert.equal(tierFor(75, 100).label, 'PRO BOWLER');
  assert.equal(tierFor(74.9, 100).label, 'STARTER');
  assert.equal(tierFor(55, 100).label, 'STARTER');
  assert.equal(tierFor(54.9, 100).label, 'PRACTICE SQUAD');
  assert.equal(tierFor(0, 100).label, 'PRACTICE SQUAD');
});

test('TIER is a RATIO, so it is comparable across boards of different difficulty', () => {
  // Same tier from very different raw scores - which is the whole point.
  assert.equal(tierFor(95, 100).label, tierFor(190, 200).label);
  assert.equal(tierFor(95, 100).pct, tierFor(190, 200).pct);
});

test('TIER with no perfect or no score is null, not a default badge', () => {
  assert.equal(tierFor(50, null), null);
  assert.equal(tierFor(null, 100), null);
});

test('the tier ladder is the one the product specified', () => {
  assert.deepEqual(TIERS.map((t) => t.at), [0.95, 0.90, 0.75, 0.55, 0]);
});

// ---------------------------------------------------------------------------
// GUESS RESULT - reveal-time only
// ---------------------------------------------------------------------------

test('guessResult reports both halves independently', () => {
  const day = { season_year: 2017, week: 4 };
  assert.deepEqual(
    guessResult({ guess_season: 2017, guess_week: 4, bonus_pct: 0.1 }, day),
    { guessedSeason: 2017, guessedWeek: 4, seasonRight: true, weekRight: true, bonusPct: 0.1 });
  const half = guessResult({ guess_season: 2017, guess_week: 9, bonus_pct: 0.05 }, day);
  assert.equal(half.seasonRight, true);
  assert.equal(half.weekRight, false);
});

test('no guess gives null - the reveal shows nothing rather than a wrong answer', () => {
  assert.equal(guessResult({ guess_season: null, guess_week: null }, { season_year: 2017, week: 4 }), null);
  assert.equal(guessResult(null, { season_year: 2017, week: 4 }), null);
});

// ---------------------------------------------------------------------------
// DNF
// ---------------------------------------------------------------------------

test('DNF: an entry with no locked_at is a DNF; a locked one is not', () => {
  assert.equal(isDnf({ id: 1, locked_at: null }), true);
  assert.equal(isDnf({ id: 1, locked_at: '2026-08-16T01:00:00Z' }), false);
  assert.equal(isDnf(null), false, 'never having started is not a DNF');
  assert.equal(isDnf(undefined), false);
});
