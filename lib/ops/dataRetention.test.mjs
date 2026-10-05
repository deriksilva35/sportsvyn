// lib/ops/dataRetention.test.mjs - the retention job (sun-16 E).
//
// Pure: the cutoffs, which odds rows are anchors, which sync_runs rows a
// reader still needs, the batching loop's cap and budget (stub step and
// clock), the resume state, and the dry-run/apply gate.
// DEV DB: a sentinel match with a planted odds history and sentinel sync_runs
// sources; the job's own SQL is held to the pure rule row for row, and only
// the rows the rule names are deleted. Every query is scoped to the sentinel
// match / sources; the teardown asserts itself.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  retentionMode, retentionPlan, classifyOddsRows, syncRunVerdict, latestSyncRunIds, drain, oddsResume,
  matchUnits, runRetention, countOddsUnit, LEDGER_SOURCES, TIME_BUDGET_MS, ODDS_KEEP_DAYS, LOG_KEEP_DAYS,
  QUOTA_KEEP_DAYS, FLOOR_SLACK_DAYS,
} from './dataRetention.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const H = 3_600_000;
const D = 24 * H;

// ---------------------------------------------------------------------------
// the gate
// ---------------------------------------------------------------------------

test('APPLY only on RETENTION_APPLY=on exactly; everything else dry-runs', () => {
  assert.equal(retentionMode({ RETENTION_APPLY: 'on' }), 'apply');
  for (const v of [undefined, '', 'true', '1', 'ON', 'yes', ' on']) {
    assert.equal(retentionMode(v === undefined ? {} : { RETENTION_APPLY: v }), 'dry-run', `'${v}' must not delete`);
  }
});

test('a dry run never reaches a delete statement', async () => {
  const seen = [];
  const sql = { query: async (text) => { seen.push(text); return []; } };
  const s = await runRetention({ sql, mode: 'dry-run', onlyMatchIds: [1, 2], onlySources: ['x'] });
  assert.equal(s.mode, 'dry-run');
  assert.ok(seen.length >= 2, 'it counted');
  assert.deepEqual(seen.filter((t) => /\bDELETE\b/.test(t)), [], 'no DELETE was sent');
});

test('an apply run sends deletes for both tables', async () => {
  const seen = [];
  const sql = { query: async (text) => { seen.push(text); return []; } };
  const s = await runRetention({ sql, mode: 'apply', onlyMatchIds: [1], onlySources: ['x'] });
  assert.equal(s.mode, 'apply');
  assert.equal(seen.filter((t) => /DELETE FROM sync_runs/.test(t)).length, 1);
  assert.equal(seen.filter((t) => /DELETE FROM odds_markets/.test(t)).length, 1);
  assert.equal(s.odds.complete, true);
});

// ---------------------------------------------------------------------------
// the plan
// ---------------------------------------------------------------------------

test('cutoffs: odds 14 days, logs 30, quota 35', () => {
  const now = new Date('2026-10-04T09:43:00Z');
  const p = retentionPlan(now);
  assert.equal([ODDS_KEEP_DAYS, LOG_KEEP_DAYS, QUOTA_KEEP_DAYS].join(), '14,30,35');
  assert.equal(p.oddsCutoff.toISOString(), '2026-09-20T09:43:00.000Z');
  assert.equal(p.logCutoff.toISOString(), '2026-09-04T09:43:00.000Z');
  assert.equal(p.quotaCutoff.toISOString(), '2026-08-30T09:43:00.000Z');
});

