// Rankings hub helpers: tab routing, top-5 truncation, dark-horse teaser, hrefs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RANKING_TABS, resolveActiveTab, previewEntries, darkHorseCount, boardHref } from './rankingsHub.js';

const entries = Array.from({ length: 20 }, (_, i) => ({ rank: i + 1, band: i >= 15 ? 'dark_horse' : null }));

test('tab config: NFL editorial x3, CFB editorial x2 + market playoff', () => {
  assert.deepEqual(RANKING_TABS.nfl.map((t) => t.key), ['power', 'mvp-offense', 'mvp-defense']);
  assert.ok(RANKING_TABS.nfl.every((t) => t.kind === 'editorial'));
  assert.deepEqual(RANKING_TABS.cfb.map((t) => t.key), ['top25', 'heisman', 'playoff']);
  assert.equal(RANKING_TABS.cfb.find((t) => t.key === 'playoff').kind, 'market');
});

test('resolveActiveTab: matches ?tab=, defaults to first, unknown -> first', () => {
  assert.equal(resolveActiveTab(RANKING_TABS.cfb, 'heisman').key, 'heisman');
  assert.equal(resolveActiveTab(RANKING_TABS.cfb, undefined).key, 'top25'); // default
  assert.equal(resolveActiveTab(RANKING_TABS.cfb, 'nonsense').key, 'top25'); // fallback
});

test('previewEntries: top 5 truncation (preview never shows the band)', () => {
  const top = previewEntries(entries, 5);
  assert.equal(top.length, 5);
  assert.deepEqual(top.map((e) => e.rank), [1, 2, 3, 4, 5]);
  assert.equal(top.filter((e) => e.band === 'dark_horse').length, 0); // dark horses are 16-20, off-preview
});

test('darkHorseCount: powers the "+ N dark horses" teaser', () => {
  assert.equal(darkHorseCount(entries), 5);
  assert.equal(darkHorseCount([]), 0);
});

test('boardHref: Today preview -> hub tab, linkable', () => {
  assert.equal(boardHref('nfl', 'power'), '/nfl/rankings?tab=power');
  assert.equal(boardHref('cfb', 'playoff'), '/cfb/rankings?tab=playoff');
});
