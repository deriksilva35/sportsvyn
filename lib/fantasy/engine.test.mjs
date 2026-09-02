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

// ---------------------------------------------------------------------------
// TEMPERATURE PER SOURCE (2 Sep 2026). Before this, a pool with no stdev at all
// (every Fantrax pool) fell through median([]) -> 1, and every candidate drew
// T = TEMP_BASE = 8: the engine's maximum-disagreement setting applied to the
// consensus #2 overall. These pin the two temperature sources, the absence of
// any third path, and the behaviour the fix exists for.
// ---------------------------------------------------------------------------
const { temperature, aiPick, canRoster, PARAMS } = eng;
const pprCfg = configs.find((c) => c.scoring_format === 'ppr' && c.teams_count === 12);
// A pool shaped like Fantrax's: ADP 1..N, no stdev anywhere. Positions cycle
// (K and DST included, so ensureFillablePool adds no synthetic rows and the
// stdev coverage is exactly what the fixture says it is).
function stdevlessPool(n = 300, stdev = () => null) {
  const pos = ['RB', 'WR', 'WR', 'RB', 'TE', 'QB', 'WR', 'RB', 'PK', 'DEF'];
  const out = [];
  for (let i = 1; i <= n; i++) out.push({ ffcPlayerId: `s${i}`, name: `Player ${i}`, position: pos[i % pos.length], team: 'AA', adp: i, stdev: stdev(i), bye: 5 });
  return out;
}

test('temperature source: an FFC pool is stdev-mode, a stdev-less pool is adp-mode, and there is no default of 1', () => {
  const ffc = createDraftState(pprCfg, pprCfg.pool, 1, null);
  assert.equal(ffc.tempMode, 'stdev');
  assert.ok(ffc.medianStdev > 1, `FFC medianStdev is a real spread, got ${ffc.medianStdev}`);

  const bare = createDraftState(pprCfg, stdevlessPool(), 1, null);
  assert.equal(bare.tempMode, 'adp');
  assert.equal(bare.medianStdev, null, 'a stdev-less pool carries NO median - the old code put 1 here');

  // Coverage decides: half or more of the fillable pool with stdev -> stdev-mode;
  // fewer -> adp-mode. A handful of stdev rows must not become everyone's median.
  const sparse = createDraftState(pprCfg, stdevlessPool(300, (i) => (i <= 10 ? 4 : null)), 1, null);
  assert.equal(sparse.tempMode, 'adp');
  const half = createDraftState(pprCfg, stdevlessPool(300, (i) => (i % 2 ? 4 : null)), 1, null);
  assert.equal(half.tempMode, 'stdev');
  assert.equal(half.medianStdev, 4);

  // The third path does not exist: a stdev-mode state without a median throws
  // instead of dividing by a stand-in.
  const broken = { ...ffc, medianStdev: null };
  assert.throws(() => temperature(broken, { adp: 10, stdev: null }), /without a median/);
  assert.throws(() => temperature({ ...ffc, tempMode: 'fantrax' }, { adp: 10 }), /unknown tempMode/);
});

test('temperature per source is pinned: stdev-mode scales by stdev/median, adp-mode by adp/ADP_REF, both floored at TEMP_MIN', () => {
  // stdev-mode: T = 8 * stdev / medianStdev, NULL stdev -> the median (T = 8).
  const st = { tempMode: 'stdev', medianStdev: 10 };
  assert.equal(temperature(st, { adp: 1, stdev: 1 }), PARAMS.TEMP_MIN);      // 0.8 -> floor
  assert.equal(temperature(st, { adp: 1, stdev: 5 }), 4);
  assert.equal(temperature(st, { adp: 1, stdev: 10 }), 8);
  assert.equal(temperature(st, { adp: 1, stdev: null }), 8);
  assert.equal(temperature(st, { adp: 1, stdev: 30 }), 24);
  // adp-mode: T = 8 * adp / ADP_REF. The floor binds through ADP 37.5 - the
  // first three rounds of a 12-team room - exactly where FFC's real stdev puts
  // the floor (every ADP <= 24 player on the 2026-09-01 snapshot sat at 2.5).
  const ad = { tempMode: 'adp', medianStdev: null };
  assert.equal(PARAMS.ADP_REF, 120);
  assert.equal(temperature(ad, { adp: 2, stdev: null }), PARAMS.TEMP_MIN);
  assert.equal(temperature(ad, { adp: 37.5, stdev: null }), PARAMS.TEMP_MIN);
  assert.equal(temperature(ad, { adp: 60, stdev: null }), 4);
  assert.equal(temperature(ad, { adp: 120, stdev: null }), 8);
  assert.equal(temperature(ad, { adp: 240, stdev: null }), 16);
  // and a stdev on an adp-mode row is ignored: the source was decided per pool.
  assert.equal(temperature(ad, { adp: 2, stdev: 500 }), PARAMS.TEMP_MIN);
});

