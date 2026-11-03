// lib/games/lobbyHealth.test.mjs - the lobby health collector behind the crew lobby-probe marker.
// A section that throws shows up as hidden with its module key; modules are counted; one collector per
// request (nothing shared); the page renders ONE marker and a stable error attribute (source-level here,
// the real render is proved by the crew probe against a built server).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { section, shaped, logLobbyError, createLobbyHealth } from './lobbySection.js';
import { lobbyV3 } from './lobbyV3.js';

const quiet = () => ({ log: async () => true });

test('section/shaped count every module and name the ones hidden by an error', async () => {
  const health = createLobbyHealth();
  const ctx = { ...quiet(), health, pending: [] };
  await section('daily-home', async () => 1, null, ctx);
  await section('tonight', async () => { throw new Error('boom'); }, [], ctx);
  shaped('weekly-card', () => 2, null, ctx);
  shaped('intro-line', () => { throw new Error('shape'); }, null, ctx);
  await Promise.all(ctx.pending);
  assert.deepEqual(health.snapshot(), { modules: 4, hidden: ['tonight', 'intro-line'] });
});

test('logLobbyError reached directly (a ghosted play item) is hidden too; names carry no id or message', async () => {
  const health = createLobbyHealth();
  await logLobbyError('play-pickem', new Error('secret detail user 42'), { ...quiet(), uid: 42, health });
  await logLobbyError('weird name/with spaces & "quotes"', new Error('x'), { ...quiet(), health });
  const s = health.snapshot();
  assert.deepEqual(s.hidden, ['play-pickem', 'weird_name_with_spaces____quotes_']);
  assert.ok(!JSON.stringify(s).includes('42') && !JSON.stringify(s).includes('secret'));
  assert.ok(!/[\s,"'<>&]/.test(s.hidden.join('')), 'safe inside a comma-joined attribute');
});

test('one collector per request: nothing is shared between two collectors', async () => {
  const a = createLobbyHealth(); const b = createLobbyHealth();
  await section('x', () => { throw new Error('a'); }, null, { ...quiet(), health: a });
  await section('y', async () => 1, null, { ...quiet(), health: b });
  assert.deepEqual(a.snapshot(), { modules: 1, hidden: ['x'] });
  assert.deepEqual(b.snapshot(), { modules: 1, hidden: [] });
});

test('no collector: section behaves exactly as before (no throw on the missing health)', async () => {
  assert.equal(await section('x', () => { throw new Error('a'); }, 'fb', quiet()), 'fb');
});

test('lobbyV3: a throwing module is reported in the returned health, every chip carries it', async () => {
  const boom = () => { throw new Error('exploded'); };
  const v = await lobbyV3(null, { ...quiet(), inject: { tonight: boom, 'weekly-card': boom } });
  assert.ok(v.health.modules > 10, `modules counted (${v.health.modules})`);
  assert.ok(v.health.hidden.includes('tonight') && v.health.hidden.includes('weekly-card'), v.health.hidden.join());
  const clean = await lobbyV3(null, { ...quiet() });
  assert.equal(clean.health.hidden.length, 0, `clean lobby hides nothing: ${clean.health.hidden.join()}`);
  for (const chip of ['boards', 'alerts', 'results']) {
    const c = await lobbyV3(null, { ...quiet(), chip });
    assert.ok(c.health && c.health.modules >= 1, `${chip} carries health`);
  }
});

test('the page renders the marker in the lobby and a stable error attribute; both doors share LobbyMain', () => {
  const main = readFileSync(new URL('../../components/games/LobbyMain.js', import.meta.url), 'utf8');
  assert.match(main, /<LobbyHealth health=\{v\.health\}/);
  assert.match(main, /data-sv-lobby-error=""/);
  assert.match(main, /The lobby is having a moment\. Try again shortly\./, 'the copy is unchanged');
  const comp = readFileSync(new URL('../../components/games/LobbyHealth.js', import.meta.url), 'utf8');
  for (const a of ['data-sv-lobby-health', 'data-modules', 'data-hidden=', 'data-hidden-names', 'data-signed-in']) assert.ok(comp.includes(a), a);
  for (const page of ['../../app/page.js', '../../app/games/page.js']) {
    assert.match(readFileSync(new URL(page, import.meta.url), 'utf8'), /<LobbyMain /, `${page} draws the lobby through LobbyMain`);
  }
});
