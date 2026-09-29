// lib/mlb/advanceKick.test.mjs - the day-over detector on a DEV fixture (tue-2).
//
// Real rows, real query: MLB games on ET days in October 2099 (no real game will
// ever be there), slugs carrying "test" so scripts/dev-orphan-sweep.mjs lists any
// a killed run leaves behind. The launcher is a stub that records its calls - no
// systemd unit is ever created by this file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../db.js';
import { kickIfDayDone } from './advanceKick.js';

const TAG = `mlbadv-test-${process.pid}`;
let league; let home; let away; const made = [];

async function game(slug, kickoff, status, phase = 'POST') {
  const [m] = await sql`
    INSERT INTO matches (league_id, slug, home_team_id, away_team_id, kickoff_at, status, season_year, season_phase, stage)
    VALUES (${league}, ${`${TAG}-${slug}`}, ${home}, ${away}, ${kickoff}, ${status}, 2099, ${phase}, ${phase === 'POST' ? 'wild_card' : null})
    RETURNING id`;
  made.push(m.id); return m.id;
}
const setStatus = (id, status) => sql`UPDATE matches SET status = ${status} WHERE id = ${id}`;
const launcher = () => { const calls = []; return { calls, launch: async (day) => { calls.push(day); return { ok: true }; } }; };

before(async () => {
  [{ id: league }] = await sql`SELECT id FROM leagues WHERE slug = 'mlb' LIMIT 1`;
  const teams = await sql`SELECT id FROM teams WHERE league_id = ${league} ORDER BY id LIMIT 2`;
  [home, away] = teams.map((t) => t.id);
});
after(async () => {
  await sql`DELETE FROM matches WHERE id = ANY(${made}::int[])`;
  const [{ n }] = await sql`SELECT count(*)::int n FROM matches WHERE slug LIKE ${`${TAG}-%`}`;
  assert.equal(n, 0, 'the fixture tears itself down');
});

test('two games, one final and one live -> no fire; both final -> fire exactly once', async () => {
  // 2099-10-01 ET: an afternoon game and a night game (the night one ends after midnight UTC, same ET day).
  const a = await game('d1-a', '2099-10-01T18:00:00Z', 'final');
  const b = await game('d1-b', '2099-10-02T01:00:00Z', 'live');
  const { calls, launch } = launcher(); const fired = new Set();
  let r = await kickIfDayDone(sql, [a], { launch, fired });
  assert.deepEqual(r, [{ day: '2099-10-01', fired: false, reason: 'slate-not-done' }]);
  assert.equal(calls.length, 0);
  await setStatus(b, 'final');
  r = await kickIfDayDone(sql, [b], { launch, fired });
  assert.deepEqual(r, [{ day: '2099-10-01', fired: true, reason: 'kicked' }]);
  assert.deepEqual(calls, ['2099-10-01'], 'the ET day, not the UTC one');
  r = await kickIfDayDone(sql, [a, b], { launch, fired });
  assert.deepEqual(r, [{ day: '2099-10-01', fired: false, reason: 'already-kicked' }]);
  assert.equal(calls.length, 1, 'once');
});

test('a doubleheader day: game 1 final with game 2 still to play -> no fire; game 2 final -> fire', async () => {
  const g1 = await game('d2-g1', '2099-10-03T17:00:00Z', 'final');
  const g2 = await game('d2-g2', '2099-10-03T21:00:00Z', 'scheduled');
  const { calls, launch } = launcher(); const fired = new Set();
  assert.equal((await kickIfDayDone(sql, [g1], { launch, fired }))[0].reason, 'slate-not-done');
  await setStatus(g2, 'final');
  assert.equal((await kickIfDayDone(sql, [g2], { launch, fired }))[0].reason, 'kicked');
  assert.deepEqual(calls, ['2099-10-03']);
});

test('a postponed game does not hold the day open; a regular-season final never kicks', async () => {
  const f = await game('d3-final', '2099-10-05T18:00:00Z', 'final');
  await game('d3-ppd', '2099-10-05T22:00:00Z', 'postponed');
  const reg = await game('d4-reg', '2099-10-06T18:00:00Z', 'final', 'REG');
  const { calls, launch } = launcher(); const fired = new Set();
  assert.equal((await kickIfDayDone(sql, [f], { launch, fired }))[0].reason, 'kicked');
  assert.deepEqual(await kickIfDayDone(sql, [reg], { launch, fired }), [], 'not postseason: nothing to advance');
  assert.deepEqual(calls, ['2099-10-05']);
});

test('a failed kick is reported, not thrown (the 10:00Z timer is the net)', async () => {
  const f = await game('d5-final', '2099-10-07T18:00:00Z', 'final');
  const logs = [];
  const r = await kickIfDayDone(sql, [f], { launch: async () => { throw new Error('no user bus'); }, fired: new Set(), log: (l) => logs.push(l) });
  assert.deepEqual(r, [{ day: '2099-10-07', fired: false, reason: 'kick-failed' }]);
  assert.match(logs[0], /advance kick FAILED \(no user bus\) - the 10:00Z timer will run it/);
});
