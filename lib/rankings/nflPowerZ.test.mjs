// lib/rankings/nflPowerZ.test.mjs - PARITY FIRST: the Mac's week-2 artefact
// (sportsvyn-mock-app power-z @ 13951e1, model/powerrank/nfl-2026-wk02.json)
// reproduced from OUR OWN finals (PROD matches, REG, weeks 1-2, snapshotted).
// Ranks, teams, records and skip counts exactly; every number to 1e-12
// (numpy's pairwise sum and JS's left-to-right sum differ only in the last bits).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rankPowerZ, components, nflverseCode, WEIGHTS } from './nflPowerZ.js';

const MAC = JSON.parse(readFileSync(new URL('./fixtures/nfl-power-z-2026-wk02.mac.json', import.meta.url), 'utf8'));
const OURS = JSON.parse(readFileSync(new URL('./fixtures/nfl-2026-reg-wk1-2-finals.json', import.meta.url), 'utf8'));
const EPS = 1e-12;
const near = (a, b, what) => assert.ok(Math.abs(a - b) <= EPS, `${what}: ours ${a} vs Mac ${b}`);

test('PARITY: our week-2 table IS the Mac\'s - rank, team, record, components, z and power', () => {
  assert.equal(OURS.games.length, MAC.games_used, 'the same 32 regular-season finals');
  assert.deepEqual(WEIGHTS, { adjPF: MAC.weights.adjPF, adjPA: MAC.weights.adjPA, win: MAC.weights.win, qorB: MAC.weights.qorB });
  assert.equal(MAC.weights.qorC, 0); assert.equal(MAC.weights.oppWin, 0);
  const table = rankPowerZ(OURS.games);
  assert.equal(table.length, MAC.teams.length);
  for (let i = 0; i < table.length; i++) {
    const o = table[i]; const m = MAC.teams[i]; const who = `#${m.rank} ${m.team}`;
    assert.equal(o.rank, m.rank); assert.equal(nflverseCode(o.team), m.team, `${who}: same team at the same rank`);
    assert.deepEqual(o.record, m.record, `${who} record`);
    assert.equal(o.skipped, m.games_skipped_for_opponent_baseline, `${who} skipped`);
    for (const k of ['adjPF', 'adjPA', 'win', 'qorB', 'oppWin']) near(o.components[k], m.components[k], `${who} components.${k}`);
    for (const k of ['adjPF', 'adjPA', 'win', 'qorB']) near(o.z[k], m.z[k], `${who} z.${k}`);
    near(o.power, m.power, `${who} power`);
  }
});

test('THE SIGN TRAP: adjPA is stored raw (lower is better) and z.adjPA is the flipped one', () => {
  const t = rankPowerZ(OURS.games).find((r) => r.team === 'SEA');
  assert.equal(t.components.adjPA, -14.5, 'raw: SEA allowed 14.5 fewer than those opponents usually score');
  assert.ok(t.z.adjPA > 0, 'and standardised as a strength');
});

test('the rules on toy slates: ties a half, the QoR worked examples, the skip, the fallbacks', () => {
  // A beats B, B beats C, C beats D, D beats A - four teams, one loop
  const loop = [
    { home: 'A', away: 'B', home_score: 20, away_score: 10 }, { home: 'B', away: 'C', home_score: 20, away_score: 10 },
    { home: 'C', away: 'D', home_score: 20, away_score: 10 }, { home: 'D', away: 'A', home_score: 20, away_score: 10 },
  ];
  const c = components(loop);
  // A's opponents: B (other game: beat C -> win% 1.0), D (other game: lost to C -> 0.0)
  // beat B: 1 - (1 - 1.0) = +1.0 ; lost to D: 0 - (1 - 0.0) = -1.0 -> mean 0
  assert.equal(c.A.qorB, 0);
  // QoR worked examples: beat a .800 opponent +0.8, lose to .800 -0.2, lose to .200 -0.8
  const qor = (res, ow) => res - (1 - ow);
  assert.ok(Math.abs(qor(1, 0.8) - 0.8) < 1e-12 && Math.abs(qor(0, 0.8) + 0.2) < 1e-12 && Math.abs(qor(0, 0.2) + 0.8) < 1e-12);
  // a tie is a half
  const tie = components([{ home: 'X', away: 'Y', home_score: 17, away_score: 17 }]);
  assert.equal(tie.X.win, 0.5); assert.equal(tie.X.record.text, '0-0-1');
  // week 1: every opponent's only game is vs this team -> skipped; win% still counts; fallbacks
  const one = components([{ home: 'X', away: 'Y', home_score: 24, away_score: 3 }]);
  assert.deepEqual([one.X.skipped, one.X.win, one.X.adjPF, one.X.adjPA, one.X.qorB, one.X.oppWin], [1, 1, 0, 0, 0, 0.5]);
});