test('adp-mode target behaviour: a consensus top-3 player goes within the first four picks the large majority of the time; a 10th-available reach at 1.3 does not happen', () => {
  // The defect this pins against: Fantrax room 438 took the 10th available
  // (ADP 15.1) at 1.3 with Bijan (ADP 2.0) on the board, at 0.8% - and a
  // second room did the same at 1.8. Under T = 8 flat that is a 1-in-125 that
  // fired twice in six picks; under the derived temperature it is not a tail,
  // it is off the table. (On this fixture the ADPs sit one apart, tighter than
  // a real top three - 1.22 / 2.00 / 3.37 on the live pool - so the 1.1 coin
  // between ADP 1 and ADP 2 is a fair one here; what is pinned is the target
  // as stated: top-3 within four, and the tail at 1.3.)
  const N = 500;
  let top3by4 = 0, rankAt3 = [];
  for (let seed = 1; seed <= N; seed++) {
    const st = createDraftState(pprCfg, stdevlessPool(), 1, null);
    const top3 = st.available.slice(0, 3).map((p) => p.ffcPlayerId);
    const taken = [];
    for (let pick = 1; pick <= 4; pick++) {
      const seat = st.order[st.overallPick - 1];
      const before = st.available.slice(0, PARAMS.CANDIDATE_N);
      const rec = aiPick(st, seat, makeRng(seed * 7919 + st.overallPick));
      taken.push(rec.ffcPlayerId);
      if (pick === 3) rankAt3.push(before.findIndex((p) => p.ffcPlayerId === rec.ffcPlayerId) + 1);
    }
    for (const id of top3) if (taken.includes(id)) top3by4++;
  }
  const reach5 = rankAt3.filter((r) => r >= 5).length;
  const reach10 = rankAt3.filter((r) => r >= 10).length;
  console.log(`  adp-mode: a top-3 player gone within picks 1-4 ${(100 * top3by4 / (3 * N)).toFixed(1)}%; 1.3 took the 5th+ available ${(100 * reach5 / N).toFixed(1)}%, the 10th+ ${(100 * reach10 / N).toFixed(1)}%`);
  assert.ok(top3by4 / (3 * N) > 0.9, `a top-3 player should be gone within four picks the large majority of the time, got ${top3by4}/${3 * N}`);
  assert.ok(reach5 / N < 0.03, `a 5th-available at 1.3 is a rare tail, got ${reach5}/${N}`);
  assert.equal(reach10, 0, `a 10th-available at 1.3 must not happen, got ${reach10}/${N}`);
});

test('determinism holds in both modes: same seed, same picks; a different seed differs', () => {
  const bare = stdevlessPool();
  const a = runFullDraft(pprCfg, bare, 4, { auto: true }, makeRng(7));
  const b = runFullDraft(pprCfg, bare, 4, { auto: true }, makeRng(7));
  const c = runFullDraft(pprCfg, bare, 4, { auto: true }, makeRng(8));
  assert.deepEqual(a.picks.map((p) => p.ffcPlayerId), b.picks.map((p) => p.ffcPlayerId));
  assert.notDeepEqual(a.picks.map((p) => p.ffcPlayerId), c.picks.map((p) => p.ffcPlayerId));
  // and the FFC (stdev-mode) room is byte-identical to itself across two builds
  const f1 = runFullDraft(pprCfg, pprCfg.pool, 4, { auto: true }, makeRng(7));
  const f2 = runFullDraft(pprCfg, pprCfg.pool, 4, { auto: true }, makeRng(7));
  assert.deepEqual(f1.picks.map((p) => p.ffcPlayerId), f2.picks.map((p) => p.ffcPlayerId));
});

