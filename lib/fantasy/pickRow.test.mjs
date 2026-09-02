// lib/fantasy/pickRow.test.mjs - the Pick row's three numbers and its range line.
//
// 2 Sep 2026, Derik's mock on the imported league (config 225): every PPG cell
// read '-' and every row's second line read "WR·CIN · ?-?". Diagnosed, not
// patched: the 2025-REG scoping in playerStats.js was right all along; the
// Fantrax import had written 417 pool rows with matched_player_id NULL and the
// identity join went dark. Three pins fall out of it:
//   1. an import resolves its own pool rows (the cron's "step 2 is not optional");
//   2. a stat with no value renders neither label nor separator - the ADP
//      window and its ' · ' come and go together;
//   3. VALUE is a canary: across a top-50 it is non-uniform, and starved input
//      renders '-' (null), never a column of zeros.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adpRange, signed1, fmt1 } from './statView.js';
import { valueGap } from './needs.js';
import { lineTwoTokens } from './lineTwo.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---- 2. the range line: empty and populated shapes ------------------------
test('adpRange: a window prints as two ranks; a missing bound prints NOTHING (null), never ?-?', () => {
  assert.equal(adpRange(3.4, 18.6), '3-19');
  assert.equal(adpRange('11.5', '11.5'), '12-12');
  assert.equal(adpRange(null, null), null, 'Fantrax rows: adp only, no window');
  assert.equal(adpRange(3.4, null), null, 'one bound is no window');
  assert.equal(adpRange(null, 18.6), null);
  assert.equal(adpRange('', ''), null);
  assert.equal(adpRange('x', 4), null, 'non-finite is missing, not NaN-NaN');
});

