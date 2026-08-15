// lib/daily/pool.test.mjs - the Daily's board generation.
//
// PURE, so "every user provably sees the same board" is checkable rather than
// hoped for. No database, no clock, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  makeRng, seedFor, shuffled, drawWeek, buildBoard, publicBoard, resumeLine,
  careerStat, firstCollege, CAREER_STAT, POOL_SHAPE, PPR_FLOOR,
} = await import('./pool.js');

const SECRET = 'test-secret-not-the-real-one';

// A synthetic week deep enough to build from: shape + a few spare per position.
function eligible(n = { QB: 15, RB: 22, WR: 30, TE: 13 }) {
  const out = []; let id = 1;
  for (const [pos, count] of Object.entries(n)) {
    for (let i = 0; i < count; i++) {
      out.push({
        nfl_player_id: id++, name: `${pos} Player ${i}`, position: pos,
        team: 'XXX', points: 4 + i, resume: `${pos} · State`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// DETERMINISM - the whole contract
// ---------------------------------------------------------------------------

test('DETERMINISM: same date + same secret = byte-identical board', () => {
  const pool = eligible();
  const a = buildBoard(pool, makeRng(seedFor('2026-09-01', SECRET)));
  const b = buildBoard(pool, makeRng(seedFor('2026-09-01', SECRET)));
  assert.equal(JSON.stringify(a.board), JSON.stringify(b.board));
});

test('DETERMINISM: a different DATE gives a different board', () => {
  const pool = eligible();
  const a = buildBoard(pool, makeRng(seedFor('2026-09-01', SECRET)));
  const b = buildBoard(pool, makeRng(seedFor('2026-09-02', SECRET)));
  assert.notEqual(JSON.stringify(a.board), JSON.stringify(b.board));
});

test('DETERMINISM: a different SECRET gives a different board for the same date', () => {
  // This is what stops tomorrow's board being computable from the date alone.
  const pool = eligible();
  const a = buildBoard(pool, makeRng(seedFor('2026-09-01', SECRET)));
  const b = buildBoard(pool, makeRng(seedFor('2026-09-01', 'a-different-secret')));
  assert.notEqual(JSON.stringify(a.board), JSON.stringify(b.board));
});

test('DETERMINISM: input row ORDER cannot reach the output', () => {
  // The caller's order is a database detail. Reversed input, same board.
  const pool = eligible();
  const a = buildBoard(pool, makeRng(seedFor('2026-09-01', SECRET)));
  const b = buildBoard([...pool].reverse(), makeRng(seedFor('2026-09-01', SECRET)));
  assert.equal(JSON.stringify(a.board), JSON.stringify(b.board));
});

test('the rng is counter-addressed, so an extra earlier draw cannot reshuffle a later one', () => {
  const r1 = makeRng('s'); const first = [r1(), r1(), r1()];
  const r2 = makeRng('s'); const again = [r2(), r2(), r2()];
  assert.deepEqual(first, again);
  assert.ok(first.every((x) => x >= 0 && x < 1), 'values are in [0,1)');
  assert.equal(new Set(first).size, 3, 'and they actually differ');
});

test('shuffled does not mutate its input', () => {
  const src = [1, 2, 3, 4, 5];
  const out = shuffled(src, makeRng('s'));
  assert.deepEqual(src, [1, 2, 3, 4, 5]);
  assert.equal(out.length, 5);
  assert.deepEqual([...out].sort((a, b) => a - b), src);
});

// ---------------------------------------------------------------------------
// THE DRAW
// ---------------------------------------------------------------------------

const weeks = (n) => Array.from({ length: n }, (_, i) => ({ season_year: 2015 + Math.floor(i / 17), week: (i % 17) + 1 }));

test('NO-REPEAT: a week already used is not drawn again', () => {
  const all = weeks(20);
  const used = all.slice(0, 19);
  const pick = drawWeek(all, used, makeRng('s'));
  assert.deepEqual({ season_year: pick.season_year, week: pick.week },
    { season_year: all[19].season_year, week: all[19].week }, 'only one week left, it must be that one');
  assert.equal(pick.recycled, false);
});

test('NO-REPEAT: 174 consecutive draws use all 174 weeks exactly once', () => {
  const all = weeks(174);
  const used = []; const seen = new Set();
  for (let d = 0; d < 174; d++) {
    const pick = drawWeek(all, used, makeRng(seedFor(`2026-01-${d}`, SECRET)));
    const k = `${pick.season_year}-${pick.week}`;
    assert.equal(seen.has(k), false, `week ${k} repeated on day ${d}`);
    assert.equal(pick.recycled, false);
    seen.add(k); used.push(pick);
  }
  assert.equal(seen.size, 174);
});

test('RECYCLE: once every week is used the draw starts over, and says so', () => {
  const all = weeks(3);
  const pick = drawWeek(all, all, makeRng('s'));
  assert.ok(pick);
  assert.equal(pick.recycled, true, 'the caller needs to know this is a second pass');
});

test('the draw is stable against candidate row order', () => {
  const all = weeks(30);
  const a = drawWeek(all, [], makeRng('s'));
  const b = drawWeek([...all].reverse(), [], makeRng('s'));
  assert.deepEqual([a.season_year, a.week], [b.season_year, b.week]);
});

test('an empty candidate list returns null rather than throwing', () => {
  assert.equal(drawWeek([], [], makeRng('s')), null);
});

// ---------------------------------------------------------------------------
// FLOOR ENFORCEMENT
// ---------------------------------------------------------------------------

test('FLOOR: the board is exactly the shape, per position', () => {
  const { ok, board } = buildBoard(eligible(), makeRng('s'));
  assert.equal(ok, true);
  const counts = board.reduce((a, p) => ({ ...a, [p.pos]: (a[p.pos] ?? 0) + 1 }), {});
  assert.deepEqual(counts, POOL_SHAPE);
  assert.equal(board.length, 12 + 18 + 24 + 10);
});

test('FLOOR: a short position REFUSES - it does not build a smaller board', () => {
  const r = buildBoard(eligible({ QB: 12, RB: 18, WR: 24, TE: 9 }), makeRng('s'));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'pool depth');
  assert.deepEqual(r.short, { TE: { have: 9, want: 10 } });
  assert.equal(r.board, undefined, 'nothing partial escapes');
});

test('FLOOR: exactly enough is enough', () => {
  const r = buildBoard(eligible({ QB: 12, RB: 18, WR: 24, TE: 10 }), makeRng('s'));
  assert.equal(r.ok, true);
});

test('the floor constant is the one the recon measured against', () => {
  assert.equal(PPR_FLOOR, 4);
  assert.deepEqual(POOL_SHAPE, { QB: 12, RB: 18, WR: 24, TE: 10 });
});

// ---------------------------------------------------------------------------
// THE LEAK TEST - asserts on the SERIALIZED payload
// ---------------------------------------------------------------------------

test('LEAK: the pre-close payload contains NO scores and NO teams', () => {
  const { board } = buildBoard(eligible(), makeRng('s'));
  const wire = JSON.stringify(publicBoard(board));

  assert.equal(/"points"/.test(wire), false, 'a score in the payload is the answer key');
  assert.equal(/"team"/.test(wire), false, 'the team is a season fingerprint - a 2015 Rams row says St. Louis');
  assert.equal(/XXX/.test(wire), false, 'and not by value either');

  // What it SHOULD carry.
  const parsed = JSON.parse(wire);
  assert.equal(parsed.length, 64);
  for (const p of parsed) {
    assert.deepEqual(Object.keys(p).sort(), ['id', 'name', 'pos', 'resume']);
  }
});

test('LEAK: publicBoard strips by DELETION, so a field added later leaks loudly', () => {
  // A whitelist would silently drop a new field; this drops the two named and
  // passes anything else through, which a test like the one above will catch.
  const out = publicBoard([{ id: 1, name: 'X', pos: 'QB', resume: null, points: 30, team: 'GB', futureField: 'z' }]);
  assert.equal(out[0].futureField, 'z', 'new fields survive - and are therefore visible to the leak test');
  assert.equal(out[0].points, undefined);
  assert.equal(out[0].team, undefined);
});

test('LEAK: the stored board DOES keep score and team - they are needed at reveal', () => {
  const { board } = buildBoard(eligible(), makeRng('s'));
  assert.ok(board.every((p) => typeof p.points === 'number' && p.team));
});

// ---------------------------------------------------------------------------
// RESUME - week-invariance
// ---------------------------------------------------------------------------

test('RESUME: no career span, no year, no team, and NO position prefix', () => {
  const line = resumeLine({ college: 'Michigan', draftRound: 2, draftPick: 51 });
  assert.equal(line, 'Michigan · R2 #51');
  assert.equal(/\b(19|20)\d\d\b/.test(line), false, 'a year in a resume narrows the answer');
  assert.equal(/^(QB|RB|WR|TE)/.test(line), false, 'the UI owns the slot label');
});

test('RESUME: an undrafted player is his college and nothing else - no filler word', () => {
  assert.equal(resumeLine({ college: 'Kutztown' }), 'Kutztown');
});

test('RESUME: neither college nor draft gives an EMPTY STRING, not a placeholder', () => {
  assert.equal(resumeLine({}), '');
  assert.equal(resumeLine(), '');
  // Absence over inference: the row renders without a resume rather than with
  // a word standing in for one.
});

test('RESUME: a round with no pick still reads', () => {
  assert.equal(resumeLine({ college: 'Iowa', draftRound: 7 }), 'Iowa · R7');
  assert.equal(resumeLine({ draftRound: 1, draftPick: 3 }), 'R1 #3');
});

// ---------------------------------------------------------------------------
// THE CAREER STAT
// ---------------------------------------------------------------------------

const BRADY = { g: 126, passYds: 35960, rushYds: 0, recYds: 0 };
const KAMARA = { g: 126, passYds: 0, rushYds: 7308, recYds: 4914 };

test('CAREER STAT: the position picks the number, and the label says which', () => {
  assert.equal(careerStat('QB', BRADY), '285 pass yds/gm · 126 g');
  assert.equal(careerStat('WR', { g: 100, recYds: 6500 }), '65 rec yds/gm · 100 g');
  assert.equal(careerStat('TE', { g: 100, recYds: 4100 }), '41 rec yds/gm · 100 g');
});

test('RUNNING BACKS ARE SCRIMMAGE, and this is the fixture that proves why', () => {
  // Kyle Juszczyk: a fullback. Rushing alone prints 2 yds/gm, which reads as
  // "useless" when the truth is "different job".
  const jusz = { g: 154, rushYds: 285, recYds: 2650 };
  assert.equal(careerStat('RB', jusz), '19 scrim yds/gm · 154 g');
  assert.notEqual(careerStat('RB', jusz), '2 scrim yds/gm · 154 g');
  // And a receiving back is not halved.
  assert.equal(careerStat('RB', KAMARA), '97 scrim yds/gm · 126 g');
  assert.equal(CAREER_STAT.RB.of(KAMARA), 7308 + 4914, 'rush AND receiving');
});

test('CAREER STAT: no games is null, not a division by zero', () => {
  assert.equal(careerStat('QB', { g: 0, passYds: 0 }), null);
  assert.equal(careerStat('QB', null), null);
  assert.equal(careerStat('QB', undefined), null);
  assert.equal(careerStat('K', { g: 50 }), null, 'a position with no defined stat says nothing');
});

test('CAREER STAT is a RATE so corpus truncation cannot make it lie', () => {
  // Our box scores start in 2015, so Brady shows 126 games where he played
  // about 335. The TOTAL would be wrong by two thirds; the RATE is exactly
  // right for the games we hold, and the games count discloses the sample.
  assert.match(careerStat('QB', BRADY), /126 g$/, 'the denominator is always shown');
});

test('COLLEGE: only the first school, because nflverse lists them newest-first', () => {
  assert.equal(firstCollege('Tennessee; Hutchinson CC; Alabama'), 'Tennessee');
  assert.equal(firstCollege('Wisconsin; N.C. State'), 'Wisconsin');
  assert.equal(firstCollege('Michigan'), 'Michigan');
  assert.equal(firstCollege(''), null);
  assert.equal(firstCollege(null), null);
  assert.equal(firstCollege('  ; Alabama'), null, 'a leading empty entry is not a school');
});

test('RESUME ORDER: the stat leads, because the row truncates from the TAIL', () => {
  const line = resumeLine({
    college: 'Tennessee; Hutchinson CC; Alabama', draftRound: 3, draftPick: 67,
    pos: 'RB', career: KAMARA,
  });
  assert.equal(line, '97 scrim yds/gm · 126 g · Tennessee · R3 #67');
  assert.ok(line.indexOf('scrim') < line.indexOf('Tennessee'),
    'college first would let a long school name ellipsize away the number');
});

test('RESUME: a player with a career but no college or draft still gets the stat', () => {
  assert.equal(resumeLine({ pos: 'QB', career: BRADY }), '285 pass yds/gm · 126 g');
});

test('RESUME: an unknown career leaves the old line intact rather than printing a zero', () => {
  assert.equal(resumeLine({ college: 'Michigan', draftRound: 6, draftPick: 199, pos: 'QB' }),
    'Michigan · R6 #199');
});
