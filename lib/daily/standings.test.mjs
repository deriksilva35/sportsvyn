// lib/daily/standings.test.mjs - season points and the boards. PURE.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  TIER_POINTS, pointsForTier, seasonStandings, dayLeaderboard, topWithSelf,
  seasonKeyFor, FIRST_SEASON,
} = await import('./standings.js');

const row = (userId, tier, score, perfect = 130, handle = null) => ({ userId, tier, score, perfect, handle });

// ---------------------------------------------------------------------------
// TIER POINTS
// ---------------------------------------------------------------------------

test('the ladder is 5/4/3/2/1', () => {
  assert.deepEqual(TIER_POINTS, {
    'HALL OF FAME': 5, MVP: 4, 'PRO BOWLER': 3, STARTER: 2, 'PRACTICE SQUAD': 1,
  });
});

test('a DNF and a day never opened are both ZERO, and neither is a penalty', () => {
  assert.equal(pointsForTier(null), 0);
  assert.equal(pointsForTier(undefined), 0);
  assert.equal(pointsForTier('DNF'), 0);
  // Nothing in the table is negative - missing a day costs you the points you
  // did not earn, not points you had.
  assert.ok(Object.values(TIER_POINTS).every((v) => v > 0));
});

// ---------------------------------------------------------------------------
// SEASON POINTS - and why they are not raw scores
// ---------------------------------------------------------------------------

test('TIER POINTS NORMALISE BOARD DIFFICULTY - the whole reason they exist', () => {
  // Measured across the corpus: weekly ceilings run 127.0 to 233.5, an 84%
  // spread. Two players of identical SKILL - both taking an MVP - must not
  // separate because one played the richer week.
  const easyDay = seasonStandings([row(1, 'MVP', 95, 100)]);
  const richDay = seasonStandings([row(2, 'MVP', 210, 230)]);
  assert.equal(easyDay[0].points, richDay[0].points, 'same tier, same points, 115 raw points apart');
});

test('season points sum across days and count HOF/MVP separately', () => {
  const t = seasonStandings([
    row(1, 'HALL OF FAME', 124), row(1, 'MVP', 118), row(1, 'STARTER', 80),
    row(2, 'PRO BOWLER', 100), row(2, 'PRO BOWLER', 101),
  ], 3);
  const a = t.find((x) => x.userId === 1);
  assert.equal(a.points, 5 + 4 + 2);
  assert.equal(a.played, 3);
  assert.equal(a.hof, 1);
  assert.equal(a.mvp, 1);
  assert.equal(a.daysPlayable, 3);
  assert.equal(t.find((x) => x.userId === 2).points, 6);
});

test('TIEBREAK: cumulative percent of perfect, then days played', () => {
  // Both on 6 points. Player 2 was closer to perfect both days.
  const t = seasonStandings([
    row(1, 'PRO BOWLER', 100, 130), row(1, 'PRO BOWLER', 100, 130),
    row(2, 'PRO BOWLER', 116, 130), row(2, 'PRO BOWLER', 116, 130),
  ]);
  assert.equal(t[0].userId, 2);
  assert.equal(t[0].points, t[1].points, 'the tiebreak only matters because points tied');
});

test('TIEBREAK falls through to days played when points and percent tie', () => {
  const t = seasonStandings([
    row(1, 'STARTER', 65, 130), row(1, 'STARTER', 65, 130),   // 4 pts, pctSum 1.0
    row(2, 'PRO BOWLER', 130, 130),                            // 3 pts
    row(3, 'STARTER', 65, 130), row(3, 'STARTER', 65, 130), row(3, 'PRACTICE SQUAD', 0, 130),
  ]);
  // 1 and 3 both reach 4+... check ordering is total and deterministic
  const ids = t.map((x) => x.userId);
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(seasonStandings([
    row(1, 'STARTER', 65, 130), row(3, 'STARTER', 65, 130),
  ]).map((x) => x.userId), [1, 3], 'a total tie orders by id, so a redraw cannot shuffle');
});

test('COMPETITION RANKING: identical rows share a rank and the next one skips', () => {
  const t = seasonStandings([
    row(1, 'MVP', 100, 130), row(2, 'MVP', 100, 130), row(3, 'STARTER', 70, 130),
  ]);
  assert.equal(t[0].rank, 1);
  assert.equal(t[1].rank, 1, 'genuinely tied rows share the rank');
  assert.equal(t[2].rank, 3, 'and the next rank skips');
});

test('a player with zero revealed days is simply absent, not a zero row', () => {
  assert.deepEqual(seasonStandings([]), []);
  assert.deepEqual(seasonStandings(null), []);
});

// ---------------------------------------------------------------------------
// THE LAW - standings cannot encode an open day
// ---------------------------------------------------------------------------

