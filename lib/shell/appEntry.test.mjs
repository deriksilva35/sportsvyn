// lib/shell/appEntry.test.mjs - the native start URL lands on Games (G-FIX).
//
// The binary starts at /sim?shell=sim-app. The proxy answers that exact entry
// with a 307 to /games (cookie set as before, query dropped); /sim without the
// param is not the proxy's business at all. These call proxy() itself with real
// requests, and read the matcher to prove which requests can reach it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { install } from './../testing/nextResolve.mjs';

install();
const { NextRequest } = await import('next/server.js');
const { proxy, config } = await import('../../proxy.js');

const req = (url, cookie = null) => new NextRequest(new URL(url, 'https://sportsvyn.com'),
  { headers: cookie ? { cookie } : {} });
const setCookie = (res) => res.headers.get('set-cookie') ?? '';

test('/sim?shell=sim-app, first launch -> 307 /games, and the cookie is written', async () => {
  const res = await proxy(req('/sim?shell=sim-app'));
  assert.equal(res.status, 307);
  assert.equal(new URL(res.headers.get('location')).pathname, '/games');
  assert.equal(new URL(res.headers.get('location')).search, '', 'the shell param does not ride along');
  assert.match(setCookie(res), /sv_shell=sim-app/);
  assert.match(setCookie(res), /Path=\//);
  assert.doesNotMatch(setCookie(res), /Max-Age|Expires/i, 'still a session cookie');
});

test('/sim?shell=sim-app, every later launch (cookie already set) -> 307 /games', async () => {
  const res = await proxy(req('/sim?shell=sim-app', 'sv_shell=sim-app'));
  assert.equal(res.status, 307);
  assert.equal(new URL(res.headers.get('location')).pathname, '/games');
  assert.doesNotMatch(setCookie(res), /sv_shell/, 'nothing to write - it is already there');
});

test('/sim with the cookie and no param renders /sim - the proxy passes it through', async () => {
  const res = await proxy(req('/sim', 'sv_shell=sim-app'));
  assert.equal(res.headers.get('location'), null);
  assert.equal(res.headers.get('x-middleware-next'), '1');
});

test('/sim with neither renders the web /sim - no redirect, no cookie', async () => {
  const res = await proxy(req('/sim'));
  assert.equal(res.headers.get('location'), null);
  assert.equal(res.headers.get('x-middleware-next'), '1');
  assert.doesNotMatch(setCookie(res), /sv_shell/);
});

test('ONLY THE EXACT ENTRY: other paths with the param are not redirected to Games', async () => {
  for (const p of ['/sim/draft/1?shell=sim-app', '/join/ABCDEFGH?shell=sim-app', '/scores?shell=sim-app']) {
    const res = await proxy(req(p));
    const loc = res.headers.get('location');
    assert.ok(!loc || new URL(loc).pathname !== '/games', `${p} must not be sent to /games`);
  }
});

test('THE MATCHER lets /sim?shell=sim-app reach the proxy with or without the cookie', () => {
  const entry = config.matcher.find((m) => typeof m === 'object' && m.source === '/sim');
  assert.ok(entry, 'a /sim entry exists');
  assert.deepEqual(entry.has, [{ type: 'query', key: 'shell', value: 'sim-app' }]);
  assert.equal(entry.missing, undefined, 'no cookie condition - launch two onward must match too');
  assert.ok(!config.matcher.includes('/sim'), 'a bare /sim never reaches the proxy');
});
