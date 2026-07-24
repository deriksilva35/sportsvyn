// lib/sim/exposureReport.test.mjs — pure aggregation (aggregateExposure). Imports
// exposureReport.js which pulls db.js (needs DATABASE_URL at import), so load
// .env.local first; the aggregator itself never queries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const { aggregateExposure } = await import('./exposureReport.js');

test('aggregateExposure: most-drafted (count/%/avgRound) + value-by-round', () => {
  const picks = [
    { player_name: 'Bijan', position: 'RB', round: 1, overall_pick: 3, adp: 2 },   // reach -1
    { player_name: 'Bijan', position: 'RB', round: 1, overall_pick: 4, adp: 2 },   // reach -2
    { player_name: 'Jettas', position: 'WR', round: 2, overall_pick: 15, adp: 20 }, // value +5
    { player_name: 'Puka', position: 'WR', round: 3, overall_pick: 27, adp: 25 },   // reach -2
  ];
  const r = aggregateExposure(picks, 2);
  assert.equal(r.draftCount, 2);
  assert.equal(r.totalPicks, 4);

  const bijan = r.mostDrafted.find((p) => p.player === 'Bijan');
  assert.equal(bijan.count, 2);
  assert.equal(bijan.pctOfDrafts, 100); // 2 of 2 drafts
  assert.equal(bijan.avgRound, 1);
  assert.equal(r.mostDrafted[0].player, 'Bijan'); // most-drafted first

  const r1 = r.valueByRound.find((x) => x.round === 1);
  assert.equal(r1.avgValue, -1.5); // (-1 + -2)/2
  assert.equal(r.valueByRound.find((x) => x.round === 2).avgValue, 5);
  assert.equal(r.valueByRound.find((x) => x.round === 3).avgValue, -2);

  assert.equal(r.overallLean.avgValue, 0); // (-1 -2 +5 -2)/4
  assert.equal(r.overallLean.lean, 'even');
});

test('aggregateExposure: strong value lean', () => {
  const r = aggregateExposure([{ player_name: 'X', position: 'RB', round: 1, overall_pick: 10, adp: 15 }], 1);
  assert.equal(r.overallLean.lean, 'value');
});

test('aggregateExposure: strong reach lean', () => {
  const r = aggregateExposure([{ player_name: 'Y', position: 'RB', round: 1, overall_pick: 10, adp: 5 }], 1);
  assert.equal(r.overallLean.lean, 'reach');
});

test('aggregateExposure: empty history', () => {
  const r = aggregateExposure([], 0);
  assert.deepEqual(r.mostDrafted, []);
  assert.deepEqual(r.valueByRound, []);
  assert.equal(r.overallLean.avgValue, null);
  assert.equal(r.overallLean.lean, 'even');
});
