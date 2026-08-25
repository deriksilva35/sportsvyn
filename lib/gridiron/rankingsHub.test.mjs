// Rankings hub helpers: tab routing, top-5 truncation, dark-horse teaser, hrefs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RANKING_TABS, resolveActiveTab, previewEntries, darkHorseCount, boardHref } from './rankingsHub.js';

const entries = Array.from({ length: 20 }, (_, i) => ({ rank: i + 1, band: i >= 15 ? 'dark_horse' : null }));

test('tab config: NFL editorial x3 + market playoff(12), CFB polls x2 + editorial x2 + market playoff(25)', () => {
  assert.deepEqual(RANKING_TABS.nfl.map((t) => t.key), ['power', 'mvp-offense', 'mvp-defense', 'playoff']);
  assert.equal(RANKING_TABS.nfl.find((t) => t.key === 'playoff').kind, 'market');
  assert.equal(RANKING_TABS.nfl.find((t) => t.key === 'playoff').n, 12);
  // CFB grew two POLL tabs at the front (AP, Coaches). The three that were
  // here keep their keys and order relative to each other - app/page.js links
  // boardHref('cfb','top25') and would dangle if a key moved with its row.
  assert.deepEqual(RANKING_TABS.cfb.map((t) => t.key), ['ap', 'coaches', 'top25', 'heisman', 'playoff']);
  assert.equal(RANKING_TABS.cfb.find((t) => t.key === 'playoff').n, 25);
  assert.equal(RANKING_TABS.cfb.find((t) => t.key === 'ap').kind, 'poll');
  assert.equal(RANKING_TABS.cfb.find((t) => t.key === 'ap').poll, 'AP Top 25');
  assert.equal(RANKING_TABS.cfb.find((t) => t.key === 'coaches').poll, 'Coaches Poll');
  // NFL gains no poll tab.
  assert.equal(RANKING_TABS.nfl.filter((t) => t.kind === 'poll').length, 0);
});

test('resolveActiveTab: matches ?tab=, defaults to first, unknown -> first', () => {
  assert.equal(resolveActiveTab(RANKING_TABS.cfb, 'heisman').key, 'heisman');
  // THE DEFAULT MOVED, deliberately: AP leads the CFB hub now, so a bare
  // /cfb/rankings opens on AP rather than the Sportsvyn 25.
  assert.equal(resolveActiveTab(RANKING_TABS.cfb, undefined).key, 'ap'); // default
  assert.equal(resolveActiveTab(RANKING_TABS.cfb, 'nonsense').key, 'ap'); // fallback
  assert.equal(resolveActiveTab(RANKING_TABS.nfl, undefined).key, 'power', 'NFL default unchanged');
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