test('the real Fantrax import is adp-mode: no row carries stdev, and the first three rounds sit at the floor', async () => {
  // The rows the importer actually writes (lib/fantrax/import.js toPoolRows:
  // adp only - getAdp carries no spread). If Fantrax ever starts shipping one,
  // this flips to stdev-mode on its own and this test says so.
  const rows = await sql`
    SELECT ffc_player_id, name, position, team, adp, stdev, bye FROM sim_player_pool
     WHERE source = 'fantrax' AND scoring_format = 'ppr' AND teams_count = 12
       AND snapshot_date = (SELECT max(snapshot_date) FROM sim_player_pool WHERE source = 'fantrax' AND scoring_format = 'ppr' AND teams_count = 12)`;
  assert.ok(rows.length > 100, `a Fantrax ppr/12 pool is in DEV, got ${rows.length} rows`);
  const pool = rows.map((r) => ({ ffcPlayerId: r.ffc_player_id, name: r.name, position: r.position, team: r.team, adp: Number(r.adp), stdev: r.stdev == null ? null : Number(r.stdev), bye: r.bye }));
  assert.equal(pool.filter((p) => p.stdev != null).length, 0, 'Fantrax rows carry no stdev');
  const st = createDraftState(pprCfg, pool, 1, null);
  assert.equal(st.tempMode, 'adp');
  assert.equal(st.medianStdev, null);
  const early = st.available.filter((p) => p.adp <= 37.5);
  // Fantrax's ADP_PPR runs sparser than pick numbers (round-one gaps of ~1.5),
  // so ~21 players sit under 37.5, not 36.
  assert.ok(early.length >= 15, `the floor band is populated, got ${early.length}`);
  for (const p of early) assert.equal(temperature(st, p), PARAMS.TEMP_MIN, `${p.name} (ADP ${p.adp}) at the floor`);
  const deep = st.available.find((p) => p.adp >= 200);
  assert.ok(temperature(st, deep) > 13, `ADP ${deep.adp} is hot (${temperature(st, deep).toFixed(2)}), as it is in an FFC room`);
});

// ---------------------------------------------------------------------------
// BOARD PAR (2 Sep 2026). value = par - adp with par = max(overallPick, ADP of
// the board's #1). Before this par was the raw pick number, which on a
// keeper-drained board put every candidate below zero and let the hottest,
// least-needed candidate win: QB at overall 24 of THE LONGEST YARD in 72.6% of
// 500 seeds (Lamar Jackson, ADP 47.9, over Zay Flowers, the board's #1 at
// 35.65, at 9%). No constant was added; these pin the drained board and the
// anchor's silence on a board that is not drained.
// ---------------------------------------------------------------------------
const { applyPick, takeKeeper } = eng;
const { keeperPicks, leagueSeats } = await import('../fantrax/keeperSeed.js');
const boardPar = (st) => Math.max(st.overallPick, Number(st.available[0].adp));

// Walk a full-auto draft pick by pick so the state can be inspected BEFORE each
// AI decision (runFullDraft is a black box). Returns the picks and whatever
// `probe(state)` collected at each AI pick. Same loop as runFullDraft: keeper
// first if one is owed, no rng drawn for it.
function walkDraft(cfg, pool, keepers, seed, probe) {
  const st = createDraftState(cfg, pool, 1, keepers);
  const rng = makeRng(seed);
  const total = st.rounds * st.teamsCount;
  const probes = [];
  for (let k = 0; k < total; k++) {
    if (takeKeeper(st)) continue;
    probes.push(probe(st));
    const rec = aiPick(st, st.order[k], rng);
    assert.ok(rec, `legal pick at overall ${k + 1}`);
  }
  return { picks: st.picks, probes, st };
}

test('board par: on a dense board the anchor is inert at every pick, so a fixed seed drafts exactly as it did before the anchor', () => {
  // ADP 1..300 with no gaps: the k-th pick always has a player at or below k
  // left, so par == overallPick throughout and value == overallPick - adp, the
  // pre-anchor term, at every pick. Byte-identity with the old engine follows
  // by construction rather than by a recorded pick list that rots with the pool.
  const dense = stdevlessPool(300);
  const { picks, probes } = walkDraft(pprCfg, dense, null, 11, (st) => boardPar(st) - st.overallPick);
  assert.equal(probes.length, picks.length);
  assert.ok(probes.every((d) => d === 0), `par exceeded the pick number at ${probes.filter((d) => d > 0).length} picks`);
  // and the walk IS the draft runFullDraft produces on that seed
  const full = runFullDraft(pprCfg, dense, 1, { auto: true }, makeRng(11));
  assert.deepEqual(picks.map((p) => p.ffcPlayerId), full.picks.map((p) => p.ffcPlayerId));
});

