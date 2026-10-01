// lib/retired.test.mjs — editorial and soccer, retired (tue-14). The proxy
// cannot be imported under node (next/server), so its half is pinned by source;
// the destinations are the pure table both the proxy and the pages read.
// Run: node --test lib/retired.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RETIRED_ROUTES, retiredRedirect, isRetiredLeague, KEPT_LEAGUES } from './retired.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (r) => readFileSync(path.join(REPO, r), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('THE TABLE, as ruled', () => {
  const T = [
    ['/today', '/games'], ['/articles', '/games'], ['/articles/2', '/games'],
    ['/article/some-essay', '/games'], ['/article', '/games'],
    ['/nfl/wire', '/nfl'], ['/cfb/wire', '/cfb'], ['/nfl/wire/', '/nfl'],
    ['/epl/standings', '/scores'], ['/epl/match/ars-che', '/scores'], ['/epl', '/scores'],
    ['/schedule', '/scores'], ['/stats', '/scores'],
    ['/world-cup', '/scores'], ['/world-cup/bracket', '/scores'],
    ['/world-cup-2026/bracket', '/scores'], ['/world-cup-2026/rankings/power', '/scores'],
    ['/bracket', '/scores'], ['/power-rankings', '/scores'],
  ];
  for (const [from, to] of T) assert.equal(retiredRedirect(from), to, from);
});

test('NOTHING THAT STAYS IS CAUGHT, prefixes included', () => {
  for (const p of ['/', '/games', '/scores', '/nfl', '/cfb', '/nfl/standings', '/nfl/rankings',
    '/cfb/market', '/market', '/rankings', '/mlb/game/x', '/match/x', '/team/x', '/player/x',
    '/articlesx', '/todays', '/eplx', '/statsx', '/nfl/wirex', '/admin/blurbs', '/world-cupx', null]) {
    assert.equal(retiredRedirect(p), null, String(p));
  }
});

test('by league: soccer rows go, gridiron and MLB rows stay', () => {
  assert.deepEqual([...KEPT_LEAGUES], ['nfl', 'cfb', 'mlb']);
  for (const s of ['epl', 'fifa-wc-2026', 'international-friendlies']) assert.equal(isRetiredLeague(s), true, s);
  for (const s of ['nfl', 'cfb', 'mlb', null, undefined]) assert.equal(isRetiredLeague(s), false, String(s));
  for (const f of ['app/match/[slug]/page.js', 'app/team/[slug]/page.js', 'app/player/[slug]/page.js']) {
    assert.match(strip(src(f)), /isRetiredLeague\([^)]*\)\) permanentRedirect\('\/scores'\)/, f);
  }
});

test('THE PROXY: 301, before the admin gate, and a matcher literal pair for every route', () => {
  const t = strip(src('proxy.js'));
  const call = t.indexOf('retiredRedirect(pathname)');
  assert.ok(call > 0);
  assert.match(t.slice(call, call + 250), /NextResponse\.redirect\(new URL\(retired, request\.url\), 301\)/);
  assert.ok(call < t.indexOf('const isAdminPath'), 'before the admin gate');
  const m = t.match(/matcher:\s*\[([\s\S]*?)\n  \],/);
  for (const from of Object.keys(RETIRED_ROUTES)) {
    assert.ok(m[1].includes(`'${from}'`), `matcher lacks '${from}'`);
    assert.ok(m[1].includes(`'${from}/:path*'`), `matcher lacks '${from}/:path*'`);
  }
  assert.doesNotMatch(t, /PERMANENT_REDIRECTS|resolveCurrentEditionForFamily/, 'the old chains are gone');
});
