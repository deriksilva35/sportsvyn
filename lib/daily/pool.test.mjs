// lib/daily/pool.test.mjs - the Daily's board generation.
//
// PURE, so "every user provably sees the same board" is checkable rather than
// hoped for. No database, no clock, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  makeRng, seedFor, shuffled, drawWeek, buildBoard, publicBoard, resumeLine,
  careerStat, firstCollege, POOL_SHAPE, PPR_FLOOR,
} = await import('./pool.js');
const { fantasyPoints } = await import('../fantasy/scoring.js');

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
  // The reveal's box-score line is named here rather than left to the key-set
  // assertion below, so the guard is greppable from the feature that could
  // break it. statLine() is reveal-only and attached at render; if a refactor
  // ever froze it onto the board, THIS is the line that fails.
  assert.equal(/"line"/.test(wire), false, 'a box score pre-close is the answer with extra steps');

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

// Career PPR components, summed. Named to match toStatLine()'s shape.
const BRADY  = { g: 126, passYds: 35960, passTd: 249, int: 78, rushYds: 195, rushTd: 12, rec: 0, recYds: 0, recTd: 0, fumblesLost: 21 };
const KAMARA = { g: 126, passYds: 0, passTd: 0, int: 0, rushYds: 7308, rushTd: 60, rec: 480, recYds: 4914, recTd: 24, fumblesLost: 10 };

test('CAREER PPG is scored in the game\'s own currency, one number for every position', () => {
  // 35960/25 + 249*4 - 78*2 + 195/10 + 12*6 - 21*2
  //   = 1438.4 + 996 - 156 + 19.5 + 72 - 42 = 2327.9
  // over 126 games = 18.475 -> 18.5 PPG.
  assert.equal(careerStat('QB', BRADY), '18.5 PPG · 126 g');
  // Same formatter, same unit, no position branch.
  assert.equal(careerStat('RB', KAMARA), careerStat('WR', KAMARA));
  assert.match(careerStat('RB', KAMARA), /^\d+\.\d PPG · 126 g$/);
});

test('CAREER PPG matches fantasyPoints on the summed line, exactly', () => {
  // The claim the implementation rests on: scoring.js is LINEAR, so scoring the
  // career sum equals summing the per-game scores. If a threshold or bonus is
  // ever added to scoring.js, this is the test that should start failing.
  const pts = fantasyPoints(BRADY, 'ppr');
  const expected = (Math.round((pts / BRADY.g) * 10) / 10).toFixed(1);
  assert.equal(careerStat('QB', BRADY), `${expected} PPG · 126 g`);
});

test('CAREER PPG always shows one decimal, so the column does not ragged', () => {
  const flat = { g: 10, passYds: 0, passTd: 0, int: 0, rushYds: 0, rushTd: 0, rec: 100, recYds: 0, recTd: 0, fumblesLost: 0 };
  assert.equal(careerStat('WR', flat), '10.0 PPG · 10 g', 'a whole number keeps its .0');
});

test('CAREER PPG: no games is null, not a division by zero', () => {
  assert.equal(careerStat('QB', { g: 0 }), null);
  assert.equal(careerStat('QB', null), null);
  assert.equal(careerStat('QB', undefined), null);
});

test('CAREER PPG: an unknown position still gets a number - PPG is position-free', () => {
  // The old per-position rates had to refuse anything outside QB/RB/WR/TE.
  // PPG does not, and that is the point of the change.
  assert.match(careerStat('K', KAMARA), /PPG · 126 g$/);
});

test('CAREER PPG is a RATE, so corpus truncation cannot make it lie', () => {
  // 126 games, not the ~335 Brady played. The rate is right for what we hold
  // and the games count discloses the sample.
  assert.match(careerStat('QB', BRADY), /126 g$/);
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
  assert.equal(line, `${careerStat('RB', KAMARA)} · Tennessee · R3 #67`);
  assert.ok(line.indexOf('PPG') < line.indexOf('Tennessee'),
    'college first would let a long school name ellipsize away the number');
});

test('RESUME: a player with a career but no college or draft still gets the stat', () => {
  assert.equal(resumeLine({ pos: 'QB', career: BRADY }), careerStat('QB', BRADY));
});

test('RESUME: an unknown career leaves the old line intact rather than printing a zero', () => {
  assert.equal(resumeLine({ college: 'Michigan', draftRound: 6, draftPick: 199, pos: 'QB' }),
    'Michigan · R6 #199');
});
