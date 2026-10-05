// lib/daily/shareCard.test.mjs - the Daily share card's model (relay mon-12).
//
// PURE: what the card may say on the open day (nothing that names a pick),
// what it says after close (every pick, the stars, % of perfect), when a rank
// may appear (25+ played), and the three lines of text sent beside it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shareCardModel, shareText, rankLine, shortName, shortDate, fmtTotal, slotChip,
  RANK_MIN_PLAYED, CARD_WIDTH, CARD_HEIGHT, CARD_PATH,
} from './shareCard.js';
import { POSITION_INK } from '../brand/dailyCardPalette.js';

const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K'];

// A closed grade, the shape gradeFromOptimum returns: eight rows, each with the
// reader's pick (`you`) and a `hit` when that player is in the perfect lineup.
const PICKS = [
  ['QB', 'Tom Brady', 'TB', 386.2, true],
  ['RB', 'Joe Mixon', 'CIN', 290.0, true],
  ['RB', 'Ezekiel Elliott', 'DAL', 250.2, false],
  ['WR', 'Jaylen Waddle', 'MIA', 227.0, true],
  ['WR', 'DK Metcalf', 'SEA', 215.3, false],
  ['TE', 'Dallas Goedert', 'PHI', 135.0, false],
  ['FLEX', 'Nick Chubb', 'CLE', 214.0, true],
  ['K', 'Nick Folk', 'NE', 199.0, true],
];
const GRADE = {
  ok: true,
  perfect: 2178.4,
  rows: PICKS.map(([slot, name, abbr, points, hit]) => ({
    hit, you: { slot, name, abbr, points }, best: { slot, name: hit ? name : 'Someone Else', abbr: 'XXX', points: points + 50 },
  })),
};
const SCORE = PICKS.reduce((s, p) => s + p[3], 0); // 1916.7

const openModel = (over = {}) => shareCardModel({
  phase: 'open', editionDate: '2026-10-05', seasonYear: 2021, streak: 2, score: 1917, slots: SLOTS, ...over,
});
const closedModel = (over = {}) => shareCardModel({
  phase: 'closed', editionDate: '2026-10-05', seasonYear: 2021, streak: 2, score: SCORE, grade: GRADE, ...over,
});

test('the card is 1080x1680 - 9:14, the mock\'s 360x560 at 3x', () => {
  assert.equal(CARD_WIDTH, 1080); assert.equal(CARD_HEIGHT, 1680);
  assert.equal(CARD_WIDTH * 14, CARD_HEIGHT * 9);
  assert.equal(CARD_PATH('2026-10-05'), '/daily/board/2026-10-05/card');
});

test('SAME DAY: header, streak, score, the challenge, eight slots in position colours, the midnight line', () => {
  const m = openModel();
  assert.equal(m.phase, 'open');
  assert.equal(m.header, 'THE DAILY · OCT 5 · 2021');
  assert.equal(m.streak, 2);
  assert.equal(m.scoreLabel, '1,917');
  assert.equal(m.challenge, 'CAN YOU BEAT IT?');
  assert.equal(m.footnote, 'Picks revealed at midnight.');
  assert.equal(m.footRight, 'sportsvyn.com/daily');
  assert.deepEqual(m.slots.map((s) => s.slot), SLOTS);
  assert.deepEqual(m.slots.map((s) => s.ink), SLOTS.map((s) => POSITION_INK[s]));
});

test('SAME DAY HIDES EVERY PICK: no name, no team, no per-slot points anywhere in the model', () => {
  // Built from a model that WAS handed the closed grade's picks by mistake:
  // the open card must still carry nothing of them.
  const m = openModel({ grade: GRADE });
  const wire = JSON.stringify(m);
  for (const [, name, abbr, points] of PICKS) {
    assert.ok(!wire.includes(name), `name leaked: ${name}`);
    assert.ok(!wire.includes(shortName(name)), `short name leaked: ${shortName(name)}`);
    assert.ok(!new RegExp(`"${abbr}"`).test(wire), `team leaked: ${abbr}`);
    assert.ok(!wire.includes(String(points.toFixed(1))), `slot points leaked: ${points}`);
  }
  for (const s of m.slots) assert.deepEqual(Object.keys(s).sort(), ['ink', 'slot']);
  for (const k of ['rows', 'pctLabel', 'starCount', 'legend']) assert.equal(k in m, false, `${k} on the open card`);
});

test('AFTER CLOSE: every pick with slot, player, team and season points; a star on each perfect-lineup pick', () => {
  const m = closedModel();
  assert.equal(m.phase, 'closed');
  assert.equal(m.rows.length, 8);
  assert.deepEqual(m.rows[0], { slot: 'QB', ink: POSITION_INK.QB, name: 'T. Brady', team: 'TB', points: '386.2', star: true });
  assert.deepEqual(m.rows[4], { slot: 'WR', ink: POSITION_INK.WR, name: 'DK Metcalf', team: 'SEA', points: '215.3', star: false });
  assert.deepEqual(m.rows.map((r) => r.star), PICKS.map((p) => p[4]));
  assert.equal(m.starCount, 5);
  assert.equal(m.slotCount, 8);
  assert.equal(m.legend, '= in the perfect lineup');
});

