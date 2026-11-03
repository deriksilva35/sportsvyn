// A settled Weekly's rank carries its field size ("#3 of N"). It used to carry
// of: null, which threw weeklyCard and blanked the lobby (3 Nov). The field is
// weeklyBoardTable's own row count - the rows the rank came from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('weeklyBoardTable returns total = every ranked row, settled or live', () => {
  const t = strip(src('lib/weekly/live.js'));
  const fn = t.slice(t.indexOf('export async function weeklyBoardTable'));
  assert.match(fn, /total: rows\.length/);
  assert.ok(fn.indexOf('total: rows.length') > fn.indexOf('const top = rows.slice'), 'computed from the full rows, not the top slice');
});

test('weeklyLive settled branch reads of from the board total, not null', () => {
  const t = strip(src('lib/gridiron/todayReads.js'));
  const fn = t.slice(t.indexOf('export async function weeklyLive'), t.indexOf('export async function weeklyHero'));
  assert.match(fn, /rank: mine \? \{ rank: mine\.rank, of: t\?\.total \?\? null \}/);
  assert.ok(!/of: null \}/.test(fn.replace('?? null }', '')), 'no hard-wired of: null');
});

test('weeklyCard prints "of N" from a settled rank', async () => {
  const { weeklyCard } = await import('../games/lobbyV2Shape.js');
  const c = weeklyCard({ home: { state: 'settled', contest: { week: 5 }, settled: true }, scored: 88.5, rank: { rank: 3, of: 41 }, uid: 1 });
  const labels = JSON.stringify(c);
  assert.ok(labels.includes('of 41'), labels.slice(0, 300));
});
