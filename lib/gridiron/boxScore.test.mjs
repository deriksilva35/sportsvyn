// lib/gridiron/boxScore.test.mjs - the box score: the reader's grouping and
// sort on the NE-SEA fixture, the poller's cadence, the tab's gate, the sync's
// idempotence and the post-final sweep (DEV, synthetic matches torn down).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBoxScore, BOX_GROUPS } from './gameDetail.js';
import { statFieldsFromBdl, syncGameStats, sweepGameStats, fetchGameStats } from './gameStatsSync.js';
import { StatsTracker, STATS_EVERY_NTH_POLL } from '../live/statsCadence.js';
import { install } from '../testing/nextResolve.mjs';

const FIX = JSON.parse(readFileSync(new URL('./fixtures/bdl-stats-1392216.json', import.meta.url), 'utf8')).data;
const src = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const TEAM = { 1: 101, 31: 131 }; // BDL NE -> 101, SEA -> 131 for the pure test
const rowsFromFixture = () => FIX.map((s) => ({ ...statFieldsFromBdl(s, TEAM[s.team.id] ?? null), nfl_player_id: s.player.id, name: `${s.player.first_name} ${s.player.last_name}`, position: s.player.position_abbreviation }));

test('the reader: four groups per team from the NE-SEA fixture, sorted by yards, empty groups omitted', () => {
  const box = buildBoxScore(rowsFromFixture(), { away: { id: 101, abbreviation: 'NE' }, home: { id: 131, abbreviation: 'SEA' } });
  assert.equal(box.length, 2); assert.deepEqual(box.map((t) => t.abbr), ['NE', 'SEA']);
  for (const t of box) {
    const keys = t.groups.map((g) => g.key);
    assert.deepEqual(keys, BOX_GROUPS.map((g) => g.key).filter((k) => keys.includes(k)), `${t.abbr}: groups in the fixed order`);
    assert.ok(keys.includes('passing') && keys.includes('rushing') && keys.includes('receiving') && keys.includes('kicking'), `${t.abbr}: ${keys}`);
    for (const g of t.groups) {
      const y = g.rows.map((r) => (g.key === 'passing' ? r.cells[1] : g.key === 'rushing' ? r.cells[1] : g.key === 'receiving' ? r.cells[2] : Number(String(r.cells[0]).split('/')[0])));
      for (let i = 1; i < y.length; i++) assert.ok(y[i - 1] >= y[i], `${t.abbr} ${g.key} sorted desc: ${y}`);
      assert.ok(g.rows.every((r) => r.name && r.cells.length === g.headings.length));
    }
  }
  const ne = box.find((t) => t.abbr === 'NE');
  assert.equal(ne.groups.find((g) => g.key === 'passing').rows[0].name, 'Drake Maye', 'NE passing leader');
  assert.match(ne.groups.find((g) => g.key === 'passing').rows[0].cells[0], /^\d+\/\d+$/);
  assert.equal(ne.groups.find((g) => g.key === 'kicking').rows[0].name, 'Andy Borregales');
  // defenders never make a group; 60 fixture rows, far fewer lines
  const lines = box.flatMap((t) => t.groups.flatMap((g) => g.rows)).length; assert.ok(lines > 15 && lines < 60, `${lines} lines`);
  assert.equal(buildBoxScore([], {}), null); assert.equal(buildBoxScore(null, {}), null);
  assert.equal(buildBoxScore(rowsFromFixture().map((r) => ({ ...r, team_id: 999 })), { away: { id: 101 }, home: { id: 131 } }), null, 'rows for no team on the game -> no box');
});