test('% of perfect is WHOLE on the card (relay mon-18), and 100% only when earned', () => {
  assert.equal(closedModel().pctLabel, '88%'); // 1916.7 / 2178.4 = 87.99%
  assert.equal(closedModel({ score: 2178.4 }).pctLabel, '100%');
  assert.equal(closedModel({ score: 2178.3 }).pctLabel, '99%', 'a shortfall that rounds to 100 is held at 99');
  assert.equal(closedModel({ score: 1100 }).pctLabel, '50%');
  assert.equal(closedModel({ grade: { ...GRADE, perfect: 0 } }).pctLabel, null, 'no ceiling, no percentage');
});

test('an empty slot (the clock ran out) is a row with no player, never a star', () => {
  const grade = { ...GRADE, rows: GRADE.rows.map((r, i) => (i === 7 ? { hit: false, you: { slot: 'K', name: null, abbr: null, points: 0 } } : r)) };
  const m = closedModel({ grade });
  assert.deepEqual(m.rows[7], { slot: 'K', ink: POSITION_INK.K, name: null, team: null, points: null, star: false });
});

test(`RANK ONLY WITH A FIELD: nothing below ${RANK_MIN_PLAYED} played, "#r of n · beat p%" at ${RANK_MIN_PLAYED}+`, () => {
  assert.equal(RANK_MIN_PLAYED, 25);
  assert.equal(rankLine({ rank: 1, played: 24, beatPct: 100 }), null);
  assert.equal(rankLine({ rank: 3, played: 25, beatPct: 91 }), '#3 of 25 · beat 91%');
  assert.equal(rankLine({ rank: 12, played: 1400, beatPct: null }), '#12 of 1,400');
  assert.equal(openModel({ played: 24, rank: 1, beatPct: 100 }).rankLine, null);
  assert.equal(openModel({ played: 40, rank: 2, beatPct: 97 }).rankLine, '#2 of 40 · beat 97%');
  assert.equal(closedModel({ played: 3, rank: 1, beatPct: 100 }).rankLine, null);
  assert.equal(closedModel({ played: 30, rank: 4, beatPct: 89 }).rankLine, '#4 of 30 · beat 89%');
});

test('THE TEXT: date and season, points and streak, the challenge or % of perfect', () => {
  assert.equal(shareText(openModel()), 'The Daily · Oct 5 · 2021\n1,917 pts 🔥2\nCan you beat it? sportsvyn.com/daily');
  assert.equal(shareText(closedModel({ score: 1917 })), 'The Daily · Oct 5 · 2021\n1,917 pts 🔥2\n88% of perfect · sportsvyn.com/daily');
  assert.equal(shareText(closedModel()).split('\n')[1], '1,917 pts 🔥2', 'the text\'s score is the card\'s: whole points');
  assert.equal(shareText(openModel({ streak: 0 })).split('\n')[1], '1,917 pts', 'no streak, no flame');
  assert.equal(shareText(openModel({ streak: null })).split('\n')[1], '1,917 pts');
});

test('RANK IN THE TEXT TOO (relay mon-18), under the same 25+ rule', () => {
  assert.equal(shareText(openModel({ played: 40, rank: 3, beatPct: 94 })),
    'The Daily · Oct 5 · 2021\n1,917 pts 🔥2\n#3 of 40 · beat 94%\nCan you beat it? sportsvyn.com/daily');
  assert.equal(shareText(closedModel({ score: 1917, played: 25, rank: 2, beatPct: 95 })),
    'The Daily · Oct 5 · 2021\n1,917 pts 🔥2\n#2 of 25 · beat 95%\n88% of perfect · sportsvyn.com/daily');
  assert.ok(!shareText(openModel({ played: 24, rank: 1, beatPct: 100 })).includes('#1'), '24 played: no rank in the text');
  assert.ok(!shareText(closedModel({ played: 3, rank: 1, beatPct: 100 })).includes('beat'), 'nor on the closed card\'s text');
});

test('the text names no player, on either card, and no data vendor', () => {
  for (const t of [shareText(openModel()), shareText(closedModel())]) {
    for (const [, name] of PICKS) assert.ok(!t.includes(name) && !t.includes(shortName(name)));
  }
});

test('the big number steps down to fit its row, never below 84px', async () => {
  const { scoreFontSize } = await import('./shareCard.js');
  assert.equal(scoreFontSize('1,917', 936), 138, 'the mock\'s size when it fits');
  assert.ok(scoreFontSize('1,937.7', 560) * 7 * 0.83 <= 560, 'a long label still leaves room for the percentage');
  assert.equal(closedModel().scoreLabel, '1,917');
  assert.equal(scoreFontSize('1,234,567,890.1', 300), 84);
  assert.equal(openModel().scoreSize, 138);
});

test('formatting helpers', () => {
  assert.equal(shortDate('2026-10-05'), 'Oct 5');
  assert.equal(shortDate('2026-12-31'), 'Dec 31');
  assert.equal(shortDate('nope'), null);
  assert.equal(fmtTotal(1917), '1,917');
  assert.equal(fmtTotal(1917.44), '1,917');
  assert.equal(fmtTotal(1937.7), '1,938', 'whole points, rounded (relay mon-18)');
  assert.equal(shortName('Amon-Ra St. Brown'), 'A. St. Brown');
  assert.equal(shortName('AJ Brown'), 'AJ Brown');
  assert.equal(shortName('T.J. Hockenson'), 'T.J. Hockenson');
  assert.equal(shortName('Cher'), 'Cher');
  assert.deepEqual(slotChip('FLEX2'), { slot: 'FLEX', ink: POSITION_INK.FLEX }, 'a legacy board\'s FLEX2 reads FLEX');
});
