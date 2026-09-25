// services/live-poller/mlbBdl.test.mjs - the MLB cutover, COMPOSED: the real
// pollOnce with the real MLB normaliser, enrichment and detail hook, against
// DEV sentinels, with BDL answered by a stubbed fetch and statsapi answered by
// nothing at all - a call to it fails the test.
//
//   LIVE     /games row + /plate_appearances + /players  ->  live_state on the
//            row: the half, the outs, the runners, the count, the batter and
//            the pitcher - and the count is derived, not the provider's
//   PRE-KICK /lineups  ->  metadata.probables and metadata.lineups
//
// Everything is created and deleted here; the teardown verifies itself.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

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
for (const k of ['PUSH_ENABLED', 'APNS_KEY', 'APNS_KEY_PATH', 'APNS_KEY_ID', 'APNS_TEAM_ID']) delete process.env[k];

const { sql } = await import('../../lib/db.js');
const { pollOnce, fromMlb, mlbEnrich, mlbDetail, _resetMlbProbablesCache } = await import('./poll.mjs');
const { _resetNameCache } = await import('../../lib/mlb/bdlLive.js');

const NS = `sentinel-mlb-bdl-${process.pid}-${Date.now()}`;
const PID = { live: `${NS}-live`, pre: `${NS}-pre` };
const ids = {}; let away; let home;
const realFetch = globalThis.fetch; const seen = [];

const inning = (n, runs) => Array.from({ length: n }, (_, i) => (i === 0 ? runs : 0));
const gameRow = (pid, state, extra = {}) => ({
  id: pid, status_state: state, status: state === 'in_progress' ? 'STATUS_IN_PROGRESS' : 'STATUS_SCHEDULED', period: state === 'in_progress' ? 7 : 1,
  home_team_data: { runs: state === 'in_progress' ? 4 : null, hits: 7, errors: 0, inning_scores: state === 'in_progress' ? inning(6, 4) : [] },
  away_team_data: { runs: state === 'in_progress' ? 3 : null, hits: 6, errors: 1, inning_scores: state === 'in_progress' ? inning(7, 3) : [] },
  scoring_summary: [], postseason: false, season_type: 'regular', venue: 'Sentinel Park', ...extra,
});

before(async () => {
  const [lg] = await sql`SELECT id FROM leagues WHERE slug = 'mlb'`;
  const t = await sql`SELECT id, abbreviation FROM teams WHERE league_id = ${lg.id} AND abbreviation IS NOT NULL ORDER BY id LIMIT 2`;
  [away, home] = t;
  const mk = async (tag, status, kick) => (await sql`
    INSERT INTO matches (league_id, slug, status, home_team_id, away_team_id, kickoff_at, home_score, away_score, season_year, season_phase, external_ids, metadata)
    VALUES (${lg.id}, ${`${NS}-${tag}`}, ${status}, ${home.id}, ${away.id}, ${kick.toISOString()}, ${status === 'live' ? 4 : null}, ${status === 'live' ? 3 : null},
            2026, 'REG', ${JSON.stringify({ bdl_game_id: PID[tag] })}::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  ids.live = await mk('live', 'live', new Date(Date.now() - 2 * 3600e3));
  ids.pre = await mk('pre', 'scheduled', new Date(Date.now() + 2 * 3600e3));

  globalThis.fetch = async (url, opts) => {
    const u = String(url?.url ?? url);
    if (u.includes('statsapi')) { seen.push(u); throw new Error('statsapi must not be called'); }
    if (!u.includes('balldontlie.io')) return realFetch(url, opts);   // the database driver
    seen.push(u);
    if (u.includes('/plate_appearances')) return Response.json({ data: [
      { pa_number: 50, inning: 7, half_inning: 'top', outs: 1, runner_on_first: false, runner_on_second: false, runner_on_third: false,
        batter_id: 101, pitcher_id: 202, result: 'Single', pitches: [{ balls: 0, strikes: 0, pitch_call_code: 'hit_into_play' }] },
      { pa_number: 51, inning: 7, half_inning: 'top', outs: 1, runner_on_first: true, runner_on_second: false, runner_on_third: false,
        batter_id: 102, pitcher_id: 202, result: null,
        pitches: [{ balls: 0, strikes: 0, pitch_call_code: 'ball' }, { balls: 1, strikes: 0, pitch_call_code: 'swinging_strike' }] },
    ], meta: {} });
    if (u.includes('/players')) return Response.json({ data: [{ id: 102, full_name: 'Next Batter' }, { id: 202, full_name: 'Same Pitcher' }] });
    if (u.includes('/lineups')) return Response.json({ data: [
      { game_id: PID.pre, is_probable_pitcher: true, team: { abbreviation: away.abbreviation }, player: { id: 1, full_name: 'Away Starter' } },
      { game_id: PID.pre, is_probable_pitcher: true, team: { abbreviation: home.abbreviation }, player: { id: 2, full_name: 'Home Starter' } },
      { game_id: PID.pre, batting_order: 1, position: 'SS', team: { abbreviation: home.abbreviation }, player: { id: 3, full_name: 'Home Leadoff' } },
    ], meta: {} });
    return new Response('{}', { status: 404 });
  };
  _resetMlbProbablesCache(); _resetNameCache();
});

after(async () => {
  globalThis.fetch = realFetch;
  await sql`DELETE FROM matches WHERE id = ANY(${Object.values(ids)})`;
  const [left] = await sql`SELECT count(*)::int n FROM matches WHERE slug LIKE ${`${NS}%`}`;
  assert.equal(left.n, 0, 'the sentinels are gone');
});

const poll = () => pollOnce(sql, {
  league: 'mlb', providerKey: 'bdl_game_id', normalise: fromMlb, enrich: mlbEnrich, enrichScheduled: true,
  futureMinutes: 240, detail: mlbDetail, push: false, now: new Date(),
  fetcher: async () => ({ rows: [gameRow(PID.live, 'in_progress'), gameRow(PID.pre, 'scheduled')], calls: 1 }),
});

test('THE CUTOVER, through the real poller: live state and the pre-game card from BDL, statsapi never called', async () => {
  await poll();
  assert.equal(seen.some((u) => u.includes('statsapi')), false, 'no statsapi URL was requested');
  assert.equal(seen.some((u) => u.includes('/mlb/v1/plays')), false, 'the old first-page /plays read is gone');

  const [live] = await sql`SELECT home_score, away_score, metadata->'live_state' AS ls FROM matches WHERE id = ${ids.live}`;
  assert.equal(live.home_score, 4); assert.equal(live.away_score, 3);
  assert.deepEqual(live.ls, { period: 7, half: 'Top', outs: 1, balls: 1, strikes: 1,
    bases: { first: true, second: false, third: false }, batter: 'Next Batter', pitcher: 'Same Pitcher' },
  'the newest plate appearance, the count derived after the last pitch, the names looked up');

  const [pre] = await sql`SELECT metadata->'probables' AS p, metadata->'lineups' AS l FROM matches WHERE id = ${ids.pre}`;
  assert.deepEqual(pre.p, { away: { id: '1', name: 'Away Starter' }, home: { id: '2', name: 'Home Starter' } });
  assert.deepEqual(pre.l.home, [{ id: '3', name: 'Home Leadoff', position: 'SS', order: 1 }]);
  assert.equal(pre.l.away, null, 'an unposted side is null');
  assert.ok(pre.l.fetchedAt, 'the read is stamped, so lineupDue throttles');
});