// One match, kickoff 20 days ago; the selections the DB test plants too.
const NOW = new Date('2026-10-04T12:00:00Z');
const KO = new Date(NOW.getTime() - 20 * D);
const at = (ms) => new Date(KO.getTime() + ms).toISOString();
export function plantedOdds(matchId) {
  const A = { market_type: 'spread', fetcher_version: 'odds-api-v4', selection_label: 'Sentinel Home', selection_value: '-3' };
  const B = { ...A, selection_value: '-3.5' };
  const C = { market_type: 'match_winner', fetcher_version: null, selection_label: 'home', selection_value: null };
  const E = { market_type: 'total', fetcher_version: 'odds-api-v4', selection_label: 'Over', selection_value: '44.5' };
  const row = (tag, sel, t, verdict, cur = false) => ({ tag, match_id: matchId, market_scope: 'match', player_id: null, team_id: null,
    ...sel, fetched_at: t, is_current: cur, expect: verdict });
  return [
    row('A-open', A, at(-10 * D), 'open'),
    row('A-mid1', A, at(-9 * D), 'delete'),
    row('A-mid2', A, at(-5 * D), 'delete'),
    row('A-close', A, at(-1 * H), 'close'),
    row('A-postkick', A, at(+1 * H), 'delete'),
    row('A-recent', A, new Date(NOW.getTime() - 2 * D).toISOString(), 'recent'),
    row('A-current', A, new Date(NOW.getTime() - 1 * D).toISOString(), 'current', true),
    // the line moved to -3.5 for a while: its own open and close, its middle goes
    row('B-open', B, at(-4 * D), 'open'),
    row('B-mid', B, at(-3 * D), 'delete'),
    row('B-close', B, at(-2 * D), 'close'),
    // a market that left the board before kickoff: open, middle, and a close
    row('C-open', C, at(-6 * D), 'open'),
    row('C-mid', C, at(-5 * D), 'delete'),
    row('C-close', C, at(-4 * D), 'close'),
    // priced only after kickoff: open, middle, and the LAST price it carried
    row('E-open', E, at(+1 * H), 'open'),
    row('E-mid', E, at(+2 * H), 'delete'),
    row('E-last', E, at(+3 * H), 'last'),
  ].map((r, i) => ({ ...r, id: i + 1 }));
}

test('ANCHORS: open, close (last pre-kick) and last survive; is_current and the last 14 days survive; the middle goes', () => {
  const rows = plantedOdds(7);
  const v = classifyOddsRows(rows, { cutoff: retentionPlan(NOW).oddsCutoff, kickoffOf: () => KO });
  for (const r of rows) assert.equal(v.get(r.id), r.expect, r.tag);
});

test('an OLD is_current row is never deleted, however old - and, being the last pre-kick row, it IS the close', () => {
  const rows = [{ id: 1, match_id: 7, market_scope: 'match', market_type: 'h2h', selection_label: 'x', fetched_at: at(-100 * D), is_current: true },
    { id: 2, match_id: 7, market_scope: 'match', market_type: 'h2h', selection_label: 'x', fetched_at: at(-200 * D), is_current: false },
    { id: 3, match_id: 7, market_scope: 'match', market_type: 'h2h', selection_label: 'x', fetched_at: at(-150 * D), is_current: false }];
  const v = classifyOddsRows(rows, { cutoff: retentionPlan(NOW).oddsCutoff, kickoffOf: () => KO });
  assert.deepEqual([v.get(1), v.get(2), v.get(3)], ['current', 'open', 'delete']);
});

test('futures (no match, no kickoff) keep open and last, partitioned by league', () => {
  const f = (id, league, t) => ({ id, match_id: null, league_id: league, market_scope: 'futures', market_type: 'championship_winner',
    fetcher_version: 'odds-api-v4', team_id: 5, selection_label: 'KC', fetched_at: at(t), is_current: false });
  const rows = [f(1, 1, -30 * D), f(2, 1, -29 * D), f(3, 1, -28 * D), f(4, 2, -29 * D)];
  const v = classifyOddsRows(rows, { cutoff: retentionPlan(NOW).oddsCutoff });
  assert.deepEqual([1, 2, 3, 4].map((i) => v.get(i)), ['open', 'delete', 'last', 'open']);
});

