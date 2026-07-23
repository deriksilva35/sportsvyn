// Integration tests against the DEV DB: liveWindow (incl. postponed exclusion),
// runRecorder, advisory lock skip, and the alert rate limit. Loads .env.local
// (repo convention), dynamic-imports after. All rows use 'polltest-' markers and
// are cleaned up.
import { test, before, beforeEach, after } from 'node:test';
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

const neonmod = await import('@neondatabase/serverless');
const { neon, Client, neonConfig } = neonmod;
if (!neonConfig.webSocketConstructor && typeof WebSocket !== 'undefined') neonConfig.webSocketConstructor = WebSocket;
const sql = neon(process.env.DATABASE_URL);

const { isLiveWindow } = await import('./liveWindow.js');
const { recordRun, recordDecision, lastGamesRunAt } = await import('./runRecorder.js');
const { withAdvisoryLock, lockKey, directConnectionString } = await import('./lock.js');
const { maybeAlert } = await import('./alerts.js');

const NFL = 'polltest-nfl-league';
let nflLeagueId, teamA, teamB;

async function cleanup() {
  await sql`DELETE FROM matches WHERE slug LIKE ${'polltest-%'}`;
  await sql`DELETE FROM sync_runs WHERE source LIKE ${'polltest-%'}`;
}

before(async () => {
  nflLeagueId = (await sql`SELECT id FROM leagues WHERE slug = ${'nfl'} LIMIT 1`)[0]?.id;
  const teams = await sql`SELECT id FROM teams WHERE league_id = ${nflLeagueId} LIMIT 2`;
  teamA = teams[0]?.id; teamB = teams[1]?.id;
  await cleanup();
});
after(cleanup);

async function insertMatch({ minsFromNow, status, tag }) {
  const ko = new Date(Date.now() + minsFromNow * 60000).toISOString();
  await sql`INSERT INTO matches (league_id, slug, status, kickoff_at, home_team_id, away_team_id, season_year, season_phase, week)
            VALUES (${nflLeagueId}, ${`polltest-${tag}`}, ${status}, ${ko}, ${teamA}, ${teamB}, 2026, 'REG', 1)`;
}

test('liveWindow: a game in progress (kickoff 90min ago, not final) -> true', async () => {
  await cleanup();
  await insertMatch({ minsFromNow: -90, status: 'live', tag: 'inprogress' });
  assert.equal(await isLiveWindow(sql, nflLeagueId), true);
});

test('liveWindow: a game 30min before kickoff (within 45min pre) -> true', async () => {
  await cleanup();
  await insertMatch({ minsFromNow: 30, status: 'scheduled', tag: 'soon' });
  assert.equal(await isLiveWindow(sql, nflLeagueId), true);
});

test('liveWindow: postponed game in the window is excluded -> false', async () => {
  await cleanup();
  await insertMatch({ minsFromNow: -60, status: 'postponed', tag: 'ppd' });
  assert.equal(await isLiveWindow(sql, nflLeagueId), false);
});

test('liveWindow: game 6h past kickoff (beyond 5h post) -> false', async () => {
  await cleanup();
  await insertMatch({ minsFromNow: -360, status: 'live', tag: 'old' });
  assert.equal(await isLiveWindow(sql, nflLeagueId), false);
});

test('recordRun: success writes ok + summary; lastGamesRunAt finds it', async () => {
  const res = await recordRun(sql, { source: 'polltest-src', kind: 'live-poll', log: () => {}, run: async () => ({ ingested: 7 }) });
  assert.equal(res.ok, true);
  const row = (await sql`SELECT ok, summary FROM sync_runs WHERE id = ${res.id}`)[0];
  assert.equal(row.ok, true);
  assert.equal(row.summary.ingested, 7);
  const last = await lastGamesRunAt(sql, 'polltest-src');
  assert.ok(last != null);
});

test('recordRun: a thrown error is captured (ok=false, error set)', async () => {
  const res = await recordRun(sql, { source: 'polltest-src', kind: 'baseline', log: () => {}, run: async () => { throw new Error('boom-xyz'); } });
  assert.equal(res.ok, false);
  const row = (await sql`SELECT ok, error FROM sync_runs WHERE id = ${res.id}`)[0];
  assert.equal(row.ok, false);
  assert.match(row.error, /boom-xyz/);
});

test('recordDecision: writes a bare row', async () => {
  const id = await recordDecision(sql, { source: 'polltest-src', kind: 'noop', summary: { season: 2026 } });
  const row = (await sql`SELECT kind FROM sync_runs WHERE id = ${id}`)[0];
  assert.equal(row.kind, 'noop');
});

test('withAdvisoryLock: skips when the lock is already held', async () => {
  const source = 'polltest-lock';
  const holder = new Client(directConnectionString(process.env.DATABASE_URL));
  await holder.connect();
  try {
    const got = (await holder.query('SELECT pg_try_advisory_lock($1) AS ok', [lockKey(source)])).rows[0].ok;
    assert.equal(got, true, 'holder acquired the lock');
    let ran = false;
    const outcome = await withAdvisoryLock(source, async () => { ran = true; });
    assert.equal(outcome.locked, true, 'second attempt sees it locked');
    assert.equal(ran, false, 'fn did not run while locked');
  } finally {
    await holder.query('SELECT pg_advisory_unlock($1)', [lockKey(source)]);
    await holder.end();
  }
});

test('withAdvisoryLock: runs fn when free', async () => {
  let ran = false;
  const outcome = await withAdvisoryLock('polltest-lock-free', async () => { ran = true; return 42; });
  assert.equal(outcome.locked, false);
  assert.equal(ran, true);
  assert.equal(outcome.result, 42);
});

test('maybeAlert: rate-limited when a recent alert marker exists (no send)', async () => {
  const source = 'polltest-alert';
  await sql`INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, summary)
            VALUES (${source}, 'alert', now(), now(), true, ${JSON.stringify({ subject: 'seed' })}::jsonb)`;
  const r = await maybeAlert(sql, { source, subject: 'x', body: 'y' });
  assert.equal(r.sent, false);
  assert.equal(r.reason, 'rate_limited');
});
