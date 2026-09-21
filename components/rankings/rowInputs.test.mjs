// components/rankings/rowInputs.test.mjs - the expanding row, rendered.
//
// WHAT ONLY A RENDER CAN SHOW. The panel's job is to make a published number
// auditable: a reader who disagrees with a rank should be able to open the row
// and see the Elo it came from, the three games behind it, what the AP poll
// said, and how the two were weighted. Each of those is a conditional, and
// every one of them has a wrong answer that renders perfectly - an NFL row
// showing an AP line it has no poll for, an unranked CFB row showing a blank
// AP line instead of none, a hand-seeded row from edition 0 opening onto an
// empty panel.
//
// IT READS THE BLOB AND NOTHING ELSE. These fixtures are inputs objects in the
// exact shape migration 108 documents and publishGridironEdition.js writes, so
// a change to either side that this component did not follow shows up here.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const C = path.join(__dirname, '__c_ri.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec.endsWith('.css')) return { url: pathToFileURL(C).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React; let render; let RowInputs; let Movement; let RankRow;
before(async () => {
  writeFileSync(C, 'export default {};\n');
  React = await import('react');
  ({ renderToStaticMarkup: render } = await import('react-dom/server'));
  const mod = await import('./RowInputs.js');
  RowInputs = mod.default; Movement = mod.Movement;
  RankRow = (await import('./RankRow.js')).default;
});
after(() => { try { unlinkSync(C); } catch { /* gone */ } });

// A CFB row: ranked by the AP, blended 0.70/0.30.
const CFB_INPUTS = {
  elo: 1670.56, delta3: 42.04,
  last3: [
    { opp: 'UGA', result: 'W', margin: 10 },
    { opp: 'OU', result: 'L', margin: 3 },
    { opp: 'BAY', result: 'W', margin: 28 },
  ],
  ap: { rank: 1, score: 10 },
  editor: { rank: 2, score: 9.37 },
  field: 138,
  composite: { dims: ['result', 'editor'], values: { result: 8.3, editor: 9.37 }, value: 8.8 },
  weights: { editorial: 0.7, sites: 0.3 },
};
// An NFL row: no poll exists, so no AP and full editorial weight.
const NFL_INPUTS = {
  elo: 1697.22, delta3: -37.87,
  last3: [{ opp: 'SF', result: 'L', margin: 7 }],
  ap: null,
  editor: null,
  composite: { dims: ['result'], values: { result: 9.7, editor: null }, value: 9.7 },
  weights: { editorial: 1, sites: 0 },
};
const h = (props) => render(React.createElement(RowInputs, props));