test('sync_runs: ledgers and watchdog claims forever, latest per kind, quota 35 days, the rest 30', () => {
  const p = retentionPlan(NOW);
  const r = (id, source, kind, days, extra = {}) => ({ id, source, kind, ok: true, started_at: new Date(NOW.getTime() - days * D).toISOString(), summary: {}, ...extra });
  const rows = [
    r(1, 'welcome-email', 'send', 300), r(2, 'push', 'claim', 300), r(3, 'broadcast', 'send', 300),
    r(4, 'cron-watchdog', 'flag', 300),
    r(5, 'nfl-games', 'live-poll', 40), r(6, 'nfl-games', 'live-poll', 1),
    r(7, 'nfl-games', 'season-sync', 60), // the newest of its kind: kept
    r(8, 'live-poller-nfl', 'quota:2026-08-31', 33), r(9, 'live-poller-nfl', 'quota:2026-08-28', 36), r(10, 'live-poller-nfl', 'quota:2026-10-03', 1),
    r(11, 'nfl-odds', 'baseline', 33), r(12, 'cfb-games', 'baseline', 33, { summary: { budget: { cfbd_calllimit_remaining: '900' } } }),
    r(18, 'nfl-odds', 'baseline', 1), r(19, 'cfb-games', 'baseline', 1),
    r(13, 'stuck-live', 'sweep', 33), r(14, 'stuck-live', 'sweep', 2),
    r(15, 'power-edition', 'publish', 60, { summary: { summary: { league: 'cfb' } } }),
    r(16, 'power-edition', 'publish', 50, { summary: { summary: { league: 'nfl' } } }),
    r(17, 'power-edition', 'publish', 40, { summary: { summary: { league: 'nfl' } } }),
  ];
  const latest = latestSyncRunIds(rows);
  const v = Object.fromEntries(rows.map((x) => [x.id, syncRunVerdict(x, { ...p, latestIds: latest })]));
  assert.deepEqual(v, {
    1: 'ledger', 2: 'ledger', 3: 'ledger', 4: 'watchdog',
    5: 'delete', 6: 'recent', 7: 'latest',
    8: 'quota', 9: 'delete', 10: 'recent', // 'quota:<day>' is ONE kind: day 36 is not "the newest of its kind"
    11: 'quota', 12: 'quota', 13: 'delete', 14: 'recent',
    15: 'latest', 16: 'delete', 17: 'latest', // each league keeps its own last publish
    18: 'recent', 19: 'recent',
  });
  for (const s of ['welcome-email', 'welcome-sheet', 'push', 'broadcast', 'data-retention']) assert.ok(LEDGER_SOURCES.includes(s), s);
});

// ---------------------------------------------------------------------------
// the loop
// ---------------------------------------------------------------------------

test('drain: batches until a short statement, unit by unit', async () => {
  const left = new Map([['a', 45], ['b', 0], ['c', 20]]);
  const calls = [];
  const step = async (u, limit) => { calls.push([u, limit]); const n = Math.min(limit, left.get(u)); left.set(u, left.get(u) - n); return n; };
  const r = await drain(['a', 'b', 'c'], step, { batchRows: 20, maxRows: 1000, budgetMs: 1e9 });
  assert.equal(r.stoppedBy, 'done');
  assert.equal(r.rows, 65);
  assert.deepEqual(r.perUnit, [45, 0, 20]);
  // c holds exactly one batch, so it takes a second, empty statement to know it is done
  assert.deepEqual(calls.map(([u]) => u).join(''), 'aaabcc');
  assert.equal(r.statements, 6);
});

test('drain: the run cap shortens the last statement and stops', async () => {
  const step = async (_u, limit) => limit;
  const r = await drain(['a'], step, { batchRows: 20, maxRows: 50, budgetMs: 1e9 });
  assert.equal(r.rows, 50);
  assert.equal(r.stoppedBy, 'cap');
  assert.equal(r.unitsDone, 0);
  assert.equal(r.statements, 3, '20 + 20 + 10');
});

test('drain: the time budget stops BEFORE the next statement', async () => {
  let t = 0;
  const step = async (_u, limit) => { t += 100; return limit; };
  const r = await drain(['a'], step, { batchRows: 5, maxRows: 1e9, budgetMs: 250, clock: () => t });
  assert.equal(r.stoppedBy, 'budget');
  assert.equal(r.statements, 3, 'started at 0, 100, 200; not at 300');
});

