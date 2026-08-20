// components/sim/colGrid.test.mjs - the shared numeric column grid.
//
// The defect this pins against: per-row flex sizing let PPG/ADP/VAL drift
// per row and per sort, bare integers sat next to decimals, and the tag line
// repeated the number the column already showed. The cure is structural -
// one grid definition, one formatter pair - so the pins are structural too.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmt1, signed1 } from '../../lib/fantasy/statView.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const ROOMS = ['components/sim/DraftRoom.js', 'components/sim/TrackerRoom.js'];

test('one decimal everywhere: the formatters, exactly', () => {
  assert.equal(fmt1(2), '2.0');
  assert.equal(fmt1(-28), '-28.0');
  assert.equal(fmt1(12.34), '12.3');
  assert.equal(fmt1(undefined), '-');
  assert.equal(signed1(3.9), '+3.9');
  assert.equal(signed1(0), '+0.0');
  assert.equal(signed1(-28), '-28.0');
  assert.equal(signed1(null), '-');
});

test('the grid is defined ONCE, in numcols.css, and nowhere else', () => {
  const grid = src('components/sim/numcols.css');
  assert.match(grid, /\.ncol \{ width: 6\.5ch/, 'fixed ch width - content cannot size it');
  assert.match(grid, /\.nrail \{[\s\S]*?width: 5\.5ch/, 'the rail is fixed too');
  assert.match(grid, /font-variant-numeric: tabular-nums/);
  assert.ok(!/min-width: 0/.test(grid), 'no shrink escape hatch inside the grid');
  assert.match(src('components/sim/sim.css'), /@import '\.\/numcols\.css'/,
    'sim.css carries the one import both rooms ride');
  for (const rel of ['components/sim/sim.css', 'components/sim/tracker.css']) {
    const t = src(rel);
    assert.ok(!/\.ncol[\s.{]*\{[^}]*width/.test(t), `${rel} must not re-size the grid`);
    assert.ok(!/trk-num|p-num \{/.test(t), `${rel} still carries the old per-room columns`);
  }
});

test('both rooms render through the shared classes and formatters', () => {
  for (const rel of ROOMS) {
    const t = src(rel);
    assert.match(t, /className="ncols"/, `${rel}: shared column group`);
    assert.match(t, /className="ncol"/, `${rel}: shared column`);
    assert.match(t, /fmt1\(sum\.ppg\)/, `${rel}: PPG through fmt1`);
    assert.match(t, /signed1\(val/, `${rel}: VAL through signed1`);
    assert.ok(!/trk-num|p-num/.test(t), `${rel}: the old per-room classes are gone`);
  }
});

test('the tag line lost the VAL duplicate - the column owns the number', () => {
  const t = src('components/sim/TrackerRoom.js');
  assert.ok(!/gapChip/.test(t), 'the tag-line gap chip is gone, definition included');
  // The seat-valuation detail line keeps ITS numbers (gap AT the user's next
  // pick + slot state) - different facts, still one home each.
  assert.match(t, /seatRead\.gap > 0 \? '\+' : ''/, 'the MY TEAM detail line survives');
});

test('ADP stays an integer - it is a rank, not a measurement', () => {
  assert.match(src('components/sim/DraftRoom.js'), /className="v dim">\{r0\(p\.adp\)\}/);
  assert.match(src('components/sim/TrackerRoom.js'), /className="v dim">\{Math\.round\(Number\(p\.adp\)\)\}/);
});