test('board par: the real undrained FFC board moves the anchor rarely and by less than two picks', () => {
  // Measured before the pin: the board's #1 sits above the pick at 6.2% of
  // picks on preset 1 (500 seeds), never by more than 1.4 - a pick's worth of
  // ADP granularity at the very top (Gibbs 1.7 at overall 1). That is the
  // whole extent of the anchor's effect on a board nobody drained: 269 of 500
  // seeds draft byte-identically to the pre-anchor engine and the rest first
  // differ at a coin-flip pick (seed 1: overall 20, Olave 23.3 vs Love 23.1).
  let above = 0, total = 0, worst = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const { probes } = walkDraft(pprCfg, pprCfg.pool, null, seed, (st) => boardPar(st) - st.overallPick);
    total += probes.length;
    for (const d of probes) { if (d > 0) above++; worst = Math.max(worst, d); }
  }
  assert.ok(above / total < 0.1, `anchor above the pick at ${(100 * above / total).toFixed(1)}% of picks`);
  assert.ok(worst < 2, `anchor never more than a pick or two above: worst ${worst.toFixed(2)}`);
});

test('board par: on THE LONGEST YARD (41 keepers) QB at overall 24 is rare and rounds 1-3 hold the market\'s QB count', async () => {
  // The room the defect was found in: config 6661 on DEV, the Fantrax ppr/12
  // pool, 41 keepers off the board before any AI pick. Read, never written.
  const [cfg] = await sql`SELECT teams_count, scoring_format, roster_slots, teams FROM draft_configs WHERE id = 6661`;
  assert.ok(cfg, 'config 6661 (THE LONGEST YARD) is in DEV');
  const krows = await sql`SELECT fantrax_team_id, round, fantrax_player_id, player_name, position, adp, team FROM draft_config_keepers WHERE config_id = 6661 ORDER BY round`;
  assert.ok(krows.length >= 30, `a drained board: ${krows.length} keepers`);
  const rows = await sql`
    SELECT ffc_player_id, name, position, team, adp, stdev, bye FROM sim_player_pool
     WHERE source = 'fantrax' AND scoring_format = 'ppr' AND teams_count = 12
       AND snapshot_date = (SELECT max(snapshot_date) FROM sim_player_pool WHERE source = 'fantrax' AND scoring_format = 'ppr' AND teams_count = 12)`;
  const pool = rows.map((r) => ({ ffcPlayerId: r.ffc_player_id, name: r.name, position: r.position, team: r.team, adp: Number(r.adp), stdev: r.stdev == null ? null : Number(r.stdev), bye: r.bye }));
  const { seatOf } = leagueSeats(cfg.teams);
  const { recs } = keeperPicks(krows, cfg.teams_count, seatOf);
  const keepers = new Map(recs.map((r) => [r.overallPick, { ffcPlayerId: r.ffcPlayerId, position: r.position, adp: r.adpAtPick, team: r.team, playerName: r.playerName }]));

  // The market: QBs among the top-N available at the start, N = the non-keeper
  // picks in rounds 1-3. What a room drafting at ADP would take.
  const start = createDraftState(cfg, pool, 1, keepers);
  const openR13 = 36 - [...keepers.keys()].filter((o) => o <= 36).length;
  const marketQB = start.available.slice(0, openR13).filter((p) => p.position === 'QB').length;
  assert.ok(!keepers.has(24), 'overall 24 is an AI pick');

  const SEEDS = 400;
  let qbAt24 = 0, qbR13 = 0, parAt24 = null, top24 = null;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { picks, probes } = walkDraft(cfg, pool, keepers, seed, (st) => (st.overallPick === 24 ? { par: boardPar(st), top: st.available[0] } : null));
    const at24 = probes.find(Boolean);
    parAt24 = at24.par; top24 = at24.top;
    if (picks[23].position === 'QB') qbAt24++;
    qbR13 += picks.slice(0, 36).filter((p) => !p.isKeeper && p.position === 'QB').length;
  }
  // The drained-board condition itself: at 24 the best player left sits well
  // above the pick (35.65 on the 2026-09-01 snapshot) and is not a QB.
  assert.ok(parAt24 - 24 > 5, `the board is drained at 24: par ${parAt24}`);
  assert.notEqual(top24.position, 'QB', `the #1 at 24 is ${top24.name} (${top24.position})`);
  // Was 72.6% under the raw pick number; 0.8% under board par (500 seeds).
  assert.ok(qbAt24 / SEEDS < 0.05, `QB at overall 24 in ${(100 * qbAt24 / SEEDS).toFixed(1)}% of seeds`);
  // Was 3.53 per draft under the raw pick number; 2.02 under board par against a market of 2.
  const meanQB = qbR13 / SEEDS;
  assert.ok(Math.abs(meanQB - marketQB) <= 0.6, `QBs in rounds 1-3: ${meanQB.toFixed(2)} per draft vs the market's ${marketQB}`);
});