test('the Pick row joins the window with its own separator, and drops both together', () => {
  const room = stripComments(src('components/sim/DraftRoom.js'));
  assert.match(room, /const range = adpRange\(p\.adpHigh, p\.adpLow\);/);
  // RE-PINNED (lineTwo, 2 Sep 2026). This pinned the row's own
  // `{slot}{p.team ? `·${p.team}` : ''}{range && ` · ${range}`}`; the tag is now
  // built in lib/fantasy/lineTwo.js from the same three parts, with the same
  // rule - the window and its separator come and go together - and the row
  // hands `range` across untouched.
  assert.match(room, /lineTwoTokens\(\{ pos: slot, team: p\.team, range, quick,/,
    'the row passes position, team and the window to the shared tag');
  assert.equal(lineTwoTokens({ pos: 'WR', team: 'CIN', range: adpRange(3.4, 18.6) })[0].text, 'WR·CIN · 3-19',
    'position·team, then " · low-high" when there is a window');
  assert.equal(lineTwoTokens({ pos: 'WR', team: 'CIN', range: adpRange(null, null) })[0].text, 'WR·CIN',
    '...and NOTHING, separator included, when there is not');
  // RE-PINNED: the row used to print ` · {r0(p.adpHigh)}-{r0(p.adpLow)}` unconditionally;
  // r0(null) is '?' by design (an ADP rank is never missing on an FFC row), so a
  // Fantrax row read "?-?". The orphan is gone from the source, not special-cased.
  assert.doesNotMatch(room, /r0\(p\.adpHigh\)|r0\(p\.adpLow\)/);
  assert.equal((room.match(/adpRange\(/g) ?? []).length, 1, 'one derivation per row');
  // The PPG column keeps its fixed cell and its honest '-' (numcols.css .v.empty);
  // the header carries the label, so an empty stat prints no label of its own.
  assert.match(room, /className=\{`v\$\{sum \? '' : ' empty'\}`\}/);
  assert.match(room, /\{sum \? `\$\{approx \? '~' : ''\}\$\{fmt1\(sum\.ppg\)\}` : '-'\}/);
  const css = src('components/sim/numcols.css');
  assert.match(css, /\.ncol \{ width: 6ch;/, 'the column is fixed-width: an empty stat cannot collapse the row');
  assert.match(css, /\.ncol \.v\.empty \{ text-align: center;/);
});

// ---- 3. VALUE as a canary ---------------------------------------------------
// The top of the Fantrax pool as imported 1 Sep 2026 (real ADPs, PROD, ppr/12):
// a ladder, not a plateau. valueGap at a real pick over these must spread.
const TOP = [1.22, 3.37, 4.76, 7.16, 12.26, 13.1, 14.8, 15.9, 17.2, 18.4, 19.7, 21.3, 22.8, 24.1, 25.5,
  27.0, 28.6, 29.9, 31.4, 33.2, 34.7, 36.1, 37.8, 39.5, 41.0, 42.6, 44.3, 45.9, 47.2, 48.8, 50.1, 51.7,
  53.4, 55.0, 56.6, 58.3, 59.9, 61.2, 62.8, 64.5, 66.1, 67.7, 69.4, 71.0, 72.6, 74.3, 75.9, 77.5, 79.2, 80.8];

test('VALUE across a top-50 is non-uniform and non-null at a real pick; uniform zeros would be the starved-input signature', () => {
  assert.equal(TOP.length, 50);
  const at = 12; // seat 12's first pick, the run Derik re-pins
  const vals = TOP.map((adp) => valueGap(at, adp));
  assert.ok(vals.every((v) => v != null && Number.isFinite(v)), 'every row has a VALUE when adp is present');
  assert.ok(new Set(vals).size >= 45, `spread, not a plateau: ${new Set(vals).size} distinct of 50`);
  assert.ok(vals.some((v) => v > 0) && vals.some((v) => v < 0), 'both signs at pick 12: fallers above, reaches below');
  assert.ok(!vals.every((v) => v === 0), 'never a column of zeros');
  assert.equal(signed1(vals[0]), '+10.8', 'Gibbs (1.22) at 12 - the row Derik reads first');
  assert.equal(signed1(vals[4]), '-0.3', 'Lamb (12.26) at 12');
});

test('starved input renders as MISSING ("-"), not as zero - the two failure shapes are distinguishable', () => {
  // adp gone (the pool row lost its price): valueGap is null and the cell reads '-'.
  const starved = TOP.map(() => valueGap(12, null));
  assert.ok(starved.every((v) => v === null));
  assert.ok(starved.every((v) => signed1(v) === '-'));
  // pick gone (no currentOverall): same.
  assert.equal(valueGap(null, 3.37), null);
  // PPG's own missing shape: fmt1(null) is '-', and a summary that is absent is
  // not a summary with ppg 0 - the room checks `sum` before it formats.
  assert.equal(fmt1(null), '-');
  assert.equal(fmt1(0), '0.0', 'a real zero prints as a number; the room never reaches this for a missing player');
});

// ---- 1. the import resolves its own pool rows -----------------------------
test('the Fantrax import runs matchPoolIdentities after its pool write and before keepers; the summary reports the match', () => {
  const imp = stripComments(src('lib/fantrax/import.js'));
  assert.match(imp, /import \{ normalizeName, matchPoolIdentities \} from '\.\.\/gridiron\/nameMatch\.js';/);
  const insertAt = imp.indexOf('INSERT INTO sim_player_pool');
  const matchAt = imp.indexOf('const match = await matchPoolIdentities(sql);');
  const keepersAt = imp.indexOf('toKeepers(results, crosswalk, teams, adp)');
  assert.ok(insertAt > -1 && matchAt > -1 && keepersAt > -1);
  assert.ok(insertAt < matchAt && matchAt < keepersAt, 'pool INSERT -> match -> keepers');
  assert.match(imp, /summary\.poolMatched = match\.counts\.matched;/);
  assert.match(imp, /summary\.poolUnmatched = match\.unmatched\.map/);
  assert.match(imp, /summary\.poolAmbiguous = match\.ambiguous\.map/);
  // The matcher itself takes the whole pool - no source predicate - so one call
  // heals every universe, and the cron's call and the import's call are the same call.
  const nm = stripComments(src('lib/gridiron/nameMatch.js'));
  assert.match(nm, /SELECT DISTINCT name, position, team FROM sim_player_pool ORDER BY position, name/);
  assert.doesNotMatch(nm, /source =/);
});

// ---- 4. the season scoping stays as found -----------------------------------
test('PPG means 2025 REG until 2026 REG week 1 completes; the constants are unchanged and the comment names the handoff', () => {
  const ps = src('lib/fantasy/playerStats.js');
  assert.match(ps, /^const SEASON_YEAR = 2025;$/m);
  assert.match(ps, /^const SEASON_PHASE = 'REG';$/m);
  assert.match(ps, /handoff\s*\n?\/\/ is 2026 REG week 1 \(games of Thu 10 Sep - Mon 14 Sep 2026\)/);
  assert.match(stripComments(ps), /m\.season_phase = \$\{SEASON_PHASE\} AND m\.season_year = \$\{SEASON_YEAR\}/);
});
