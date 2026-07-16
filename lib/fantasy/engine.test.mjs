// lib/fantasy/engine.test.mjs — headless invariant + behavior suite for the draft
// engine. Loads the REAL DEV sim_player_pool once (engine stays pure; the test
// loads data), then runs 200 seeded full-auto drafts across the 4 presets.
// Run: node --test lib/fantasy/engine.test.mjs

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
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const { neon } = await import('@neondatabase/serverless');
const eng = await import('./engine.js');
const { makeRng, runFullDraft, gradeRoster, perPickValue, needWeight, createDraftState, _internals } = eng;

// ---- small read helper (data load only; engine never touches the DB) ----
const sql = neon(process.env.DATABASE_URL);
const presetRows = await sql`SELECT name, teams_count, scoring_format, roster_slots FROM draft_configs WHERE is_preset ORDER BY id`;
const poolRows = await sql`
  SELECT scoring_format, teams_count, ffc_player_id, name, position, team, adp, stdev, bye
    FROM sim_player_pool
   WHERE snapshot_date = (SELECT max(snapshot_date) FROM sim_player_pool)`;
const poolByKey = new Map();
for (const r of poolRows) {
  const key = `${r.scoring_format}/${r.teams_count}`;
  if (!poolByKey.has(key)) poolByKey.set(key, []);
  poolByKey.get(key).push({
    ffcPlayerId: r.ffc_player_id, name: r.name, position: r.position, team: r.team,
    adp: Number(r.adp), stdev: r.stdev == null ? null : Number(r.stdev), bye: r.bye,
  });
}
const configs = presetRows.map((c) => ({
  name: c.name, teams_count: c.teams_count, scoring_format: c.scoring_format,
  roster_slots: c.roster_slots,
  pool: poolByKey.get(`${c.scoring_format}/${c.teams_count}`) ?? [],
}));

// ---- run 200 seeded full-auto drafts (mixed presets) ----
const N_DRAFTS = 200;
const drafts = [];
for (let i = 0; i < N_DRAFTS; i++) {
  const cfg = configs[i % configs.length];
  const userPos = (i % cfg.teams_count) + 1;
  const rng = makeRng(1000 + i);
  const res = runFullDraft(cfg, cfg.pool, userPos, { auto: true }, rng);
  drafts.push({ cfg, userPos, res });
}
const totalRounds = 15;

// ===========================================================================
// (1) INVARIANTS
// ===========================================================================
test('every roster fills exactly 15 slots matching its config', () => {
  for (const { cfg, res } of drafts) {
    for (const team of res.teams) {
      assert.equal(team.picks.length, totalRounds, `${cfg.name}: team ${team.index} has ${team.picks.length} picks`);
      for (const [slot, cap] of Object.entries(cfg.roster_slots)) {
        assert.equal(team.slots[slot].filled, cap, `${cfg.name}: team ${team.index} slot ${slot} ${team.slots[slot].filled}/${cap}`);
      }
    }
  }
});

test('zero duplicate players within a draft', () => {
  for (const { cfg, res } of drafts) {
    const ids = res.picks.map((p) => p.ffcPlayerId);
    assert.equal(new Set(ids).size, ids.length, `${cfg.name}: duplicate player in draft`);
  }
});

test('zero sanity-floor violations (K/DST timing, 2nd K/DST, QB caps)', () => {
  for (const { cfg, res } of drafts) {
    const is2qb = cfg.roster_slots.QB >= 2;
    for (const p of res.picks) {
      if ((p.slotPos === 'K' || p.slotPos === 'DST')) {
        assert.ok(p.round >= 13, `${cfg.name}: ${p.slotPos} drafted at round ${p.round} (< 13)`);
      }
    }
    for (const team of res.teams) {
      assert.ok(team.posCount.K <= 1, `${cfg.name}: 2nd K`);
      assert.ok(team.posCount.DST <= 1, `${cfg.name}: 2nd DST`);
      assert.ok(team.posCount.QB <= (is2qb ? 3 : 2), `${cfg.name}: QB cap exceeded (${team.posCount.QB})`);
    }
  }
});

test('top-5 ADP players are always drafted', () => {
  for (const { cfg, res } of drafts) {
    const top5 = cfg.pool.slice().sort((a, b) => a.adp - b.adp).slice(0, 5).map((p) => p.ffcPlayerId);
    const drafted = new Set(res.picks.map((p) => p.ffcPlayerId));
    for (const id of top5) assert.ok(drafted.has(id), `${cfg.name}: top-5 player ${id} undrafted`);
  }
});

test('snake order correctness (round 2 reverses, etc.)', () => {
  for (const { cfg, res } of drafts.slice(0, 4)) {
    const N = cfg.teams_count;
    const order = res.state.order;
    for (let r = 0; r < totalRounds; r++) {
      const row = order.slice(r * N, r * N + N);
      const expected = Array.from({ length: N }, (_, t) => t);
      if (r % 2 === 1) expected.reverse();
      assert.deepEqual(row, expected, `${cfg.name}: round ${r + 1} order`);
    }
  }
});

