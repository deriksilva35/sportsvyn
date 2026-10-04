// lib/october/voidGame.test.mjs - a postponed game never replayed is void (ruling 27 Sep).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(REPO, '.env.local'));
const { isVoidGame, VOID_AFTER_HOURS } = await import('./settle.js');

const NOW = new Date('2026-09-27T21:00:00Z');
const ago = (h) => new Date(NOW.getTime() - h * 3600e3).toISOString();

test('POSTPONED AND NEVER RESCHEDULED past the window is void; inside it, it still holds the day', () => {
  assert.equal(VOID_AFTER_HOURS, 72);
  assert.equal(isVoidGame({ status: 'postponed', kickoff_at: ago(73) }, NOW), true, 'TOR @ BAL, five days on');
  assert.equal(isVoidGame({ status: 'postponed', kickoff_at: ago(71) }, NOW), false, 'a makeup can still be announced');
});

test('a RESCHEDULED game is not void - it is scheduled again with a new first pitch - and nothing else ever is', () => {
  assert.equal(isVoidGame({ status: 'scheduled', kickoff_at: ago(-5) }, NOW), false);
  assert.equal(isVoidGame({ status: 'final', kickoff_at: ago(200) }, NOW), false);
  assert.equal(isVoidGame({ status: 'live', kickoff_at: ago(100) }, NOW), false);
  assert.equal(isVoidGame(null, NOW), false);
  assert.equal(isVoidGame({ status: 'postponed', kickoff_at: null }, NOW), false, 'no first pitch, no verdict');
});

test('the settle lets a void game go: it is not pending, and the day records it', () => {
  const s = readFileSync(path.join(REPO, 'lib/october/settle.js'), 'utf8');
  const fn = s.slice(s.indexOf('export async function settleOctoberDay'));
  // The 27 Sep rule rides the sun-8 void gate (lib/settle/voidRule.js) as a
  // game that is void before the cutoff, alongside cancelled/not_needed.
  assert.match(fn, /voidNow: \(g\) => NOT_PLAYED\.has\(g\.status\) \|\| isVoidGame\(g\.match, now\)/);
  assert.match(fn, /voidAllowed: pastVoidCutoff\(contest, now\)/);
  assert.match(fn, /void: voided/);
});