test('the budget sits under the route maxDuration with room for one statement', () => {
  const s = readFileSync(path.join(REPO, 'app/api/cron/data-retention/route.js'), 'utf8');
  const max = Number(/export const maxDuration = (\d+)/.exec(s)[1]) * 1000;
  assert.ok(TIME_BUDGET_MS <= max - 45_000, `${TIME_BUDGET_MS} vs maxDuration ${max}`);
});

test('resume: no apply yet -> whole table; a completed pass -> floor behind the pass START; a stopped pass -> its cursor', () => {
  assert.deepEqual(oddsResume(null), { floor: null, after: null, passCutoff: null });
  const done = oddsResume({ odds: { complete: true, cutoff: '2026-09-25T00:00:00.000Z', passCutoff: '2026-09-20T00:00:00.000Z' } });
  assert.equal(done.floor, new Date(Date.parse('2026-09-20T00:00:00Z') - FLOOR_SLACK_DAYS * D).toISOString());
  assert.equal(done.after, null);
  const stopped = oddsResume({ odds: { complete: false, cutoff: '2026-09-21T00:00:00.000Z', floor: null, cursor: 812 } });
  assert.deepEqual(stopped, { floor: null, after: 812, passCutoff: '2026-09-21T00:00:00.000Z' });
});

test('matchUnits chunks ids in order', () => {
  assert.deepEqual(matchUnits([1, 2, 3, 4, 5], 2).map((u) => u.ids), [[1, 2], [3, 4], [5]]);
});

// ---------------------------------------------------------------------------
// DEV DB: a sentinel match and sentinel sync_runs sources
// ---------------------------------------------------------------------------

const HAS_DB = Boolean(process.env.DATABASE_URL);
const REFUSE = HAS_DB && process.env.PROD_DATABASE_URL && process.env.DATABASE_URL === process.env.PROD_DATABASE_URL;
const TAG = `sentinel-retention-${process.pid}`;
const SOURCES = [`${TAG}-a`, `${TAG}-b`];
let sql;
let matchId;
let idByTag = new Map();
const DB_NOW = new Date();

before(async () => {
  if (!HAS_DB || REFUSE) return;
  ({ sql } = await import('../db.js'));
  const [lg] = await sql`SELECT id FROM leagues WHERE slug = 'nfl'`;
  const teams = await sql`SELECT id FROM teams WHERE league_id = ${lg.id} ORDER BY id LIMIT 2`;
  // Kickoff 20 days before the REAL now - the fixture is relative to now, never a dated cheque.
  const ko = new Date(DB_NOW.getTime() - 20 * D);
  const [m] = await sql`
    INSERT INTO matches (league_id, slug, status, home_team_id, away_team_id, kickoff_at, season_year, season_phase, week, external_ids)
    VALUES (${lg.id}, ${TAG}, 'final', ${teams[0].id}, ${teams[1].id}, ${ko.toISOString()}, 2026, 'REG', 99,
            ${JSON.stringify({ sentinel: TAG })}::jsonb)
    RETURNING id`;
  matchId = m.id;
  const shift = DB_NOW.getTime() - NOW.getTime();
  const rows = plantedOdds(matchId).map((r) => ({ ...r, fetched_at: new Date(Date.parse(r.fetched_at) + shift).toISOString() }));
  const ins = await sql`
    INSERT INTO odds_markets (market_scope, market_type, match_id, selection_label, selection_value, american_odds,
                              implied_probability, is_current, fetched_at, fetcher_version, consensus_method)
    SELECT 'match', r.market_type, ${matchId}, r.selection_label, r.selection_value, -110, 52.38, r.is_current, r.fetched_at,
           r.fetcher_version, 'median'
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r(market_type text, selection_label text, selection_value text,
           is_current boolean, fetched_at timestamptz, fetcher_version text, tag text)
    RETURNING id, fetched_at, market_type, selection_label, selection_value`;
  // map back by the unique (type, label, value, fetched_at)
  const k = (r) => `${r.market_type}|${r.selection_label}|${r.selection_value}|${new Date(r.fetched_at).getTime()}`;
  const byKey = new Map(ins.map((r) => [k(r), r.id]));
  idByTag = new Map(rows.map((r) => [r.tag, byKey.get(k(r))]));
  assert.equal(idByTag.size, 16);
  assert.ok([...idByTag.values()].every(Boolean), 'every planted row came back');
  // sync_runs: an old run, a newer old run, and a recent one per source; the
  // newest of source b's 'seasonal' kind is old but must survive.
  await sql`
    INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, summary) VALUES
      (${SOURCES[0]}, 'tick', now() - interval '40 days', now() - interval '40 days', true, '{}'::jsonb),
      (${SOURCES[0]}, 'tick', now() - interval '39 days', now() - interval '39 days', true, '{}'::jsonb),
      (${SOURCES[0]}, 'tick', now() - interval '1 day', now() - interval '1 day', true, '{}'::jsonb),
      (${SOURCES[1]}, 'seasonal', now() - interval '100 days', now() - interval '100 days', true, '{}'::jsonb),
      (${SOURCES[1]}, 'seasonal', now() - interval '90 days', now() - interval '90 days', true, '{}'::jsonb)`;
});

