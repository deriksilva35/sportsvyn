// lib/market/marketUrl.test.mjs — the one url builder, and the class of bug
// it exists to end.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marketHref, hiddenFields, nextDir, defaultView, defaultSort, PARAMS } from './marketUrl.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

// ---------------------------------------------------------------------------
// THE OBSERVED BUG, pinned by name
// ---------------------------------------------------------------------------

test('LINES table + PRICE sort stays on the TABLE', () => {
  // Reported live: clicking a sort header on the lines table returned the
  // reader to the cards, because the sort link was built by a helper whose
  // only notion of `view` was "charts or nothing". Invisible on PROPS purely
  // because table is that tab's unmarked default.
  const state = { tab: 'lines', view: 'table' };
  const href = marketHref(state, { sort: 'price', dir: 'desc' });
  assert.match(href, /view=table/, 'the view must survive a sort');
  assert.match(href, /sort=price/);
  assert.match(href, /dir=desc/);
});

test('CHARTS view survives every props control', () => {
  const state = { tab: 'props', view: 'charts', f: 'cfb', g: 'td', game: '20651', board: '1' };
  for (const patch of [{ f: 'nfl' }, { g: 'scorer' }, { board: null }, { game: '20652' }]) {
    assert.match(marketHref(state, patch), /view=charts/, `${JSON.stringify(patch)} dropped the view`);
  }
});

// ---------------------------------------------------------------------------
// A CONTROL CHANGES ONLY ITS OWN PARAM
// ---------------------------------------------------------------------------

test('every other param survives every single-param patch', () => {
  const state = {
    tab: 'props', view: 'charts', f: 'cfb', g: 'td', game: '20651',
    sort: 'hit', dir: 'desc', q: 'palmer', board: '1', movers: '1',
  };
  for (const key of PARAMS) {
    if (key === 'tab') continue; // a tab change legitimately resets tab-scoped state
    const href = marketHref(state, { [key]: state[key] === '1' ? null : 'zzz' });
    for (const other of PARAMS) {
      if (other === key || other === 'tab') continue;
      const v = state[other];
      if (v == null) continue;
      if (other === 'view' && v === defaultView(state.tab)) continue;
      if (other === 'sort' && v === defaultSort(state.tab, state.view)) continue;
      assert.match(href, new RegExp(`${other}=`), `changing ${key} dropped ${other}`);
    }
  }
});

test('a tab change resets tab-scoped state but keeps the league', () => {
  // 'hit' is not a futures column and 'charts' is not a futures view; carrying
  // them would name things that tab does not have. The league is not
  // tab-scoped and survives.
  const href = marketHref(
    { tab: 'props', view: 'charts', sort: 'hit', dir: 'desc', f: 'cfb' },
    { tab: 'futures' },
  );
  assert.match(href, /tab=futures/);
  assert.match(href, /f=cfb/);
  assert.ok(!/view=charts/.test(href));
  assert.ok(!/sort=hit/.test(href));
});

// ---------------------------------------------------------------------------
// DEFAULTS STAY UNMARKED
// ---------------------------------------------------------------------------

test('canonical URLs carry no litter', () => {
  assert.equal(marketHref({ tab: 'lines' }, {}), '/market');
  assert.equal(marketHref({ tab: 'lines', view: 'cards' }, {}), '/market');
  assert.equal(marketHref({ tab: 'props', view: 'table' }, {}), '/market?tab=props');
  assert.equal(marketHref({ tab: 'futures', view: 'cards' }, {}), '/market?tab=futures');
  // 'all' is the absence of a filter, not a filter.
  assert.equal(marketHref({ tab: 'lines', f: 'all', g: 'all' }, {}), '/market');
});

test('THE DEFAULT VIEW DEPENDS ON THE TAB, so omission must too', () => {
  assert.equal(defaultView('props'), 'table');
  assert.equal(defaultView('lines'), 'cards');
  assert.equal(defaultView('futures'), 'cards');
  // ?view=table is litter on props and meaningful on lines.
  assert.ok(!/view=/.test(marketHref({ tab: 'props' }, { view: 'table' })));
  assert.match(marketHref({ tab: 'lines' }, { view: 'table' }), /view=table/);
});

// ---------------------------------------------------------------------------
// DIRECTION TOGGLE
// ---------------------------------------------------------------------------

test('the active column flips; a new column takes its own default', () => {
  assert.equal(nextDir('price', 'price', 'desc'), 'asc');
  assert.equal(nextDir('price', 'price', 'asc'), 'desc');
  // A reader sorting by price wants the extreme; by player, the alphabet.
  assert.equal(nextDir('price', 'player', 'asc'), 'desc');
  assert.equal(nextDir('player', 'price', 'desc'), 'asc');
  // No explicit dir yet: flip from the column's own default.
  assert.equal(nextDir('price', 'price', null), 'asc');
  assert.equal(nextDir('player', 'player', null), 'desc');
});

// ---------------------------------------------------------------------------
// FORMS LOSE PARAMS TOO
// ---------------------------------------------------------------------------

test('a GET form carries every param it does not own', () => {
  // A form posts ONLY its named fields, so a param missing from the hidden set
  // is a param the reader silently loses on submit - the same loss as a
  // hand-built href, arriving through a different door.
  const state = { tab: 'props', view: 'charts', f: 'cfb', g: 'td', game: '20651', board: '1', q: 'palmer' };
  const keys = hiddenFields(state, ['game']).map(([k]) => k);
  assert.ok(keys.includes('view') && keys.includes('f') && keys.includes('g')
    && keys.includes('board') && keys.includes('q'), `missing: ${keys}`);
  assert.ok(!keys.includes('game'), 'the form owns game and must not hide it');
});

test('hiddenFields omits defaults, like the href builder', () => {
  const keys = hiddenFields({ tab: 'lines', view: 'cards', f: 'all' }, []).map(([k]) => k);
  assert.deepEqual(keys, []);
});

// ---------------------------------------------------------------------------
// THE STRUCTURAL GUARANTEE
// ---------------------------------------------------------------------------

test('THERE IS EXACTLY ONE PLACE A /market URL IS MADE', () => {
  // Three hand-built helpers each knew a different subset of the state, which
  // is how a sort link came to drop the view. A second builder is how this
  // class recurs, so the page is asserted to contain none.
  const PAGE = strip(src('app/market/page.js'));
  assert.ok(!/function boardHref/.test(PAGE));
  assert.ok(!/function viewHref/.test(PAGE));
  assert.ok(!/function marketHref/.test(PAGE), 'the builder lives in lib, not the page');
  assert.ok(!/href=\{`\/market\?/.test(PAGE), 'no template-literal /market hrefs');
  for (const f of ['components/market/PropsTable.js', 'components/market/LineTable.js',
    'components/market/PropsFilters.js']) {
    const code = strip(src(f));
    assert.ok(!/`\/market\?/.test(code), `${f} must not hand-build a /market url`);
  }
});
