// lib/draft/lockBridge.test.mjs - the Draft's rosters are stored at lock.
//
// WHICH CONTESTS: locked and unsettled Draft contests only - never one still open
// for drafting, never one already settled, never another game. Sentinel contests
// on DEV under a sentinel sport, the bridge injected, so the SELECTION is what is
// under test (bridgeContestRosters itself is proven by lib/weekly/replay.test.mjs).

import { test, before, after } from 'node:test';
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
const { bridgeLockedDrafts, freezeOpenDraftBoards } = await import('./lockBridge.js');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const SPORT = `sentinel-lock-${process.pid}`.slice(0, 40);
const ids = {};

before(async () => {
  const mk = async (type, week, lockedHoursAgo, settled) => (await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settled, meta)
    VALUES (${type}, ${SPORT}, 1999, ${week}, '[]'::jsonb, now() - interval '7 days',
            now() - make_interval(hours => ${lockedHoursAgo}), ${settled}, '{}'::jsonb) RETURNING id`)[0].id;
  ids.locked = await mk('draft', 1, 2, false);
  ids.open = await mk('draft', 2, -24, false);
  ids.settled = await mk('draft', 3, 48, true);
  ids.weekly = await mk('weekly', 1, 2, false);
  ids.open2 = await mk('draft', 4, -24, false);
  ids.future = (await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settled, meta)
    VALUES ('draft', ${SPORT}, 1999, 5, '[]'::jsonb, now() + interval '1 day',
            now() + interval '3 days', false, '{}'::jsonb) RETURNING id`)[0].id;
  // open2 already has its board - it must not be frozen twice.
  await sql`INSERT INTO draft_contest_boards (contest_id, computed_at, label, rows)
            VALUES (${ids.open2}, now(), 'sentinel', '[{"ffcPlayerId":"x"}]'::jsonb)`;
});
after(async () => {
  await sql`DELETE FROM contests WHERE sport = ${SPORT}`;
  const [l] = await sql`SELECT count(*)::int n FROM contests WHERE sport = ${SPORT}`;
  assert.equal(l.n, 0, 'the sentinels are gone');
});

test('only a LOCKED, UNSETTLED Draft contest is bridged', async () => {
  const called = [];
  const r = await bridgeLockedDrafts({ sport: SPORT, bridge: async (id) => { called.push(id); return { bridged: 0 }; } });
  assert.deepEqual(called, [ids.locked]);
  assert.equal(r.contests, 1);
});

test('a failing contest is reported, not thrown - the next one still runs', async () => {
  const r = await bridgeLockedDrafts({ sport: SPORT, bridge: async () => { throw new Error('boom'); } });
  assert.deepEqual(r.results, [{ contestId: ids.locked, error: 'boom' }]);
});

test('the cron is registered hourly and calls the lock bridge', () => {
  const v = JSON.parse(src('vercel.json'));
  assert.equal(v.crons.find((c) => c.path === '/api/cron/draft-bridge')?.schedule, '45 * * * *');
  const r = src('app/api/cron/draft-bridge/route.js');
  assert.match(r, /cronAuthorized\(request\)/);
  assert.match(r, /bridgeLockedDrafts\(\{ now \}\)/);
  assert.match(r, /freezeOpenDraftBoards\(\{ now \}\)/, 'and freezes the open week\'s board (sat-6)');
});

// ---- THE WEEK'S BOARD IS FROZEN AT opens_at (ruling sat-6) ----------------
test('only an OPEN Draft contest with NO board is frozen - not a future one, not a locked one, not one already frozen', async () => {
  const called = [];
  const r = await freezeOpenDraftBoards({ sport: SPORT, freeze: async (id) => { called.push(id); return { ok: true }; } });
  assert.deepEqual(called, [ids.open]);
  assert.equal(r.contests, 1);
});

test('a failing board freeze is reported, not thrown', async () => {
  const r = await freezeOpenDraftBoards({ sport: SPORT, freeze: async () => { throw new Error('no board'); } });
  assert.deepEqual(r.results, [{ contestId: ids.open, error: 'no board' }]);
});
