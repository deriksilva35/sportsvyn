// lib/gridiron/playText.test.mjs - the display-only CFB play cleanup, on real
// CFBD strings read read-only from PROD (150 final games, 20,000 rows).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfbPlayText } from './playText.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const REAL = [
  ['(04:51) Shotgun #24 B.MacCormack III rush middle for 3 yards gain to the GT 31 (#27 T.Harris)',
    'B.MacCormack III rush middle for 3 yards gain to the GT 31 (T.Harris)'],
  ['(10:07) No Huddle-Shotgun #21 L.Phillips Jr. rush middle for 1 yard gain to the IOWA50 (#4 Z.Harden)',
    'L.Phillips Jr. rush middle for 1 yard gain to the IOWA50 (Z.Harden)'],
  ['(10:18) #28 K.Moulton rush middle for 0 yards to the IOWA42 (#4 Z.Harden; #70 N.Crowder)',
    'K.Moulton rush middle for 0 yards to the IOWA42 (Z.Harden; N.Crowder)'],
  ['(05:30) Shotgun #5 D.Lindsey pass complete short right to #4 R.Voss caught at MINN43, for 4 yards to the MINN46 (#3 J.Watson)',
    'D.Lindsey pass complete short right to R.Voss caught at MINN43, for 4 yards to the MINN46 (J.Watson)'],
  ['(14:57) No Huddle-Shotgun #11 S.Saunders pass incomplete deep left to #5 B.Emanuel, Jr. thrown to CSU00 broken up by #7 J.Lessard PENALTY CSU Pass Interference (#7 J.Lessard) 15 yards from CSU36 to CSU21, 1ST DOWN. NO PLAY',
    'S.Saunders pass incomplete deep left to B.Emanuel, Jr. thrown to CSU00 broken up by J.Lessard PENALTY CSU Pass Interference (J.Lessard) 15 yards from CSU36 to CSU21, 1ST DOWN. NO PLAY'],
  ['(10:36) No Huddle-Shotgun #1 K.Taylor sacked for loss of 5 yards to the State25 (#0 D.Stone)',
    'K.Taylor sacked for loss of 5 yards to the State25 (D.Stone)'],
];

for (const [raw, clean] of REAL) {
  test(`real CFBD string: ${raw.slice(0, 48)}...`, () => {
    assert.equal(cfbPlayText(raw), clean);
  });
}

test('the clock is stripped, the formation prefixes are stripped, the order does not matter to the result', () => {
  assert.equal(cfbPlayText('(01:50) No Huddle J.Doe rush for 2 yards'), 'J.Doe rush for 2 yards');
  assert.equal(cfbPlayText('(01:50) Shotgun J.Doe rush for 2 yards'), 'J.Doe rush for 2 yards');
  assert.equal(cfbPlayText('(15:00) No Huddle-Shotgun J.Doe rush for 2 yards'), 'J.Doe rush for 2 yards');
});

test('"forced by #5 D.Herard" and a tackler in parentheses lose the number', () => {
  assert.equal(cfbPlayText('A.Smith fumbled, forced by #5 D.Herard, recovered by #9 K.Lee (#2 T.Newsome Jr.)'),
    'A.Smith fumbled, forced by D.Herard, recovered by K.Lee (T.Newsome Jr.)');
});

test('single-digit and zero jerseys', () => {
  assert.equal(cfbPlayText('#0 A.B rush (#8 C.D)'), 'A.B rush (C.D)');
});

test('everything else is verbatim: no clock, no prefix, no number', () => {
  for (const s of ['End of 2nd quarter.', 'Kneel down by P.Lopez for -1 yards', 'Penalty on #5? unknown', 'Team wins the toss (15:00)']) {
    assert.equal(cfbPlayText(s), s);
  }
});

test('a "#" that is not a jersey number before a name stays', () => {
  assert.equal(cfbPlayText('Play #12 reviewed'), 'Play #12 reviewed');
  assert.equal(cfbPlayText('Section C#7'), 'Section C#7');
});

test('a formation word in the middle of a sentence is not a prefix', () => {
  assert.equal(cfbPlayText('J.Doe rush, Shotgun formation noted'), 'J.Doe rush, Shotgun formation noted');
});

test('double spaces left behind are tidied; null and empty are safe', () => {
  assert.equal(cfbPlayText('(01:50)  Shotgun  #7  A.B rush'), 'A.B rush');
  assert.equal(cfbPlayText(null), null);
  assert.equal(cfbPlayText(undefined), undefined);
  assert.equal(cfbPlayText(''), '');
});

test('it is idempotent', () => {
  for (const [raw] of REAL) assert.equal(cfbPlayText(cfbPlayText(raw)), cfbPlayText(raw));
});

test('every CFB play-text surface goes through it, and the NFL page does not', () => {
  const page = src('app/cfb/game/[slug]/page.js');
  assert.match(page, /<LastPlay play=\{stripLastPlay\} format=\{cfbPlayText\} \/>/);
  assert.match(page, /<DriveChart [^>]*format=\{cfbPlayText\}/);
  const view = src('lib/gridiron/gamePageArcadeView.js');
  assert.match(view, /text: clean\(p\.text \?\? ''\)/, 'plays list and All plays');
  assert.match(view, /summary: scoringSummary\(clean\(s\.text\)/, 'scoring plays');
  assert.match(view, /lastPlay: state === 'live' \? clean\(/, 'the card last-play line');
  assert.match(view, /cleanDrive\(driveStripFor/, 'the field strip last-play line');
  const nfl = src('app/nfl/game/[slug]/page.js');
  assert.doesNotMatch(nfl, /playText|cfbPlayText/);
});
