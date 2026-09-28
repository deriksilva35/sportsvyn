// lib/gridiron/gamesWindow.test.mjs - the 5-min games tick ingests a window,
// the daily cron ingests the season. Pure boundary + source wiring.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inGamesWindow } from './ingest.js';
import { GAMES_WINDOW_HOURS } from '../pollers/cadence.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const VERCEL = JSON.parse(src('vercel.json'));

test('the window is 36 h either side, edges inclusive', () => {
  assert.equal(GAMES_WINDOW_HOURS, 36);
  const now = new Date('2026-09-26T16:00:00Z');
  const w = { now, hours: GAMES_WINDOW_HOURS };
  const h = (n) => new Date(now.getTime() + n * 3_600_000);
  assert.ok(inGamesWindow(h(0), w));
  assert.ok(inGamesWindow(h(36), w), '+36 h is in');
  assert.ok(inGamesWindow(h(-36), w), '-36 h is in (a finished game still settles)');
  assert.ok(!inGamesWindow(new Date(h(36).getTime() + 60_000), w), 'a minute past is out');
  assert.ok(!inGamesWindow(h(-37), w));
  assert.ok(!inGamesWindow(h(24 * 21), w), 'three weeks out is the daily run\'s');
  assert.ok(inGamesWindow(h(30).toISOString(), w), 'an ISO string reads the same as a Date');
});

test('no window means the whole season', () => {
  assert.ok(inGamesWindow(new Date('2027-01-10T00:00:00Z'), null));
  assert.ok(inGamesWindow(new Date('2020-01-10T00:00:00Z'), undefined));
});

test('THE TICK IS WINDOWED on both leagues, and has 120 s', () => {
  const R = strip(src('app/api/cron/gridiron-games/route.js'));
  assert.match(R, /export const maxDuration = 120;/);
  assert.match(R, /syncNflGames\([^)]*window: tickWindow\(\)/);
  assert.match(R, /syncCfbGames\([^)]*window: tickWindow\(\)/);
  assert.match(R, /hours: GAMES_WINDOW_HOURS/);
  assert.equal(VERCEL.crons.find((c) => c.path === '/api/cron/gridiron-games').schedule, '*/5 * * * *',
    'the 5-min tick stays; the daily run replaces nothing');
});

test('THE SEASON RUN is daily at 09:00Z, unwindowed, under the tick\'s lock', () => {
  assert.equal(VERCEL.crons.find((c) => c.path === '/api/cron/gridiron-season').schedule, '0 9 * * *');
  const R = strip(src('app/api/cron/gridiron-season/route.js'));
  assert.match(R, /export const maxDuration = 300;/, 'the season run has 300 s; the tick keeps 120');
  assert.match(R, /syncNflGames\([^)]*window: null/);
  assert.match(R, /syncCfbGames\([\s\S]*?window: null/);
  assert.match(R, /withAdvisoryLock\(lg\.source,/, 'same per-source lock as the tick');
  assert.match(R, /source: 'nfl-games'/);
  assert.match(R, /source: 'cfb-games'/);
  assert.match(R, /kind: 'season'/);
  assert.match(R, /cronAuthorized\(request\)/);
});

test('an out-of-window game is COUNTED, and skipped before any write or stub', () => {
  const S = strip(src('lib/gridiron/sync.js'));
  for (const [fn, next] of [['syncNflGames', 'syncCfbGames'], ['syncCfbGames', null]]) {
    const start = S.indexOf(`export async function ${fn}`);
    const body = S.slice(start, next ? S.indexOf(`export async function ${next}`) : undefined);
    const gate = body.indexOf('inGamesWindow(kickoffAt, window)');
    assert.ok(gate > 0, `${fn} consults the window`);
    assert.match(body, /summary\.outOfWindow \+= 1; continue;/);
    assert.ok(gate < body.indexOf('await upsertGame('), `${fn}: gate before the upsert`);
    if (fn === 'syncCfbGames') assert.ok(gate < body.indexOf('await resolveSide('), 'no FCS stub for an out-of-window game');
  }
});
