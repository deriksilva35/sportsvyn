// lib/mockNba/mockNba.test.mjs - the NBA mock draft, pure (sun-5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fppg, svValue, POINTS_LEAGUE } from './scoring.js';
import { eligible, SLOTS, ROUNDS, TEAMS, emptyRoster, place, rosterFromIds } from './roster.js';
import { createMock, runBots, applyPick, legalFor, isDone, onClock, bestFor, TOTAL } from './draft.js';
import { gradeMock } from './grade.js';
import { encodeShare, decodeShare } from './share.js';
import { shapeNbaMockPool, POOL_MIN, ROOKIE_BASE } from './pool.js';

// A synthetic pool shaped like the real one: guards, forwards, centers, pairs.
const POS = ['G', 'G', 'F', 'F', 'G', 'F', 'C', 'G-F', 'F-C', 'G', 'F', 'C-F'];
const pool = (n = 260) => Array.from({ length: n }, (_, i) => ({
  id: 1000 + i, name: `Player ${i}`, pos: POS[i % POS.length], team: 'AAA', fppg: 40 - i * 0.1, gp: 70, sv: 4000 - i * 10, rank: i + 1, rookie: false,
}));

test('the points-league preset, as ruled', () => {
  assert.deepEqual(POINTS_LEAGUE, { pts: 1, fg3m: 1, fga: -1, fgm: 2, fta: -1, ftm: 1, reb: 1, ast: 2, stl: 4, blk: 4, turnover: -2 });
  // 25 pts, 2 3PM, 18 FGA, 9 FGM, 6 FTA, 5 FTM, 8 REB, 6 AST, 1 STL, 1 BLK, 3 TO
  const s = { gp: 70, pts: 25, fg3m: 2, fga: 18, fgm: 9, fta: 6, ftm: 5, reb: 8, ast: 6, stl: 1, blk: 1, turnover: 3 };
  assert.equal(fppg(s), 25 + 2 - 18 + 18 - 6 + 5 + 8 + 12 + 4 + 4 - 6);
  assert.equal(svValue(fppg(s), 70), Math.round(fppg(s) * 70));
  assert.equal(svValue(fppg(s), 90), Math.round(fppg(s) * 82), 'expected games cap at 82');
  assert.equal(fppg({ gp: 0, pts: 10 }), null);
});

test('positions: G/F/C from BDL map to slots; pairs are the union; UTIL for all', () => {
  assert.deepEqual([...eligible('G')].sort(), ['G', 'PG', 'SG', 'UTIL']);
  assert.deepEqual([...eligible('F-C')].sort(), ['C', 'F', 'PF', 'SF', 'UTIL']);
  assert.deepEqual([...eligible('C')].sort(), ['C', 'UTIL']);
  assert.equal(SLOTS.length, 13); assert.equal(ROUNDS, 13); assert.equal(TEAMS, 12);
  let r = emptyRoster();
  r = place(r, { id: 1, pos: 'G', name: 'a' }); r = place(r, { id: 2, pos: 'G', name: 'b' }); r = place(r, { id: 3, pos: 'G', name: 'c' });
  assert.deepEqual(r.filter((x) => x.player).map((x) => x.slot), ['PG', 'SG', 'G'], 'most specific first, then G');
});

test('pool: last season\'s line ranks the vets; first-round rookies by slot; no line, no place', () => {
  const roster = [
    ...Array.from({ length: 60 }, (_, i) => ({ id: i + 1, first_name: 'V', last_name: String(i), position: 'G', team: { abbreviation: 'AAA' } })),
    { id: 900, first_name: 'Top', last_name: 'Rookie', position: 'F', draft_year: 2026, draft_round: 1, draft_number: 1, team: { abbreviation: 'BBB' } },
    { id: 901, first_name: 'Late', last_name: 'Second', position: 'G', draft_year: 2026, draft_round: 2, draft_number: 45, team: {} },
    { id: 902, first_name: 'No', last_name: 'Line', position: 'C', draft_year: 2019, draft_round: 1, draft_number: 9, team: {} },
  ];
  const averages = new Map(Array.from({ length: 60 }, (_, i) => [String(i + 1), { gp: 70, pts: 30 - i * 0.3, reb: 5, ast: 3 }]));
  const rows = shapeNbaMockPool(roster, averages);
  assert.equal(rows.length, 61, '60 vets + the first-round rookie');
  assert.ok(rows.every((r, i) => r.rank === i + 1));
  const rk = rows.find((r) => r.id === 900);
  assert.equal(rk.rookie, true);
  assert.equal(rk.rank, ROOKIE_BASE + 1, 'the #1 pick slots in just below the vet ranked ROOKIE_BASE');
  assert.ok(!rows.some((r) => r.id === 901 || r.id === 902));
});

