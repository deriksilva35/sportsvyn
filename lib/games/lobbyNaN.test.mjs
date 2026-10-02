// lib/games/lobbyNaN.test.mjs - the lobby never prints NaN (tue-3). A DEV sentinel
// with no Weekly lineup on a locked board saw "NaN LIVE" on the Weekly row and
// "Your Weekly · NaN" in the now card - on what is now the homepage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { weeklyRowV3 } from './v3Rows.js';
import { nowCard } from './nowCard.js';

test('a non-numeric score is no score: the Weekly row shows no NaN', () => {
  for (const scored of ['—', '', 'x', null, undefined, Number.NaN]) {
    const r = weeklyRowV3({ rows: [], state: 'locked', filled: 6, live: true, scored });
    assert.equal(r.right, null, `scored=${String(scored)}`);
    assert.doesNotMatch(JSON.stringify(r), /NaN/);
  }
  assert.equal(weeklyRowV3({ rows: [], state: 'locked', filled: 6, live: true, scored: 104.26 }).right, '104.3');
});

test('the now card: "Your Weekly" with no number rather than "Your Weekly · NaN"', () => {
  const c = nowCard({ daily: {}, weekly: { state: 'locked', live: true, scored: '—' }, draft: {} }, { now: new Date('2026-09-29T00:00:00Z') });
  assert.equal(c.kind, 'live');
  assert.equal(c.title, 'Your Weekly');
});

// THE PLAY LOBBY (thu-38 + fri-1) retired the v3 This-week rows and the now
// card from /games; the Weekly's item reads the home view's slot COUNT
// (lib/games/playRegistry.js weeklyItem), never the stats block's display
// text, so no 'Scored' string can reach a number on the lobby at all.
test('the lobby: the Weekly item counts slots, and reads no display text', () => {
  const src = readFileSync(new URL('./playRegistry.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export function weeklyItem('), src.indexOf('export function pickemItem('));
  assert.doesNotMatch(fn, /stats|Scored/, 'no display stat is parsed');
  assert.match(fn, /Number\(home\.filled \?\? 0\)/, 'a count, defaulted to 0, never NaN');
});
