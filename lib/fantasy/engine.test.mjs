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
// SOURCE-SCOPED (083). The pool table now also holds Fantrax snapshots, and
// they are dated the day they are imported - newer than the FFC snapshot. This
// query used to read "the latest snapshot" across the whole table, which the
// day after the first Fantrax import meant: every non-ppr/12 preset got an EMPTY
// pool and ppr/12 got a 469-row league pool, and the suite died at overall 1.
// The presets are FFC-fed, so the fixture reads the latest FFC snapshot.
const poolRows = await sql`
  SELECT scoring_format, teams_count, ffc_player_id, name, position, team, adp, stdev, bye
    FROM sim_player_pool
   WHERE source = 'ffc'
     AND snapshot_date = (SELECT max(snapshot_date) FROM sim_player_pool WHERE source = 'ffc')`;
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
// ROUNDS ARE DERIVED PER CONFIG, not fixed at 15.
//
// This was `const totalRounds = 15`, which held only because every preset then
// in the deck happened to sum to fifteen. "The Weekly Six" - the ranked format,
// which is eight rounds with no bench - broke it immediately, and correctly:
// the invariant was always "a roster fills exactly its config", and 15 was a
// coincidence of the fixtures rather than a property of the engine.
const roundsOf = (cfg) => Object.values(cfg.roster_slots).reduce((a, b) => a + Number(b), 0);

// ===========================================================================
// (1) INVARIANTS
// ===========================================================================
test('every roster fills exactly its config\'s rounds, whatever that number is', () => {
  for (const { cfg, res } of drafts) {
    const totalRounds = roundsOf(cfg);
    for (const team of res.teams) {
      assert.equal(team.picks.length, totalRounds, `${cfg.name}: team ${team.index} has ${team.picks.length} picks, expected ${totalRounds}`);
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
    for (let r = 0; r < roundsOf(cfg); r++) {
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

// ===========================================================================
// (4) KEEPERS - a league arrives with picks already made
// ===========================================================================
// PINNED FROM A MEASURED FAILURE. The first cut applied keepers up front with
// applyPick, which numbered them 1..41 and died at overall 193; the second held
// them in `available` until their overall and Chase Brown (kept at 12) went to
// an AI at 4. The draft below puts a top-3 ADP player on the shelf for round 3
// and a late keeper on the user's seat, and asserts what both failures broke.
test('keepers: held off the board from pick one, taken at their own overall, roster conserved', () => {
  const cfg = configs.find((c) => c.scoring_format === 'ppr' && c.teams_count === 12);
  const N = cfg.teams_count;
  const byAdp = cfg.pool.slice().sort((a, b) => a.adp - b.adp);
  const rounds = roundsOf(cfg);
  // (round, pickInRound) -> overall; the seat the snake owes it.
  const overall = (r, p) => (r - 1) * N + p;
  const seat = (r, p) => (r % 2 === 1 ? p - 1 : N - p);
  const keepers = new Map([
    [overall(3, 3), byAdp[1]],              // a #2 ADP player kept in round 3
    [overall(7, 2), byAdp[60]],             // round 7, seat 2 - the user's
    [overall(12, 11), byAdp[120]],          // even round: pick 11 is seat 2
    [overall(rounds, 1), byAdp[200]],       // the last round still owes one
  ].map(([o, pl]) => [o, { ffcPlayerId: pl.ffcPlayerId, playerName: pl.name, position: pl.position }]));

  const state = createDraftState(cfg, cfg.pool, 2, keepers);
  for (const k of keepers.values()) {
    assert.ok(!state.available.some((p) => p.ffcPlayerId === k.ffcPlayerId), `${k.playerName} must not be on the board at pick 1`);
  }
  const res = runFullDraft(cfg, cfg.pool, 2, { auto: true }, makeRng(7), state);

  assert.equal(res.picks.length, rounds * N, 'every pick made');
  const kept = res.picks.filter((p) => p.isKeeper === true);
  assert.equal(kept.length, keepers.size, 'exactly the keepers are flagged');
  for (const [o, k] of keepers) {
    const rec = res.picks.find((p) => p.overallPick === o);
    assert.equal(rec.ffcPlayerId, k.ffcPlayerId, `overall ${o} is ${k.playerName}`);
    assert.equal(rec.pickedBy, 'logged');
    assert.equal(rec.teamIndex, seat(Math.ceil(o / N), ((o - 1) % N) + 1), `overall ${o} on the snake seat`);
  }
  const ids = res.picks.map((p) => p.ffcPlayerId);
  assert.equal(new Set(ids).size, ids.length, 'no kept player drafted twice');
  for (const team of res.teams) assert.equal(team.picks.length, rounds, `seat ${team.index + 1} has ${rounds} picks`);
  // The user's seat owns two of them and they landed on the user.
  assert.equal(res.teams[1].picks.filter((p) => p.isKeeper).length, 2);
});

// RE-PINNED (Stage 3B). This test used to claim that a keeper absent from the
// pool fails at creation (/Nobody (not-in-pool) at overall 5/). That held while
// the pool carried every keeper and the shelf was a lookup into it. The Fantrax
// pool now EXCLUDES held players - a keeper is not on the board by definition -
// so the shelf is built from the keeper record (name, position, adp, team) and
// only a record with no name or no position is unbuildable.
test('keepers: the shelf is built from the record, not the pool; a nameless or positionless record fails at creation', () => {
  const cfg = configs.find((c) => c.scoring_format === 'ppr' && c.teams_count === 12);
  const keepers = new Map([[5, { ffcPlayerId: 'not-in-pool', playerName: 'Nobody', position: 'RB', adp: 12.5, team: 'ARI' }]]);
  const st = createDraftState(cfg, cfg.pool, 1, keepers);
  assert.deepEqual(st.held.get('not-in-pool'), { ffcPlayerId: 'not-in-pool', name: 'Nobody', position: 'RB', team: 'ARI', bye: null, adp: 12.5, stdev: null });
  assert.ok(!st.available.some((p) => p.ffcPlayerId === 'not-in-pool'));
  assert.throws(() => createDraftState(cfg, cfg.pool, 1, new Map([[5, { ffcPlayerId: 'x', playerName: '', position: 'RB' }]])), /keeper x at overall 5 has no name or position/);
  assert.throws(() => createDraftState(cfg, cfg.pool, 1, new Map([[5, { ffcPlayerId: 'x', playerName: 'X', position: null }]])), /keeper x at overall 5 has no name or position/);
});

test('keepers: a draft without any is unchanged (same seed, same picks)', () => {
  const cfg = configs.find((c) => c.scoring_format === 'ppr' && c.teams_count === 12);
  const a = runFullDraft(cfg, cfg.pool, 4, { auto: true }, makeRng(99));
  const b = runFullDraft(cfg, cfg.pool, 4, { auto: true }, makeRng(99), createDraftState(cfg, cfg.pool, 4, null));
  assert.deepEqual(a.picks.map((p) => p.ffcPlayerId), b.picks.map((p) => p.ffcPlayerId));
});
