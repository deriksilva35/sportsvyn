// lib/fantasy/grade.test.mjs — grade formula: band fixtures, K/DST exclusion,
// and the calibration distribution over 300 seeded auto-drafts (DEV pool).
// Run: node --test lib/fantasy/grade.test.mjs

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

const { gradeDraft, bandFor, BANDS } = await import('./grade.js');
const eng = await import('./engine.js');
const { neon } = await import('@neondatabase/serverless');

const CONFIG = { teams_count: 12, roster_slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6 } };
// Build a 15-pick user roster fixture. valueEach = displayValue (overall - adp) per
// SKILL pick; kdstValue = displayValue jammed onto K/DST (should be ignored).
function fixture({ valueEach = 0, kdstValue = 0, lateStarterRounds = [], benchAllRB = false, sameBye = false } = {}) {
  const recs = [];
  let ov = 1;
  const add = (rosterSlot, slotPos, round, dv, bye) => {
    recs.push({ rosterSlot, slotPos, round, overallPick: ov, adpAtPick: ov - dv, bye, synthetic: false, needWeight: 1.5, isUser: true, playerName: `${slotPos}${ov}` });
    ov += 1;
  };
  // 7 skill starters (rounds 1-7 unless overridden), value = valueEach
  const starters = [['RB', 'RB'], ['RB', 'RB'], ['WR', 'WR'], ['WR', 'WR'], ['TE', 'TE'], ['FLEX', 'RB'], ['QB', 'QB']];
  starters.forEach(([slot, pos], i) => add(slot, pos, lateStarterRounds[i] ?? (i + 1), valueEach, sameBye ? 7 : 10 + i));
  // 4 bench skill (rounds 8-11), value = valueEach
  for (let i = 0; i < 4; i++) add('BN', benchAllRB ? 'RB' : (i % 2 ? 'WR' : 'RB'), 8 + i, valueEach, 20 + i);
  // 2 more bench (rounds 12), K + DST late
  add('BN', 'RB', 12, valueEach, 30);
  add('BN', 'WR', 12, valueEach, 31);
  add('K', 'K', 14, kdstValue, null);
  add('DST', 'DST', 13, kdstValue, null);
  return recs;
}

test('band edges', () => {
  assert.equal(bandFor(88), 'A');
  assert.equal(bandFor(87.9), 'A-');
  assert.equal(bandFor(70), 'B');
  assert.equal(bandFor(62), 'C+');
  assert.equal(bandFor(35), 'F');
  assert.equal(BANDS[0][0], 'A');
});

test('at-market clean draft grades B (value 50, construction 100)', () => {
  const g = gradeDraft(fixture({ valueEach: 0 }), CONFIG);
  assert.equal(g.components.valueScore, 50);
  assert.equal(g.components.constructionScore, 100);
  assert.equal(g.grade, 'B'); // 0.6*50 + 0.4*100 = 70
});

test('strong-value draft grades higher than at-market', () => {
  const base = gradeDraft(fixture({ valueEach: 0 }), CONFIG).gradeScore;
  const strong = gradeDraft(fixture({ valueEach: 12 }), CONFIG).gradeScore;
  assert.ok(strong > base, `strong ${strong} > base ${base}`);
});

test('K/DST value is EXCLUDED from the grade', () => {
  const plain = gradeDraft(fixture({ valueEach: 0, kdstValue: 0 }), CONFIG);
  const kdstJammed = gradeDraft(fixture({ valueEach: 0, kdstValue: 999 }), CONFIG);
  assert.equal(plain.components.valueScore, kdstJammed.components.valueScore, 'K/DST value must not move valueScore');
  assert.equal(plain.grade, kdstJammed.grade);
});

test('construction penalties: late starters, bench concentration, bye stack all deduct', () => {
  const clean = gradeDraft(fixture({}), CONFIG).components.constructionScore;
  const late = gradeDraft(fixture({ lateStarterRounds: [1, 2, 3, 4, 5, 12, 13] }), CONFIG).components.constructionScore;
  const bench = gradeDraft(fixture({ benchAllRB: true }), CONFIG).components.constructionScore;
  const bye = gradeDraft(fixture({ sameBye: true }), CONFIG).components.constructionScore;
  assert.ok(late < clean, 'late starters deduct');
  assert.ok(bench < clean, 'bench concentration deducts');
  assert.ok(bye < clean, 'bye stack deducts');
});

test('calibration: 300 auto-drafts land median B-/C+ with A <= 5%', async () => {
  const sql = neon(process.env.DATABASE_URL);
  const presets = await sql`SELECT name, teams_count, scoring_format, roster_slots FROM draft_configs WHERE is_preset ORDER BY id`;
  const pr = await sql`SELECT scoring_format, teams_count, ffc_player_id, name, position, team, adp, stdev, bye FROM sim_player_pool WHERE snapshot_date=(SELECT max(snapshot_date) FROM sim_player_pool)`;
  const byk = new Map();
  for (const r of pr) { const k = `${r.scoring_format}/${r.teams_count}`; if (!byk.has(k)) byk.set(k, []); byk.get(k).push({ ffcPlayerId: r.ffc_player_id, name: r.name, position: r.position, team: r.team, adp: Number(r.adp), stdev: r.stdev == null ? null : Number(r.stdev), bye: r.bye }); }
  const configs = presets.map((c) => ({ ...c, pool: byk.get(`${c.scoring_format}/${c.teams_count}`) }));
  const scores = []; const grades = [];
  for (let i = 0; i < 300; i++) {
    const cfg = configs[i % configs.length]; const seat = (i % cfg.teams_count) + 1;
    const res = eng.runFullDraft(cfg, cfg.pool, seat, { auto: true }, eng.makeRng(5000 + i));
    const g = gradeDraft(res.picks.filter((p) => p.isUser), cfg);
    scores.push(g.gradeScore); grades.push(g.grade);
  }
  scores.sort((a, b) => a - b);
  const median = bandFor(scores[Math.floor(0.5 * (scores.length - 1))]);
  const aPct = grades.filter((g) => g === 'A').length / grades.length * 100;
  console.log(`  calibration: median=${median}, A=${aPct.toFixed(1)}%`);
  assert.ok(['B-', 'C+'].includes(median), `median band ${median} should be B-/C+`);
  assert.ok(aPct <= 5, `A rate ${aPct.toFixed(1)}% should be <= 5%`);
});