test('A CFB ROW SHOWS ALL FOUR FACTS, in the order the panel promises', () => {
  const out = h({ inputs: CFB_INPUTS });
  assert.match(out, /<details class="rk-inputs">/);
  assert.match(out, /<summary>How this rank was computed<\/summary>/);
  // Elo to two decimals, and the three-game swing SIGNED - "42.0" without the
  // plus reads as a rating, not as a change.
  assert.match(out, /<dt>Elo<\/dt><dd>1670\.56<small>\+42\.0 over the last three<\/small>/);
  // The three games, newest last, each carrying result, margin and opponent.
  assert.match(out, /class="rk-res w">W <b>10<\/b> UGA/);
  assert.match(out, /class="rk-res l">L <b>3<\/b> OU/);
  assert.match(out, /class="rk-res w">W <b>28<\/b> BAY/);
  assert.equal((out.match(/class="rk-res/g) ?? []).length, 3);
  // THE CURVE IS SHOWN AS A CONVERSION, rank to score, because the score is
  // the thing that enters the blend and the rank is the thing a reader knows.
  // THE CAPTION NAMES THE FIELD THE ROW WAS ACTUALLY CURVED OVER. It read
  // "a 25-team field" for one deploy after the ruling moved every curve to the
  // published field - true when written, false when shipped. It is now the
  // stored number, so it cannot disagree with the score beside it.
  assert.match(out, /<dt>AP<\/dt><dd>#1 <span class="rk-arrow">→<\/span> 10\.00 <small>curved over the 138-team field<\/small>/);
  assert.equal(/25-team field/.test(out), false);
  // With no field recorded - a row written before this existed - it says what
  // it can honestly say rather than naming a number it does not have.
  assert.match(h({ inputs: { ...CFB_INPUTS, field: null } }), /curved over the published field/);
  assert.match(out, /<dt>Weights<\/dt><dd>editorial 0\.70 · AP 0\.30<\/dd>/);
  // THE EDITOR'S LINE, beside the poll and labelled as a judgement.
  assert.match(out, /<dt>Editor<\/dt><dd>#2 <span class="rk-arrow">→<\/span> 9\.37 <small>this week&#x27;s editor list<\/small>/);
  // THE COMPOSITE, WRITTEN OUT so a reader can do the mean in their head.
  assert.match(out, /<dt>Composite<\/dt><dd><span>result 8\.3<\/span><span> \+ editor 9\.4<\/span> <span class="rk-arrow">→<\/span> 8\.8<\/dd>/);
  assert.match(out, /result, of 5/);
  assert.match(out, /momentum is shown, not blended; process, squad and coherence are held/);
  // Order on the page is Elo, Last three, AP, Editor, Composite, Weights, Dimensions.
  const at = (s) => out.indexOf(s);
  assert.ok(at('>Elo<') < at('>Last three<'));
  assert.ok(at('>Last three<') < at('>AP<'));
  assert.ok(at('>AP<') < at('>Editor<'));
  assert.ok(at('>Editor<') < at('>Composite<'));
  assert.ok(at('>Composite<') < at('>Weights<'));
  assert.ok(at('>Weights<') < at('>Dimensions<'));
});

test('A TEAM BELOW THE EDITOR\'S 25 SHOWS NO EDITOR LINE, and says the composite is result alone', () => {
  const out = h({ inputs: { ...CFB_INPUTS, editor: null, composite: { dims: ['result'], values: { result: 8.3, editor: null }, value: 8.3 } } });
  assert.equal(/<dt>Editor<\/dt>/.test(out), false, 'absent, not blank - 113 of 138 teams are here');
  assert.match(out, /<dt>Composite<\/dt><dd><span>result 8\.3<\/span> <span class="rk-arrow">→<\/span> 8\.3<small>not in the editor&#x27;s 25<\/small>/);
});

test('AN NFL ROW HAS NO AP LINE AT ALL - absent, not blank', () => {
  const out = h({ inputs: NFL_INPUTS });
  assert.equal(/<dt>AP<\/dt>/.test(out), false, 'a league with no poll shows no poll row');
  // The composite line uses the same arrow, so this asks about the AP row
  // specifically rather than about the glyph anywhere in the panel.
  assert.equal(/<dt>AP<\/dt><dd>#/.test(out), false);
  // And the weights line says WHY there is only one number in the blend,
  // rather than printing "AP 0.00" and inviting the question.
  assert.match(out, /<dt>Weights<\/dt><dd>editorial 1\.00 · no second source to blend<\/dd>/);
  assert.match(out, /1697\.22<small>-37\.9 over the last three<\/small>/, 'a negative swing keeps its sign');
  assert.match(out, /class="rk-res l">L <b>7<\/b> SF/);
  assert.match(out, /result, of 5/);
  // NO EDITOR LIST FOR THE NFL, so no editor line and a one-dimension composite.
  assert.equal(/<dt>Editor<\/dt>/.test(out), false);
  assert.match(out, /<dt>Composite<\/dt><dd><span>result 9\.7<\/span>/);
});

test('AN UNRANKED CFB ROW SHOWS NO AP LINE EITHER, and says the blend did not happen', () => {
  // ap: null is the shape publishGridironEdition writes for a team the poll
  // does not rank - most of a 138-team field, every week.
  const out = h({ inputs: { ...CFB_INPUTS, ap: null } });
  assert.equal(/<dt>AP<\/dt>/.test(out), false);
  assert.match(out, /<dt>Editor<\/dt>/, 'the editor may rank a team the poll does not - that is the point');
  assert.match(out, /editorial 1\.00 · no second source to blend/,
    'the sites weight is configured but nothing came back to spend it on');
});

test('NO BLOB, NO PANEL - a hand-seeded row does not open onto nothing', () => {
  // Edition 0 rows have inputs '{}' by migration 108's default, which
  // lib/rankings/reads.js turns into null.
  assert.equal(h({ inputs: null }), '');
  assert.equal(h({}), '');
  assert.equal(h({ inputs: {} }), '');
  assert.equal(h({ inputs: { elo: null, weights: { editorial: 1, sites: 0 } } }), '',
    'a blob with no rating in it is not working worth showing');
  // A blob with an Elo and nothing else still renders, minus every optional row.
  const bare = h({ inputs: { elo: 1500 } });
  assert.match(bare, /<dd>1500\.00<\/dd>/);
  assert.equal(/Last three|<dt>AP<\/dt>|<dt>Editor<\/dt>|<dt>Composite<\/dt>|<dt>Weights<\/dt>/.test(bare), false);
  assert.match(bare, /result, of 5/, 'the dimension caveat is not optional');
});

test('THE ROW IS A <details> ONLY WHEN IT HAS WORKING BEHIND IT', () => {
  const withPanel = render(React.createElement(RankRow, {
    rank: 1, name: 'Texas', value: 8.53,
    expand: React.createElement(RowInputs, { inputs: CFB_INPUTS }),
  }));
  assert.match(withPanel, /^<details class="rk-exp"><summary class="rk-row"/);
  assert.match(withPanel, /rk-inputs/);
  // WITHOUT one it is the div it has always been - no triangle over nothing,
  // and every existing style still lands because the class list is identical.
  const plain = render(React.createElement(RankRow, { rank: 1, name: 'Texas', value: 8.53 }));
  assert.match(plain, /^<div class="rk-row">/);
  assert.equal(/details|summary/.test(plain), false);
  // The YOU row keeps its marker in both shapes.
  const you = render(React.createElement(RankRow, { rank: null, name: 'You', you: true }));
  assert.match(you, /<div class="rk-row you" data-you="1">/);
  assert.match(you, /<span class="rnk-n">–<\/span>/);
});

test('MOVEMENT: four states, one width, and a label for each', () => {
  const m = (props) => render(React.createElement(Movement, props));
  assert.equal(m({ previousRank: null, movement: 5 }), '<span class="rk-mv new" aria-label="new this edition">–</span>');
  assert.equal(m({ previousRank: 4, movement: 3 }), '<span class="rk-mv up" aria-label="up 3">▲3</span>');
  assert.equal(m({ previousRank: 2, movement: -3 }), '<span class="rk-mv dn" aria-label="down 3">▼3</span>');
  assert.equal(m({ previousRank: 1, movement: 0 }), '<span class="rk-mv hold" aria-label="unchanged">–</span>');
  // A PRESENT previousRank WITH A NULL MOVEMENT IS A HOLD, not a new row: the
  // team was on the last edition, so whatever else is true it is not new.
  assert.match(m({ previousRank: 1, movement: null }), /rk-mv hold/);
  // EVERY STATE CARRIES AN aria-label, because the glyph alone says nothing
  // to a screen reader and "up 3" is the whole content of the cell.
  for (const p of [{ previousRank: null }, { previousRank: 4, movement: 3 }, { previousRank: 2, movement: -3 }, { previousRank: 1, movement: 0 }]) {
    assert.match(m(p), /aria-label="[^"]+"/);
  }
});