test('bots never stall and every team fills all 13 slots legally - every seat, many seeds', () => {
  const p = pool();
  for (let seed = 1; seed <= 25; seed += 1) {
    for (const userSeat of [0, 5, 11]) {
      let st = runBots(createMock(p, { userSeat, seed }));
      while (!isDone(st)) {
        assert.equal(onClock(st), userSeat, 'the bots stop only at the user');
        // The user picks a random LEGAL player (not always the best).
        const legal = legalFor(st, userSeat);
        assert.ok(legal.length > 0, 'the user always has a legal pick');
        st = runBots(applyPick(st, legal[(seed * 7 + st.picks.length) % Math.min(legal.length, 10)].id, 'user'));
      }
      assert.equal(st.picks.length, TOTAL);
      for (const r of st.rosters) {
        assert.equal(r.filter((x) => x.player).length, 13, 'every slot filled');
      }
      assert.equal(new Set(st.picks.map((x) => x.id)).size, TOTAL, 'nobody taken twice');
    }
  }
});

test('a seed replays exactly: same seed, same user picks, same draft', () => {
  const p = pool();
  const play = () => { let st = runBots(createMock(p, { userSeat: 3, seed: 42 })); while (!isDone(st)) st = runBots(applyPick(st, bestFor(st).id, 'user')); return st.picks.map((x) => x.id).join(','); };
  assert.equal(play(), play());
});

test('an illegal or taken pick is refused', () => {
  const p = pool();
  const st = runBots(createMock(p, { userSeat: 0, seed: 1 }));
  const first = legalFor(st, 0)[0];
  const after = applyPick(st, first.id, 'user');
  assert.throws(() => applyPick(after, first.id, 'bot'), /not available/);
});

test('the grade: a place among 12 and a steal', () => {
  const p = pool();
  let st = runBots(createMock(p, { userSeat: 0, seed: 9 }));
  while (!isDone(st)) st = runBots(applyPick(st, bestFor(st).id, 'user'));
  const g = gradeMock(st);
  assert.ok(g.place >= 1 && g.place <= 12);
  assert.match(g.grade, /^(A\+|A-|A|B\+|B|C\+|C|D)$/);
  assert.ok(g.value > 0);
});

test('the share card payload round-trips; anything malformed is refused; the roster rebuilds', () => {
  const d = encodeShare({ grade: 'A-', seat: 7, ids: [1003, 1010, 1020] });
  assert.match(d, /^[A-Za-z0-9_-]+$/, 'url-safe');
  assert.deepEqual(decodeShare(d), { grade: 'A-', seat: 7, ids: [1003, 1010, 1020] });
  for (const bad of ['', 'xx', encodeShare({ grade: 'Z', seat: 1, ids: [1] }), encodeShare({ grade: 'A', seat: 13, ids: [1] })]) {
    assert.equal(decodeShare(bad), null, String(bad));
  }
  const r = rosterFromIds([1000, 1006, 1001], pool());
  assert.deepEqual(r.filter((x) => x.player).map((x) => [x.slot, x.player.id]), [['PG', 1000], ['SG', 1001], ['C', 1006]]);
});

test('POOL_MIN leaves a choice at the last pick', () => {
  assert.ok(POOL_MIN > TOTAL);
});
