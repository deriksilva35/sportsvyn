// lib/nba/pageFeed.test.mjs - the NBA page's feed reads: cached, keyed, timed out (thu1-nba-page).
// fetchImpl is injected; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bdlPageRead, readInjuries, readLineups, readRoster, readSeasonAverages, readOdds, readStandings, readTeamGames, TTL } from './pageFeed.js';

const KEY = 'test-key-no-network';
const reply = (json, headers = {}) => ({ ok: true, status: 200, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => json });
function spy(answer) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return typeof answer === 'function' ? answer(url, init) : answer; };
  return { calls, fetchImpl };
}

test('every read carries the key, Next\'s revalidate and a timeout signal', async () => {
  const { calls, fetchImpl } = spy(reply({ data: [] }));
  await readInjuries([2, 9], { fetchImpl, key: KEY });
  const c = calls[0];
  assert.match(c.url, /\/nba\/v1\/player_injuries\?team_ids\[\]=2&team_ids\[\]=9&per_page=100$/);
  assert.equal(c.init.headers.Authorization, KEY);
  assert.deepEqual(c.init.next, { revalidate: TTL.short });
  assert.ok(c.init.signal instanceof AbortSignal);
});

test('ttls: injuries / odds / pre lineups 10 min, a live game\'s lineups 1 min, averages / standings / rosters / games 1 h', async () => {
  const { calls, fetchImpl } = spy(reply({ data: [] }));
  const o = { fetchImpl, key: KEY };
  await readInjuries([1], o); await readOdds(5, o); await readLineups(5, o); await readLineups(5, { ...o, live: true });
  await readSeasonAverages(2026, [1, 2], o); await readStandings(2026, o); await readRoster(1, o); await readTeamGames(1, 2026, o);
  assert.deepEqual(calls.map((c) => c.init.next.revalidate), [600, 600, 600, 60, 3600, 3600, 3600, 3600]);
  assert.match(calls[4].url, /season_averages\/general\?season=2026&season_type=regular&type=base&per_page=100&player_ids\[\]=1&player_ids\[\]=2$/);
  assert.match(calls[1].url, /\/v2\/odds\?game_ids\[\]=5$/);
});

test('fetchedAt is the answer\'s own Date header, else now', async () => {
  const a = await bdlPageRead('/x', { fetchImpl: spy(reply({ data: [] }, { date: 'Wed, 21 Oct 2026 22:36:30 GMT' })).fetchImpl, key: KEY });
  assert.equal(a.fetchedAt.toISOString(), '2026-10-21T22:36:30.000Z');
  const before = Date.now();
  const b = await bdlPageRead('/x', { fetchImpl: spy(reply({ data: [] })).fetchImpl, key: KEY });
  assert.ok(b.fetchedAt.getTime() >= before);
});

test('a 4xx/5xx, a missing key and a slow feed all THROW (the view catches: module hidden)', async () => {
  await assert.rejects(readInjuries([1], { key: KEY, fetchImpl: spy({ ok: false, status: 503, headers: { get: () => null } }).fetchImpl }), /BDL 503|503/);
  await assert.rejects(readInjuries([1], { key: '', fetchImpl: spy(reply({})).fetchImpl }));
  const slow = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)));
  const t0 = Date.now();
  const hold = setInterval(() => {}, 20); // AbortSignal.timeout's timer is unref'd; keep the test's loop alive
  try { await assert.rejects(readOdds(5, { key: KEY, fetchImpl: slow, timeoutMs: 40 })); } finally { clearInterval(hold); }
  assert.ok(Date.now() - t0 < 1500, 'gave up on its own timeout');
});

test('rosters and team games page by cursor', async () => {
  const pages = [reply({ data: [{ id: 1 }], meta: { next_cursor: 77 } }), reply({ data: [{ id: 2 }], meta: {} })];
  const { calls, fetchImpl } = spy(() => pages.shift());
  const out = await readRoster(1, { fetchImpl, key: KEY });
  assert.deepEqual(out.map((p) => p.id), [1, 2]);
  assert.match(calls[1].url, /cursor=77$/);
});

test('seasons averages chunk the player ids', async () => {
  const { calls, fetchImpl } = spy(reply({ data: [{ player: { id: 1 } }] }));
  const out = await readSeasonAverages(2026, Array.from({ length: 130 }, (_, i) => i + 1), { fetchImpl, key: KEY });
  assert.equal(calls.length, 3);
  assert.equal(out.length, 3);
});
