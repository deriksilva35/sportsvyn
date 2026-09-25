// lib/market/cachedReads.test.mjs - /market's reads through the 60 s shared
// cache (25 Sep incident). next/cache is stubbed with a JSON round trip - what
// the real data cache does to a value - so the test proves every wrapper hands
// the page back the shape its reader returned: a Map, a Set, a Date.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { stubPath } from '../testing/stubDir.mjs';

const CACHE = stubPath('__next_cache_stub.mjs'); const READS = stubPath('__market_reads_stub.mjs'); const PROPS = stubPath('__market_props_stub.mjs');
writeFileSync(CACHE, [
  'export const seen = [];',
  'export function unstable_cache(fn, keys, opts) { return async (...a) => { seen.push({ keys, opts }); return JSON.parse(JSON.stringify(await fn(...a))); }; }',
].join('\n'));
writeFileSync(READS, [
  "export async function pricedSlate() { return new Map([['nfl', [{ matchId: 1, kickoffAt: new Date('2026-09-27T17:00:00Z') }]]]); }",
  "export async function futuresBoards() { return [{ slug: 'nfl', rows: [] }]; }",
  "export async function bookCounts() { return new Map([['nfl', 9]]); }",
  "export async function latestSnapshotAt() { return new Date('2026-09-25T20:00:00Z'); }",
  'export async function boardMatchIds() { return new Set([1, 2]); }',
].join('\n'));
writeFileSync(PROPS, [
  "export const calls = [];",
  "export async function propsBoardRows(league) { calls.push(league); return [{ matchId: 1, league }, { matchId: 2, league }]; }",
  "export function propsBoardFrom(rows, f) { return { rows: f.game ? rows.filter((r) => r.matchId === Number(f.game)) : rows, total: rows.length, echo: f }; }",
  "export async function propsGames() { return []; }",
].join('\n'));
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/cache') return { url: pathToFileURL(CACHE).href, shortCircuit: true };
  if (spec === './reads.js') return { url: pathToFileURL(READS).href, shortCircuit: true };
  if (spec === './propsBoard.js') return { url: pathToFileURL(PROPS).href, shortCircuit: true };
  return next(spec, ctx);
} });

after(() => { for (const f of [CACHE, READS, PROPS]) { try { unlinkSync(f); } catch { /* gone */ } } });

const C = await import('./cachedReads.js');
const { seen } = await import(pathToFileURL(CACHE).href);

test('every wrapper survives the JSON round trip with its reader\'s shape', async () => {
  const slate = await C.cachedPricedSlate();
  assert.ok(slate instanceof Map); assert.equal(slate.get('nfl')[0].matchId, 1);
  assert.equal(new Date(slate.get('nfl')[0].kickoffAt).toISOString(), '2026-09-27T17:00:00.000Z', 'a date comes back as a string every renderer already wraps');
  const books = await C.cachedBookCounts(); assert.ok(books instanceof Map); assert.equal(books.get('nfl'), 9);
  const ids = await C.cachedBoardMatchIds(); assert.ok(ids instanceof Set); assert.equal(ids.has(2), true);
  const at = await C.cachedLatestSnapshotAt(); assert.ok(at instanceof Date); assert.equal(at.toISOString(), '2026-09-25T20:00:00.000Z');
  assert.deepEqual(await C.cachedFuturesBoards(), [{ slug: 'nfl', rows: [] }]);
  const b = await C.cachedPropsBoard({ league: 'nfl', game: 2 });
  assert.deepEqual(b.rows, [{ matchId: 2, league: 'nfl' }], 'the filters are applied to the cached league rows');
});

test('60 s, shared, one key per reader', () => {
  assert.equal(C.MARKET_REVALIDATE_SEC, 60);
  assert.ok(seen.every((s) => s.opts.revalidate === 60 && s.opts.tags.includes('market')));
  assert.equal(new Set(seen.map((s) => s.keys[0])).size >= 5, true);
});

test('the page reads through the cache, is not force-dynamic, and no longer samples its clients', () => {
  const src = readFileSync(new URL('../../app/market/page.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /export const dynamic = 'force-dynamic'/);
  assert.match(code, /cachedPricedSlate\(\), cachedFuturesBoards\(\), cachedBookCounts\(\), cachedLatestSnapshotAt\(\), cachedBoardMatchIds\(\)/);
  assert.doesNotMatch(code, /\bpricedSlate\(\)|\bpropsBoard\(boardState\)/, 'no uncached read left on the page');
  assert.doesNotMatch(code, /market-client|from 'next\/headers'/, 'the temporary client log is gone');
});

test('the props board queries once per LEAGUE; filter combinations reuse the cached rows', async () => {
  const { calls } = await import(pathToFileURL(PROPS).href);
  calls.length = 0;
  // the stub cache here does not memoise, so this counts what the wrapper ASKS
  // the cache for: always the league, never the filters
  await C.cachedPropsBoard({ league: 'cfb', game: 1, team: 'ALA', q: 'x', minHitPct: 60 });
  await C.cachedPropsBoard({ league: 'cfb', pos: 'WR', sort: 'hit' });
  assert.deepEqual(calls, ['cfb', 'cfb']);
  assert.ok(seen.some((s) => s.keys[0] === 'market:propsBoardRows:v1'));
});
