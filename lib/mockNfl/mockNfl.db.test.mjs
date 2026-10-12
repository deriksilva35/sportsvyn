// lib/mockNfl/mockNfl.db.test.mjs - the NFL mock on DEV (mon-3): the stored pool
// drafts to the end under both presets (no stall, K/D/ST/FLEX legal), 20
// auto-drafts on it spread across grades, and saved setups / settings are kept
// PER SPORT (an NBA and an NFL list side by side). Test-owned users dgnbatest-nfl-*.
import { test, after } from 'node:test';
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

const { sql } = await import('../db.js');
const KIT = await import('./roster.js');
const { readNflMockPool, POOL_MIN } = await import('./pool.js');
const { rankPool } = await import('./rank.js');
const { SCORING_PRESETS } = await import('./scoring.js');
const NFL = await import('./settings.js');
const NBA = await import('../mockNba/settings.js');
const { createMock, autoDraftRest, isDone, totalPicks } = await import('../mockNba/draft.js');
const { gradeMock } = await import('../mockNba/grade.js');
const { createSetup, listSetups, deleteSetup, MAX_SETUPS } = await import('../mockNba/setups.js');
const { saveMockSettings, readMockSettings, clearMockSettings } = await import('../mockNba/record.js');

const users = [];
after(async () => {
  if (users.length) await sql`DELETE FROM users WHERE id = ANY(${users})`;
  const [l] = await sql`SELECT count(*)::int AS n FROM users WHERE email LIKE 'dgnbatest-nfl-%'`;
  assert.equal(l.n, 0, 'teardown left no test users');
});

test('the stored pool: big enough, every position, kickers and defenses for 14 teams', async () => {
  const pool = await readNflMockPool();
  assert.ok(pool, 'DEV has an nfl_mock_pool row (build it with the cron or lib/mockNfl/pool.js)');
  assert.ok(pool.rows.length >= POOL_MIN, `pool ${pool.rows.length}`);
  const by = (p) => pool.rows.filter((r) => r.pos === p).length;
  for (const p of ['QB', 'RB', 'WR', 'TE']) assert.ok(by(p) >= 14, `${p} ${by(p)}`);
  assert.ok(by('K') >= 14 && by('DST') >= 14, `K ${by('K')} DST ${by('DST')}`);
  assert.ok(pool.adpAsOf, 'the ADP date is carried');
});

test('real pool: both presets draft to the end at 8 / 12 / 14 teams; 20 auto-drafts spread across grades', async () => {
  const rows = (await readNflMockPool()).rows;
  for (const [preset, teams, scoring] of [['espn', 12, 'ppr'], ['yahoo', 14, 'half'], ['espn', 8, 'standard']]) {
    const slots = KIT.slotsFromCounts(KIT.ROSTER_PRESETS[preset].counts);
    const st = autoDraftRest(createMock(rankPool(rows, SCORING_PRESETS[scoring].weights), { userSeat: 1, seed: teams, teams, slots, botKey: 'adp', kit: KIT }));
    assert.ok(isDone(st)); assert.equal(st.picks.length, totalPicks(st));
    for (const r of st.rosters) for (const x of r) assert.ok(x.player && (x.slot === 'BN' || KIT.eligible(x.player).has(x.slot)), `${x.player?.pos} in ${x.slot}`);
  }
  const ranked = rankPool(rows); const by = {};
  for (let k = 0; k < 20; k += 1) {
    const g = gradeMock(autoDraftRest(createMock(ranked, { userSeat: k % 12, seed: 4000 + k, botKey: 'adp', kit: KIT }))).grade;
    by[g] = (by[g] ?? 0) + 1;
  }
  console.log('NFL auto-draft grades on the real pool:', JSON.stringify(by));
  // IN SEASON (mon-5) every team - bots and auto-draft - picks by SVP + need: still a spread.
  const bySvp = {};
  for (let k = 0; k < 20; k += 1) {
    const g = gradeMock(autoDraftRest(createMock(ranked, { userSeat: k % 12, seed: 7000 + k, botKey: 'svp', kit: KIT }))).grade;
    bySvp[g] = (bySvp[g] ?? 0) + 1;
  }
  console.log('NFL in-season (SVP) auto-draft grades:', JSON.stringify(bySvp));
  assert.ok(Object.keys(bySvp).length >= 4, JSON.stringify(bySvp));
  assert.ok(Object.keys(by).length >= 4, JSON.stringify(by));
  assert.ok((by['A+'] ?? 0) <= 8, JSON.stringify(by));
});

test('SAVED SETUPS PER SPORT: one list each, same name allowed across sports, limit per sport, exact round trip', async () => {
  const [u] = await sql`INSERT INTO users (email, name) VALUES (${`dgnbatest-nfl-${Date.now()}@example.invalid`}, 'nfl setups test') RETURNING id`;
  users.push(u.id);
  const nfl = NFL.normalizeSettings({ ...NFL.DEFAULT_SETTINGS, teams: 10, scoring: 'custom', customWeights: { ...SCORING_PRESETS.ppr.weights, rec: 0.75, passYds: 0.05 }, roster: 'custom', customCounts: { ...KIT.ROSTER_PRESETS.yahoo.counts, BN: 9 } });
  const nba = NBA.normalizeSettings({ ...NBA.DEFAULT_SETTINGS, teams: 9 });
  assert.equal((await createSetup(u.id, 'Office', nfl, { sport: 'nfl' })).ok, true);
  assert.equal((await createSetup(u.id, 'Office', nba, { sport: 'nba' })).ok, true, 'the same name in the other sport');
  assert.deepEqual(await createSetup(u.id, 'office', nfl, { sport: 'nfl' }), { ok: false, reason: 'name_taken' });
  const [nflList, nbaList] = [await listSetups(u.id, { sport: 'nfl' }), await listSetups(u.id, { sport: 'nba' })];
  assert.equal(nflList.length, 1); assert.equal(nbaList.length, 1);
  assert.deepEqual(nflList[0].settings, nfl, 'NFL custom values round-trip exactly');
  assert.deepEqual(nbaList[0].settings, nba);
  assert.deepEqual(await deleteSetup(u.id, nflList[0].id, { sport: 'nba' }), { ok: false, reason: 'not_found' }, 'not reachable from the other sport');
  for (let i = 2; i <= MAX_SETUPS; i += 1) assert.equal((await createSetup(u.id, `L${i}`, nfl, { sport: 'nfl' })).ok, true);
  assert.deepEqual(await createSetup(u.id, 'eleven', nfl, { sport: 'nfl' }), { ok: false, reason: 'limit' });
  assert.equal((await createSetup(u.id, 'NBA two', nba, { sport: 'nba' })).ok, true, 'the NFL limit is not the NBA limit');
  // The last-used setup, per sport.
  await saveMockSettings(u.id, nfl, { sport: 'nfl' }); await saveMockSettings(u.id, nba, { sport: 'nba' });
  assert.deepEqual(await readMockSettings(u.id, { sport: 'nfl' }), nfl);
  assert.deepEqual(await readMockSettings(u.id, { sport: 'nba' }), nba);
  await clearMockSettings(u.id, { sport: 'nfl' });
  assert.equal(await readMockSettings(u.id, { sport: 'nfl' }), null);
  assert.deepEqual(await readMockSettings(u.id, { sport: 'nba' }), nba, 'clearing NFL leaves NBA');
});