test('the poller cadence: every 10th live poll per live game, once at final, never for a game it never saw live', () => {
  const t = new StatsTracker();
  assert.equal(STATS_EVERY_NTH_POLL, 10);
  const live = (polls) => t.due({ polls, matches: [{ id: 7, status: 'live' }, { id: 8, status: 'live' }] });
  for (let p = 1; p <= 9; p++) assert.deepEqual(live(p), [], `poll ${p}`);
  assert.deepEqual(live(10), [{ id: 7, why: 'live' }, { id: 8, why: 'live' }]);
  for (let p = 11; p <= 19; p++) assert.deepEqual(live(p), []);
  assert.deepEqual(live(20).map((d) => d.id), [7, 8]);
  assert.deepEqual(t.due({ polls: 21, matches: [{ id: 7, status: 'final' }, { id: 8, status: 'live' }] }), [{ id: 7, why: 'final' }]);
  assert.deepEqual(t.due({ polls: 22, matches: [{ id: 7, status: 'final' }, { id: 8, status: 'live' }] }), [], 'final pulled once');
  assert.deepEqual(t.due({ polls: 30, matches: [{ id: 7, status: 'final' }, { id: 8, status: 'live' }, { id: 9, status: 'final' }] }), [{ id: 8, why: 'live' }], 'a final never seen live is the sweep\'s, not the poller\'s');
  // a 3h game at 30 s polls: 360 polls -> 36 pulls? no: LIVE_SEC 30 means ~360 polls... the budget claim is per the cadence file
  const c = new StatsTracker(); let pulls = 0; for (let p = 1; p <= 36; p++) pulls += c.due({ polls: p, matches: [{ id: 1, status: 'live' }] }).length; pulls += c.due({ polls: 37, matches: [{ id: 1, status: 'final' }] }).length;
  assert.equal(pulls, 4, '36 live polls -> 3 pulls + 1 at final');
});