after(async () => {
  if (!sql) return;
  if (matchId) await sql`DELETE FROM matches WHERE id = ${matchId}`; // odds_markets cascades
  await sql`DELETE FROM sync_runs WHERE source = ANY(${SOURCES})`;
  // THE TEARDOWN ASSERTS ITSELF.
  const [{ n }] = await sql`
    SELECT ((SELECT count(*) FROM matches WHERE slug = ${TAG})
          + (SELECT count(*) FROM odds_markets WHERE match_id = ${matchId ?? -1})
          + (SELECT count(*) FROM sync_runs WHERE source = ANY(${SOURCES})))::int AS n`;
  assert.equal(n, 0, 'data-retention test left rows behind on DEV');
});

const dbSkip = { skip: !HAS_DB || REFUSE ? 'no DEV database' : false };

test('DEV: the job\'s SQL gives every planted row the verdict the pure rule gives it', dbSkip, async () => {
  const cutoff = retentionPlan(DB_NOW).oddsCutoff;
  const counts = await countOddsUnit(sql, { kind: 'matches', ids: [matchId] }, { cutoff });
  const got = Object.fromEntries(counts.map((c) => [c.verdict, c.n]));
  const want = {};
  for (const r of plantedOdds(0)) want[r.expect] = (want[r.expect] ?? 0) + 1;
  assert.deepEqual(got, want);
});

test('DEV: apply deletes exactly the middle rows, in small batches, and the old run logs - nothing else', dbSkip, async () => {
  const s = await runRetention({ sql, mode: 'apply', now: DB_NOW, onlyMatchIds: [matchId], onlySources: SOURCES, batchRows: 2 });
  assert.equal(s.odds.deleted, 6);
  assert.equal(s.odds.statements, 4, '2 + 2 + 2 + an empty one');
  assert.equal(s.odds.complete, true);
  assert.equal(s.syncRuns.deleted, 3, "a's two old ticks and b's older seasonal");

  const left = new Set((await sql`SELECT id FROM odds_markets WHERE match_id = ${matchId}`).map((r) => r.id));
  for (const r of plantedOdds(0)) {
    assert.equal(left.has(idByTag.get(r.tag)), r.expect !== 'delete', `${r.tag} (${r.expect})`);
  }
  const runs = await sql`SELECT source, kind, (now() - started_at) < interval '2 days' AS recent FROM sync_runs WHERE source = ANY(${SOURCES}) ORDER BY source, started_at`;
  assert.deepEqual(runs.map((r) => `${r.source.slice(-1)}:${r.kind}:${r.recent}`), ['a:tick:true', 'b:seasonal:false']);

  // a second pass finds nothing
  const again = await runRetention({ sql, mode: 'apply', now: DB_NOW, onlyMatchIds: [matchId], onlySources: SOURCES, batchRows: 2 });
  assert.equal(again.odds.deleted + again.syncRuns.deleted, 0);
});
