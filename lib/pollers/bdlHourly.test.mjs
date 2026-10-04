// lib/pollers/bdlHourly.test.mjs - RULING sun-10 item 3: the live poller's
// secondary-feed failure rows are capped at ONE per league per clock hour, the
// rest counted in that row.
//
// On DEV, under a per-pid test source, with explicit instants in an hour long
// past (2001) so no real row can share the window. The alert is a stub that
// counts attempts (kickoffGuard.test.mjs forbids reaching the mailer). Every
// row this file writes is its own source's; after() removes them and checks.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { sql } = await import('../db.js');
const { reportBdlErrors, foldHourSummary, clockHour } = await import('./bdlFailure.js');

const SOURCE = `test-bdlhourly-${process.pid}`;
const e401 = { status: 401, endpoint: '/ncaaf/v1/player_stats', message: 'm' };
const e401g = { status: 401, endpoint: '/ncaaf/v1/games', message: 'm' };
const e503 = { status: 503, endpoint: '/ncaaf/v1/player_stats', message: 'm' };
const at = (hh, mm, ss = 0) => new Date(Date.UTC(2001, 0, 1, hh, mm, ss));

after(async () => {
  await sql`DELETE FROM sync_runs WHERE source = ANY(${[SOURCE, `${SOURCE}-mlb`, `${SOURCE}-nba`]})`;
  const [left] = await sql`SELECT count(*)::int n FROM sync_runs WHERE source = ANY(${[SOURCE, `${SOURCE}-mlb`, `${SOURCE}-nba`]})`;
  assert.equal(left.n, 0, 'the test rows are gone');
});

test('clockHour and the fold are pure: totals by status and by endpoint, first/last instants', () => {
  assert.deepEqual(clockHour(at(10, 59, 59)).start, at(10, 0));
  assert.deepEqual(clockHour(at(10, 59, 59)).end, at(11, 0));
  let s = foldHourSummary(null, [e401, e401g], { at: at(10, 5) });
  s = foldHourSummary(s, [e401, e503], { at: at(10, 6) });
  assert.equal(s.ticks, 2);
  assert.deepEqual(s.byStatus, { 401: 3, 503: 1 });
  assert.deepEqual(s.byEndpoint, { '401 /ncaaf/v1/player_stats': 2, '401 /ncaaf/v1/games': 1, '503 /ncaaf/v1/player_stats': 1 });
  assert.equal(s.firstAt, at(10, 5).toISOString()); assert.equal(s.lastAt, at(10, 6).toISOString());
  assert.equal(s.hour, at(10, 0).toISOString());
  assert.deepEqual(s.bdlErrors.map((r) => `${r.status} ${r.endpoint} x${r.count}`),
    ['401 /ncaaf/v1/games x1', '401 /ncaaf/v1/player_stats x2', '503 /ncaaf/v1/player_stats x1']);
});

test('120 failing ticks in one hour are ONE row with the right counts; the next hour is a new row', async () => {
  const sent = [];
  const alert = async (_sql, a) => { sent.push(a); return { sent: false, stub: true }; };
  const ids = new Set();
  // Every 30 s from 10:00:00 to 10:59:30 - the poller's live cadence.
  for (let i = 0; i < 120; i += 1) {
    const errs = i % 10 === 9 ? [e401, e503] : [e401];
    const rep = await reportBdlErrors(sql, { source: SOURCE, bdlErrors: errs, context: 'league: cfb', alert, now: at(10, Math.floor(i / 2), (i % 2) * 30) });
    ids.add(rep.id);
    assert.equal(rep.folded, i > 0, `tick ${i}: ${i ? 'counted on' : 'opens'} the hour's row`);
  }
  assert.equal(ids.size, 1, 'one row for the hour');
  const rows = await sql`SELECT id, ok, kind, error, started_at, finished_at, summary FROM sync_runs WHERE source = ${SOURCE} ORDER BY id`;
  assert.equal(rows.length, 1);
  const [r] = rows;
  assert.equal(r.ok, false); assert.equal(r.kind, 'bdl-errors');
  assert.equal(r.summary.ticks, 120);
  assert.deepEqual(r.summary.byStatus, { 401: 120, 503: 12 });
  assert.deepEqual(r.summary.byEndpoint, { '401 /ncaaf/v1/player_stats': 120, '503 /ncaaf/v1/player_stats': 12 });
  assert.equal(r.summary.firstAt, at(10, 0).toISOString());
  assert.equal(r.summary.lastAt, at(10, 59, 30).toISOString());
  assert.equal(new Date(r.finished_at).toISOString(), at(10, 59, 30).toISOString(), 'finished_at is the last tick');
  assert.match(r.error, /401 \/ncaaf\/v1\/player_stats, 503 \/ncaaf\/v1\/player_stats$/, 'the row error names every status the hour saw');
  assert.equal(sent.length, 120, 'the alert is still attempted every tick - maybeAlert dedupes it by fingerprint, as before');

  // THE NEXT HOUR, a new row.
  const next = await reportBdlErrors(sql, { source: SOURCE, bdlErrors: [e401g], alert, now: at(11, 0, 0) });
  assert.equal(next.folded, false);
  assert.notEqual(next.id, [...ids][0]);
  const all = await sql`SELECT summary FROM sync_runs WHERE source = ${SOURCE} ORDER BY id`;
  assert.equal(all.length, 2);
  assert.equal(all[1].summary.ticks, 1);
  assert.deepEqual(all[1].summary.byEndpoint, { '401 /ncaaf/v1/games': 1 });
  assert.equal(all[0].summary.ticks, 120, 'the closed hour is untouched');
});

test('the cap is per SOURCE: another league (live-poller-<league>) in the same hour gets its own row', async () => {
  const alert = async () => ({ sent: false, stub: true });
  const a = await reportBdlErrors(sql, { source: `${SOURCE}-mlb`, bdlErrors: [e401], alert, now: at(12, 1) });
  const b = await reportBdlErrors(sql, { source: `${SOURCE}-nba`, bdlErrors: [e401], alert, now: at(12, 2) });
  assert.notEqual(a.id, b.id);
  assert.equal(a.folded, false); assert.equal(b.folded, false);
});