test('the tab: offered only when boxScore has rows, after DRIVES; the component renders nothing on empty', async () => {
  const page = src('app/nfl/game/[slug]/page.js');
  assert.match(page, /\{ key: 'drives', label: 'DRIVES' \} : null,\s*game\.boxScore\?\.length \? \{ key: 'boxscore', label: 'BOX SCORE' \} : null,/);
  assert.match(page, /boxscore: game\.boxScore\?\.length \? <BoxScore boxScore=\{game\.boxScore\} teams=\{teams\} \/> : null/);
  install();
  const React = (await import('react')).default; const { renderToStaticMarkup } = await import('react-dom/server');
  const { default: BoxScore } = await import('../../components/gridiron/BoxScore.js');
  assert.equal(renderToStaticMarkup(React.createElement(BoxScore, { boxScore: null, teams: [] })), '');
  assert.equal(renderToStaticMarkup(React.createElement(BoxScore, { boxScore: [], teams: [] })), '');
  const box = buildBoxScore(rowsFromFixture(), { away: { id: 101, abbreviation: 'NE' }, home: { id: 131, abbreviation: 'SEA' } });
  const html = renderToStaticMarkup(React.createElement(BoxScore, { boxScore: box, teams: [{ id: 101, colors: { primary: '#002244', secondary: '#C60C30' } }, { id: 131, colors: { primary: '#002244', secondary: '#69BE28' } }] }));
  assert.equal((html.match(/class="gg-boxhead"/g) ?? []).length, 2, 'one header row per team');
  assert.equal((html.match(/<svg class="gg-hm"/g) ?? []).length, 2, 'a helmet per team');
  assert.equal((html.match(/class="gg-ls gg-boxgrp"/g) ?? []).length, 8, 'four groups per team, the line-score grammar');
  assert.match(html, /<th class="t" scope="col">PASSING<\/th><th scope="col">C\/ATT<\/th>/);
  // the poller wiring is the closure change the merge must restart for
  const poller = src('services/live-poller/index.mjs');
  assert.match(poller, /import \{ StatsTracker \} from '\.\.\/\.\.\/lib\/live\/statsCadence\.js'/);
  assert.match(poller, /import \{ syncGameStats \} from '\.\.\/\.\.\/lib\/gridiron\/gameStatsSync\.js'/);
  assert.match(poller, /stats\.due\(\{ polls: window\.polls, matches: watched \}\)/);
  assert.match(poller, /statsCalls: statsCallsToday/, 'the heartbeat carries statsCalls');
  assert.match(poller, /const stats = lg\.slug === 'nfl' \? new StatsTracker\(\) : null/, 'NFL only');
  const route = src('app/api/cron/nfl-stats-sweep/route.js');
  assert.match(route, /await syncNflSeason\(\{ season, log: console\.log \}\);/, 'the Tuesday sweep stays'); assert.match(route, /sweepGameStats\(w\.week, \{ season/);
});

// ---- DEV: synthetic matches in the real nfl league, in a 1999 season no reader
// treats as current (the topic envelope reads the latest season); torn down
// (stats cascade) ----
let sql; let nflLeague; const made = [];
before(async () => { ({ sql } = await import('../db.js')); nflLeague = (await sql`SELECT id FROM leagues WHERE slug = 'nfl'`)[0].id; await sql`DELETE FROM matches WHERE league_id = ${nflLeague} AND season_year = 1999`; });
after(async () => { if (sql) await sql`DELETE FROM matches WHERE league_id = ${nflLeague} AND season_year = 1999`; });
const mk = async (slug, status, bdl) => { const [t1, t2] = await sql`SELECT id FROM teams WHERE league_id = ${nflLeague} AND abbreviation IN ('NE', 'SEA') ORDER BY abbreviation`; const r = await sql`
  INSERT INTO matches (league_id, slug, kickoff_at, status, home_team_id, away_team_id, season_year, season_phase, week, external_ids, metadata)
  VALUES (${nflLeague}, ${slug}, '1999-09-10T00:20:00Z', ${status}, ${t2.id}, ${t1.id}, 1999, 'REG', 1, ${JSON.stringify({ bdl_game_id: bdl })}::jsonb, '{}'::jsonb) RETURNING id`; made.push(r[0].id); return r[0].id; };
const fixtureFetcher = async () => ({ rows: FIX, calls: 1 });

test('syncGameStats is idempotent: the first run writes the lines, a rerun on the final game changes 0 rows', async () => {
  const id = await mk('boxtest-ne-sea', 'final', 'box-1392216');
  const a = await syncGameStats(id, { fetcher: fixtureFetcher });
  assert.equal(a.apiRows, 60); assert.ok(a.rows >= 55, `${a.rows} rows resolved to players`); assert.equal(a.changed, a.rows, 'every row new'); assert.equal(a.calls, 1);
  const b = await syncGameStats(id, { fetcher: fixtureFetcher });
  assert.equal(b.rows, a.rows); assert.equal(b.changed, 0, 'rerun changes nothing');
  const [{ n }] = await sql`SELECT count(*)::int n FROM nfl_player_game_stats WHERE match_id = ${id}`; assert.equal(n, a.rows);
  const { getGamePage } = await import('./gameDetail.js');
  const page = await getGamePage('boxtest-ne-sea');
  assert.ok(page.boxScore?.length === 2, 'the reader sees both teams'); assert.ok(page.boxScore[0].groups.some((g) => g.key === 'passing'));
});

test('sweepGameStats picks only finals with 0 rows: not the live game, not the one already filled', async () => {
  const filled = made[0]; // from the test above, has rows
  const empty = await mk('boxtest-empty-final', 'final', 'box-empty');
  const live = await mk('boxtest-live', 'live', 'box-live');
  const calls = [];
  const r = await sweepGameStats(1, { season: 1999, fetcher: async (bdl) => { calls.push(bdl); return { rows: FIX, calls: 1 }; } });
  assert.equal(r.candidates, 1); assert.deepEqual(r.synced.map((s) => s.matchId), [empty]); assert.deepEqual(calls, ['box-empty']);
  assert.ok(filled && live, 'fixtures exist');
  const again = await sweepGameStats(1, { season: 1999, fetcher: fixtureFetcher }); assert.equal(again.candidates, 0, 'nothing left to sweep');
});

test('fetchGameStats pages on the cursor and counts calls', async () => {
  const pages = [{ data: [1, 2], meta: { next_cursor: 'c2' } }, { data: [3], meta: {} }];
  let i = 0; const r = await fetchGameStats('x', { get: async () => pages[i++] });
  assert.deepEqual(r.rows, [1, 2, 3]); assert.equal(r.calls, 2);
});
