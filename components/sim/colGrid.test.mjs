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
  assert.match(grid, /\.ncol \{ width: 6ch/, 'fixed ch width - content cannot size it');
  assert.match(grid, /\.nrail \{[\s\S]*?width: 5\.5ch/, 'the rail is fixed too');
  assert.match(grid, /font-variant-numeric: tabular-nums/);
  // The shrink prohibition scopes to the COLUMNS - .ncell is the sanctioned
  // shrink point and carries min-width:0 by design.
  for (const m of grid.matchAll(/\.(ncols?|nrail)[^{]*\{([^}]*)\}/g)) {
    assert.ok(!/min-width/.test(m[2]), `no shrink escape hatch inside ${m[0].slice(0, 20)}`);
  }
  assert.match(src('components/sim/sim.css'), /@import '\.\/numcols\.css'/,
    'sim.css carries the one import both rooms ride');
  for (const rel of ['components/sim/sim.css', 'components/sim/tracker.css']) {
    // COMMENTS STRIPPED FIRST. This guard scans for `.nhead ... { ... }` and
    // rejects any position/width/padding inside. A comment that MENTIONS
    // .nhead - explaining, say, why an offset was removed - puts the scan into
    // prose, and the next `{` it finds is a real rule whose body then reads as
    // a violation. The rule is right; reading it out of raw source was not.
    const t = src(rel).replace(/\/\*[\s\S]*?\*\//g, '');
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
  // The seat-valuation detail line keeps ITS numbers (gap + slot state) -
  // different facts, still one home each.
  // RE-PINNED (lineTwo copy, 2 Sep 2026): this matched the tracker's own
  // `seatRead.gap > 0 ? '+' : ''`; the signed gap is now built once in
  // lib/fantasy/lineTwo.js and the tracker renders the token's text.
  assert.match(t, /className=\{`trk-gap \$\{seatRead\.gap > 0 \? 'val' : 'rch'\}`\}/, 'the MY TEAM detail line survives');
  assert.match(t, /lineTwoTokens\(\{ pos, team: p\.team, quick, seatSort, seatRead \}\)/, '...fed by the shared token order');
});

test('the deck never wraps - the name ellipsizes, line 2 drops facts whole, shared definition', () => {
  const grid = src('components/sim/numcols.css');
  // The shrink enabler lives on the DECK; the grid itself stays unshrinkable
  // (the no-min-width pin above scopes to .ncol/.nrail rules, and .ndeck is
  // the sanctioned exception by name).
  assert.match(grid, /\.ndeck \{ flex: 1 1 auto; min-width: 0;/);
  // RE-PINNED (DST names, 2 Sep 2026). This pinned `.ndeck .nm, .ndeck .tag,
  // .ndeck .rng { display: block; overflow: hidden; text-overflow: ellipsis;
  // white-space: nowrap;` - one ellipsis law for all three lines. On line 2
  // the ellipsis cut a stat mid-token: every defense read "DST·HOU · 42 …",
  // a number whose label was the part that got trimmed. The name keeps the
  // ellipsis (a cut name is still that name); line 2 is a one-line-tall
  // wrapping flex row whose tokens are whole facts, and the fact that does
  // not fit is dropped, not cut. No text-overflow on line 2 at all.
  assert.match(grid, /\.ndeck \.nm \{\n  display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/,
    'the name truncates, never wraps');
  assert.match(grid, /\.ndeck \.tag, \.ndeck \.rng \{\n  display: flex; flex-wrap: wrap; align-content: flex-start; align-items: baseline;\n  column-gap: \.3em; overflow: hidden; line-height: 1\.4; height: 1\.4em;/,
    'line 2 is one line tall and fits by whole tokens');
  assert.match(grid, /\.ndeck \.tag > \*, \.ndeck \.rng > \* \{ flex: none; white-space: nowrap; line-height: 1; \}/);
  const line2Rule = grid.slice(grid.indexOf('.ndeck .tag, .ndeck .rng {'), grid.indexOf('.ndeck .tag > *'));
  assert.doesNotMatch(line2Rule, /text-overflow/, 'no ellipsis on line 2');
  // The R badge rides INSIDE the nowrap name span in both rooms - it cannot
  // orphan onto its own line.
  for (const rel of ROOMS) {
    assert.match(src(rel), /className="nm">\{p\.name\}<RookieChip/, `${rel}: chip inside the name`);
  }
});

test('the restack: name owns line 1, columns live on line 2, values only', () => {
  for (const rel of ROOMS) {
    const t = src(rel);
    const row = t.slice(t.indexOf('className="ndeck"'));
    const line1 = row.slice(row.indexOf('className="nline1"'), row.indexOf('className="nline2"'));
    assert.match(line1, /className="nm"/, `${rel}: the name rides line 1`);
    assert.ok(!line1.includes('ncols'), `${rel}: no column intrusion on the name line`);
    const line2 = row.slice(row.indexOf('className="nline2"'), row.indexOf('</button>'));
    assert.match(line2, /className="ncols"/, `${rel}: the grid rides line 2`);
    // Values only - the per-value label sub-line is deleted from the rows.
    for (const lbl of ['PPG', 'ADP', 'VAL']) {
      assert.ok(!t.includes(`"lbl">${lbl}`), `${rel}: row ${lbl} label must live in the header`);
    }
  }
});

test('one header row seats the labels over the columns by shared geometry', () => {
  const grid = src('components/sim/numcols.css');
  assert.match(grid, /\.nhead \.ncols \{ margin-left: auto; \}/);
  assert.match(grid, /\.nghost \{ visibility: hidden; \}/,
    'the phantom button reserves the real button column');
  // STICKY, in the shared rule only: pinned to its scroller with an opaque
  // surface, so labels stay visible down the whole list. Rooms may retarget
  // the two custom properties; the position itself is not per-room.
  assert.match(grid, /position: sticky; top: var\(--nhead-top, 0px\); z-index: 5;/);
  assert.match(grid, /background: var\(--nhead-bg, var\(--ink, #0A0A0A\)\);/);
  for (const rel of ['components/sim/sim.css', 'components/sim/tracker.css']) {
    // COMMENTS STRIPPED FIRST. This guard scans for `.nhead ... { ... }` and
    // rejects any position/width/padding inside. A comment that MENTIONS
    // .nhead - explaining, say, why an offset was removed - puts the scan into
    // prose, and the next `{` it finds is a real rule whose body then reads as
    // a violation. The rule is right; reading it out of raw source was not.
    const t = src(rel).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of t.matchAll(/\.nhead[^{]*\{([^}]*)\}/g)) {
      assert.ok(!/position|width|padding/.test(m[1]),
        `${rel}: room .nhead rules may set --nhead-* vars only`);
    }
  }
  const trk = src('components/sim/TrackerRoom.js');
  assert.match(trk, /className="trk-p nhead" aria-hidden="true"/,
    'tracker header wears the row container class - same gap, same padding');
  assert.match(trk, /className="go nghost">DRAFT</);
  const mock = src('components/sim/DraftRoom.js');
  assert.match(mock, /className="p-row nhead" aria-hidden="true"/);
  assert.match(mock, /className="draft nghost">Draft</);
  // The header's label cells ARE .ncol cells - same width var, cannot drift.
  for (const rel of ROOMS) {
    const t = src(rel);
    const head = t.slice(t.indexOf('nhead'), t.indexOf('nghost'));
    assert.match(head, /className="ncol">PPG<[\s\S]*className="ncol">ADP<[\s\S]*className="ncol">VAL</,
      `${rel}: labels are ncol cells in PPG/ADP/VAL order`);
  }
});

test('ADP stays an integer - it is a rank, not a measurement', () => {
  assert.match(src('components/sim/DraftRoom.js'), /className="v dim">\{r0\(p\.adp\)\}/);
  assert.match(src('components/sim/TrackerRoom.js'), /className="v dim">\{Math\.round\(Number\(p\.adp\)\)\}/);
});
