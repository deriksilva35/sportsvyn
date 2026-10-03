// services/live-poller/bdlErrors.test.mjs - RULING sun-6 item 1 on the MLB
// overlay, through the REAL pollOnce: two live games on DEV sentinels, the
// feed answering 401 for one game's plate appearances.
//
// mlbEnrich catches that per game and logs it - "NEVER THROWS", by design, so
// the score still lands. Before the ruling the tick was therefore a success in
// every ledger. Now the tick runs inside withBdlErrors exactly as
// services/live-poller/index.mjs runs it, the 401 is collected, and
// reportBdlErrors writes the tick FAILED and alerts under the poller's source.
// The healthy sibling's live state is still written.
//
// The alert is a stub (kickoffGuard.test.mjs forbids reaching the mailer). The
// sentinels and the ledger row are removed in after(), which checks itself.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

for (const k of ['PUSH_ENABLED', 'APNS_KEY', 'APNS_KEY_PATH', 'APNS_KEY_ID', 'APNS_TEAM_ID']) delete process.env[k];

const { sql } = await import('../../lib/db.js');
const { pollOnce, fromMlb, mlbEnrich, mlbDetail, mlbKickoff, _resetMlbProbablesCache } = await import('./poll.mjs');
const { _resetNameCache } = await import('../../lib/mlb/bdlLive.js');
const { withBdlErrors } = await import('../../lib/bdl/http.js');
const { reportBdlErrors } = await import('../../lib/pollers/bdlFailure.js');

const NS = `sentinel-bdlerr-mlb-${process.pid}`;
const SOURCE = `test-bdlerr-mlb-${process.pid}`;
const PID = { bad: `${NS}-bad`, good: `${NS}-good` };
const ids = {};
const KICK = new Date(Date.now() - 2 * 3600e3);
const realFetch = globalThis.fetch;

const gameRow = (pid) => ({
  id: pid, status_state: 'in_progress', status: 'STATUS_IN_PROGRESS', period: 7, date: KICK.toISOString(),
  home_team_data: { runs: 4, hits: 7, errors: 0, inning_scores: [4, 0, 0, 0, 0, 0] },
  away_team_data: { runs: 3, hits: 6, errors: 1, inning_scores: [3, 0, 0, 0, 0, 0, 0] },
  scoring_summary: [], postseason: false, season_type: 'regular', venue: 'Sentinel Park',
});

async function sweep() {
  await sql`DELETE FROM matches WHERE slug LIKE 'sentinel-bdlerr-mlb-%'`;
  await sql`DELETE FROM sync_runs WHERE source LIKE 'test-bdlerr-mlb-%'`;
}

before(async () => {
  await sweep();
  const [lg] = await sql`SELECT id FROM leagues WHERE slug = 'mlb'`;
  const t = await sql`SELECT id FROM teams WHERE league_id = ${lg.id} AND abbreviation IS NOT NULL ORDER BY id LIMIT 4`;
  const mk = async (tag, home, away) => (await sql`
    INSERT INTO matches (league_id, slug, status, home_team_id, away_team_id, kickoff_at, home_score, away_score, season_year, season_phase, external_ids, metadata)
    VALUES (${lg.id}, ${`${NS}-${tag}`}, 'live', ${home}, ${away}, ${KICK.toISOString()}, 4, 3, 2026, 'REG',
            ${JSON.stringify({ bdl_game_id: PID[tag] })}::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  ids.bad = await mk('bad', t[0].id, t[1].id);
  ids.good = await mk('good', t[2].id, t[3].id);

  globalThis.fetch = async (url, opts) => {
    const u = String(url?.url ?? url);
    if (!/^https:\/\/api\.balldontlie\.io\//.test(u)) return realFetch(url, opts);   // the database driver
    if (u.includes('/plate_appearances') && u.includes(encodeURIComponent(PID.bad))) {
      return new Response('{"error":"Unauthorized"}', { status: 401 });
    }
    if (u.includes('/plate_appearances')) return Response.json({ data: [
      { pa_number: 51, inning: 7, half_inning: 'top', outs: 2, runner_on_first: false, runner_on_second: true, runner_on_third: false,
        batter_id: 102, pitcher_id: 202, result: null, pitches: [{ balls: 0, strikes: 0, pitch_call_code: 'ball' }] },
    ], meta: {} });
    if (u.includes('/players')) return Response.json({ data: [{ id: 102, full_name: 'Next Batter' }, { id: 202, full_name: 'Same Pitcher' }] });
    return Response.json({ data: [], meta: {} });
  };
  _resetMlbProbablesCache(); _resetNameCache();
});

after(async () => {
  globalThis.fetch = realFetch;
  await sweep();
  const [left] = await sql`
    SELECT (SELECT count(*)::int FROM matches WHERE slug LIKE ${`${NS}%`})
         + (SELECT count(*)::int FROM sync_runs WHERE source = ${SOURCE}) AS n`;
  assert.equal(left.n, 0, 'the sentinels and the ledger row are gone');
});

test('MLB: one game\'s plate appearances 401 - the tick is FAILED and alerted, the other game\'s live state is written', async () => {
  // THE POLLER'S SHAPE (index.mjs): the poll inside withBdlErrors.
  const { value: r, bdlErrors } = await withBdlErrors(() => pollOnce(sql, {
    league: 'mlb', providerKey: 'bdl_game_id', normalise: fromMlb, enrich: mlbEnrich, enrichScheduled: true,
    futureMinutes: 240, detail: mlbDetail, kickoffOf: mlbKickoff, push: false, now: new Date(),
    fetcher: async () => ({ rows: [gameRow(PID.bad), gameRow(PID.good)], calls: 1 }),
  }));
  assert.ok(r, 'the poll itself completed - the 401 was contained per game');
  assert.deepEqual(bdlErrors.map((e) => `${e.status} ${e.endpoint}`), ['401 /mlb/v1/plate_appearances'],
    'the contained 401 was collected all the same');

  const [good] = await sql`SELECT metadata->'live_state' AS ls FROM matches WHERE id = ${ids.good}`;
  assert.equal(good.ls?.outs, 2, 'the healthy sibling was written');
  assert.equal(good.ls?.batter, 'Next Batter');
  const [bad] = await sql`SELECT status, home_score, metadata->'live_state' AS ls FROM matches WHERE id = ${ids.bad}`;
  assert.equal(bad.status, 'live'); assert.equal(bad.home_score, 4, 'the failed game still has its score');
  assert.ok(bad.ls?.outs == null, 'and no at-bat it could not read');

  const sent = [];
  const alert = async (_sql, a) => { sent.push(a); return { sent: false, stub: true }; };
  const rep = await reportBdlErrors(sql, { source: SOURCE, kind: 'bdl-errors', bdlErrors, context: 'league: mlb', alert });
  const [row] = await sql`SELECT ok, kind, error, summary FROM sync_runs WHERE id = ${rep.id}`;
  assert.equal(row.ok, false, 'the tick is on the ledger as FAILED');
  assert.equal(row.kind, 'bdl-errors');
  assert.match(row.error, /401 \/mlb\/v1\/plate_appearances/);
  assert.equal(row.summary.bdlErrors[0].count, 1);
  assert.equal(sent.length, 1, 'an alert was attempted');
  assert.equal(sent[0].source, SOURCE);
  assert.match(sent[0].body, /league: mlb\n\n.*401 \/mlb\/v1\/plate_appearances/);
});
