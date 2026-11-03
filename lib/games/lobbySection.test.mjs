// lib/games/lobbySection.test.mjs - one lobby module fails alone (3 Nov outage).
//
// The outage: weeklyCard threw on a settled Weekly's rank { rank, of: null }, the
// page's .catch(() => null) swallowed it, and the lobby went blank for every
// signed-in entrant with nothing in app_errors. These tests hold the two halves
// of the fix: a throw in ONE module leaves the others standing, and exactly one
// app_errors write records it. The logger is a stub - nothing here writes to
// app_errors on any database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { section, shaped, userHash, logLobbyError, pageCatch } from './lobbySection.js';
import { lobbyV3 } from './lobbyV3.js';

const stubLog = () => { const calls = []; return { calls, log: async (service, err) => { calls.push({ service, err }); return true; } }; };

test('section returns the value, or the fallback after ONE logged write', async () => {
  const { calls, log } = stubLog();
  assert.equal(await section('ok', async () => 7, 0, { log }), 7);
  assert.equal(calls.length, 0);
  assert.equal(await section('bad', async () => { throw new Error('boom'); }, 'fb', { route: '/games', uid: 42, log }), 'fb');
  assert.equal(await section('bad-sync', () => { throw new Error('sync'); }, null, { log }), null);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].service, 'lobby:bad');
});

test('the logged row names route and module, hashes the user, never carries the raw id', async () => {
  const { calls, log } = stubLog();
  await section('weekly-card', () => { throw new Error('rank.of.toLocaleString'); }, null, { route: '/games', uid: 987654, log });
  const { service, err } = calls[0];
  assert.equal(service, 'lobby:weekly-card');
  assert.match(err.message, /^route=\/games uh=[0-9a-f]{10} :: rank\.of\.toLocaleString$/);
  assert.ok(!err.message.includes('987654'));
  assert.equal(userHash(987654), userHash(987654));
  assert.notEqual(userHash(987654), userHash(987655));
  assert.equal(userHash(null), 'anon');
  assert.ok(err.stack, 'the stack travels so stack_hash is the original defect');
});

test('a logger that throws never reaches the render', async () => {
  const log = async () => { throw new Error('db down'); };
  const origErr = console.error; console.error = () => {};
  try {
    assert.equal(await section('x', () => { throw new Error('a'); }, 'fb', { log }), 'fb');
    await logLobbyError('x', new Error('b'), { log });
  } finally { console.error = origErr; }
});

test('shaped and pageCatch log through the same path', async () => {
  const { calls, log } = stubLog();
  const pending = [];
  assert.equal(shaped('card', () => { throw new Error('s'); }, 'fb', { log, pending }), 'fb');
  await Promise.all(pending);
  assert.equal(await Promise.reject(new Error('p')).catch(pageCatch('lobby-v3', { route: '/', log })), null);
  assert.deepEqual(calls.map((c) => c.service), ['lobby:card', 'lobby:lobby-v3']);
  const pg = stubLog();
  assert.deepEqual(await Promise.reject(new Error('q')).catch(pageCatch('/x:read', { service: 'page', route: '/x', log: pg.log }, [])), []);
  assert.equal(pg.calls[0].service, 'page:/x:read');
});

test('lobbyV3: one module throws, the rest of the lobby renders, exactly one app_errors write', async () => {
  const { calls, log } = stubLog();
  const v = await lobbyV3(null, {
    route: '/games', log,
    inject: { 'weekly-card': () => { throw new Error('weeklyCard exploded'); } },
  });
  assert.ok(v, 'the lobby is not null');
  assert.equal(v.chip, 'week');
  // the others are present: the Play view, its chips, the practice tiles
  assert.ok(Array.isArray(v.play.chips) && v.play.chips.length > 0, 'chips present');
  assert.ok(Array.isArray(v.play.cards), 'cards present');
  assert.ok(Array.isArray(v.play.practice) && v.play.practice.length === 2, 'practice tiles present');
  assert.ok(Array.isArray(v.play.leagues), 'leagues section present');
  assert.equal(calls.length, 1, 'exactly one write');
  assert.equal(calls[0].service, 'lobby:weekly-card');
  assert.match(calls[0].err.message, /route=\/games uh=anon :: weeklyCard exploded/);
});

test('lobbyV3: several modules down at once, still a lobby, one write each', async () => {
  const { calls, log } = stubLog();
  const boom = () => { throw new Error('x'); };
  const v = await lobbyV3(null, { route: '/', log, inject: { 'daily-home': boom, 'play-items': boom, 'my-leagues': boom, 'play-lobby': boom } });
  assert.ok(v?.play, 'a view, not null');
  assert.ok(calls.length >= 3 && calls.length <= 4);
});