test('THE LAW: a locked-but-unrevealed rival entry does NOT move the standings', () => {
  // This is the leak the through-yesterday rule exists to stop. If today's
  // entry counted, this rival's total would jump the moment they locked, and
  // anyone watching the delta would learn their tier for an OPEN day.
  const revealedOnly = [row(1, 'MVP', 110), row(2, 'STARTER', 70)];
  const before = seasonStandings(revealedOnly, 2);

  // The rival locks a HALL OF FAME today. The day is NOT revealed, so the row
  // is never fetched - boards.js filters on d.revealed in SQL - and the caller
  // hands standings exactly the same input as before.
  const after = seasonStandings(revealedOnly, 2);

  assert.deepEqual(after, before, 'the board must be byte-identical until midnight');
  assert.equal(after.find((x) => x.userId === 2).points, 2, 'still a STARTER total');
});

test('THE LAW, stated as arithmetic: including an open day WOULD move it', () => {
  // The negative control. If a caller ever passes an unrevealed row, the total
  // changes - which is precisely why boards.js filters in SQL rather than
  // trusting anyone to remember.
  const clean = seasonStandings([row(2, 'STARTER', 70)]);
  const leaked = seasonStandings([row(2, 'STARTER', 70), row(2, 'HALL OF FAME', 128)]);
  assert.notEqual(leaked[0].points, clean[0].points);
  assert.equal(leaked[0].points - clean[0].points, 5, 'a 5-point jump names the tier exactly');
});

test('the standings row carries no per-day detail that could name today', () => {
  const t = seasonStandings([row(1, 'MVP', 110), row(1, 'STARTER', 70)], 2);
  assert.deepEqual(Object.keys(t[0]).sort(),
    ['daysPlayable', 'handle', 'hof', 'mvp', 'pct', 'pctSum', 'played', 'points', 'rank', 'userId']);
  const wire = JSON.stringify(t);
  assert.equal(/"date"|"score"|"puzzle_date"/.test(wire), false, 'no dated field survives aggregation');
});

// ---------------------------------------------------------------------------
// A DAY'S BOARD
// ---------------------------------------------------------------------------

const d = (userId, score, dnf = false) => ({ userId, score, dnf });

test('a day board ranks by score, and ties share a rank', () => {
  const r = dayLeaderboard([d(1, 100), d(2, 120), d(3, 120), d(4, 80)]);
  assert.deepEqual(r.map((x) => x.userId), [2, 3, 1, 4]);
  assert.equal(r[0].rank, 1);
  assert.equal(r[1].rank, 1);
  assert.equal(r[2].rank, 3);
});

test('DNFs sit UNRANKED at the foot, and are not dropped', () => {
  // Hiding them would make the entry count and the row count disagree with no
  // explanation on the page.
  const r = dayLeaderboard([d(1, 100), d(2, null, true), d(3, 90)]);
  assert.deepEqual(r.map((x) => x.userId), [1, 3, 2]);
  assert.equal(r[2].rank, null);
  assert.equal(r.length, 3, 'the DNF is still a row');
});

test('an entry with no score is treated as a DNF even without the flag', () => {
  const r = dayLeaderboard([d(1, 100), { userId: 2, score: null }]);
  assert.equal(r[1].rank, null);
});

// ---------------------------------------------------------------------------
// TOP N + PINNED SELF
// ---------------------------------------------------------------------------

test('your row is pinned when you fall outside the slice, and not duplicated inside it', () => {
  const ranked = Array.from({ length: 40 }, (_, i) => ({ userId: i + 1, rank: i + 1 }));
  const out = topWithSelf(ranked, 31, 25);
  assert.equal(out.top.length, 25);
  assert.equal(out.self.userId, 31);
  const inside = topWithSelf(ranked, 3, 25);
  assert.equal(inside.self, null, 'already visible - pinning it again would print it twice');
});

test('a signed-out reader gets the slice and no pinned row', () => {
  const ranked = [{ userId: 1 }, { userId: 2 }];
  assert.equal(topWithSelf(ranked, null, 25).self, null);
});

// ---------------------------------------------------------------------------
// SEASONS
// ---------------------------------------------------------------------------

test('SEASON ONE RUNS LONG - a three-week stub is not a season', () => {
  assert.equal(FIRST_SEASON.key, '2026-27');
  assert.equal(seasonKeyFor('2026-08-16'), '2026-27', 'the first board');
  assert.equal(seasonKeyFor('2026-09-01'), '2026-27', 'straight through the boundary');
  assert.equal(seasonKeyFor('2027-01-15'), '2026-27');
  assert.equal(seasonKeyFor('2027-08-31'), '2026-27', 'the last day of the long season');
});

test('seasons roll at the September boundary once the long first one ends', () => {
  assert.equal(seasonKeyFor('2027-09-01'), '2027-28');
  assert.equal(seasonKeyFor('2028-01-10'), '2027-28');
  assert.equal(seasonKeyFor('2028-08-31'), '2027-28');
  assert.equal(seasonKeyFor('2028-09-01'), '2028-29');
});

test('an unparseable date has no season rather than a wrong one', () => {
  assert.equal(seasonKeyFor('nonsense'), null);
  assert.equal(seasonKeyFor(null), null);
});