// ===========================================================================
// (2) BEHAVIOR (statistical over the corpus)
// ===========================================================================
test('low-stdev players are picked closer to ADP than high-stdev players', () => {
  // pool medians per key to bucket each pick's player
  const medByKey = new Map();
  for (const [k, rows] of poolByKey) {
    const s = rows.map((r) => r.stdev).filter((x) => x != null).sort((a, b) => a - b);
    medByKey.set(k, s[Math.floor(s.length / 2)]);
  }
  const stdevById = new Map();
  for (const [k, rows] of poolByKey) for (const r of rows) stdevById.set(`${k}:${r.ffcPlayerId}`, r.stdev);

  let loSum = 0, loN = 0, hiSum = 0, hiN = 0;
  for (const { cfg, res } of drafts) {
    const key = `${cfg.scoring_format}/${cfg.teams_count}`;
    const med = medByKey.get(key);
    for (const p of res.picks) {
      const sd = stdevById.get(`${key}:${p.ffcPlayerId}`);
      if (sd == null) continue;
      const dev = Math.abs(p.overallPick - p.adpAtPick);
      if (sd <= med) { loSum += dev; loN++; } else { hiSum += dev; hiN++; }
    }
  }
  const loMean = loSum / loN, hiMean = hiSum / hiN;
  console.log(`  |pick-ADP| low-stdev=${loMean.toFixed(2)} (n=${loN}) vs high-stdev=${hiMean.toFixed(2)} (n=${hiN})`);
  assert.ok(loMean < hiMean, `expected low-stdev mean (${loMean.toFixed(2)}) < high-stdev (${hiMean.toFixed(2)})`);
});

test('run detection fires (unit) and runs occur in the corpus', () => {
  // unit: a state whose last 6 picks are 4 RBs boosts RB need weight by RUN_MULT
  const cfg = configs.find((c) => c.scoring_format === 'ppr');
  const st = createDraftState(cfg, cfg.pool, 1);
  const team = st.teams[0];
  const rbCand = cfg.pool.find((p) => p.position === 'RB');
  const wBase = needWeight(st, team, rbCand);
  st.picks = [
    { slotPos: 'RB' }, { slotPos: 'WR' }, { slotPos: 'RB' }, { slotPos: 'RB' }, { slotPos: 'QB' }, { slotPos: 'RB' },
  ];
  const wRun = needWeight(st, team, rbCand);
  console.log(`  run boost: RB needWeight ${wBase.toFixed(2)} -> ${wRun.toFixed(2)} (x${(wRun / wBase).toFixed(2)})`);
  assert.ok(wRun > wBase * 1.4, 'run boost should raise need weight ~1.5x');

  // corpus: at least one 6-pick window with >=4 of one position
  let runsFound = 0;
  for (const { res } of drafts) {
    for (let i = 5; i < res.picks.length; i++) {
      const win = res.picks.slice(i - 5, i + 1);
      const counts = {};
      for (const p of win) counts[p.slotPos] = (counts[p.slotPos] ?? 0) + 1;
      if (Math.max(...Object.values(counts)) >= 4) { runsFound++; break; }
    }
  }
  console.log(`  drafts containing a positional run (>=4/6): ${runsFound}/${drafts.length}`);
  assert.ok(runsFound > 0, 'no positional runs detected across the corpus');
});

test('grading primitives reconcile; pivot exists', () => {
  for (const { res } of drafts.slice(0, 20)) {
    for (const team of res.teams) {
      const g = gradeRoster(team.picks);
      const manual = team.picks.filter((p) => !p.synthetic).reduce((a, p) => a + perPickValue(p), 0);
      assert.ok(Math.abs(g.rosterValueTotal - manual) < 1e-9, 'rosterValueTotal reconciles');
      assert.ok(g.pivot != null, 'pivot exists for a full roster');
      assert.ok(g.bestValue.ppv <= g.biggestReach.ppv, 'bestValue <= biggestReach');
    }
  }
});

// ===========================================================================
// (3) SAMPLE DRAFT (printed for eyeball realism)
// ===========================================================================
test('print one sample draft (12-team PPR, user slot 5, full-auto)', () => {
  const cfg = configs.find((c) => c.scoring_format === 'ppr' && c.teams_count === 12);
  const res = runFullDraft(cfg, cfg.pool, 5, { auto: true }, makeRng(42));
  const N = cfg.teams_count;
  const lines = ['', `  === SAMPLE DRAFT: ${cfg.name}, user = seat 5 (marked *) ===`];
  for (let r = 0; r < 15; r++) {
    const row = res.picks.slice(r * N, r * N + N);
    const cells = row.map((p) => {
      const star = p.isUser ? '*' : ' ';
      return `${star}${p.slotPos}:${(p.playerName || '').split(' ').slice(-1)[0].slice(0, 10)}`;
    });
    lines.push(`  R${String(r + 1).padStart(2)} | ` + cells.join('  '));
  }
  const userTeam = res.teams[4];
  const g = gradeRoster(userTeam.picks);
  lines.push('');
  lines.push(`  USER ROSTER (seat 5): ${userTeam.picks.map((p) => `${p.slotPos} ${p.playerName}`).join(', ')}`);
  lines.push(`  balance=${JSON.stringify(g.positionalBalance)}  rosterValueTotal=${g.rosterValueTotal.toFixed(1)}`);
  lines.push(`  bestValue=${g.bestValue.playerName} (ppv ${g.bestValue.ppv.toFixed(1)})  biggestReach=${g.biggestReach.playerName} (ppv ${g.biggestReach.ppv.toFixed(1)})`);
  lines.push(`  pivot=${g.pivot.playerName} (needWeight ${g.pivot.needWeight.toFixed(2)}, R${g.pivot.round})`);
  lines.push(`  byeStackWarnings=${JSON.stringify(g.byeStackWarnings)}`);
  console.log(lines.join('\n'));
  assert.ok(userTeam.picks.length === 15);
});
