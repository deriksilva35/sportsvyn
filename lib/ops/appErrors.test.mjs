import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { stackHash, normaliseStack, recordAppError, installAppErrorHooks, MESSAGE_MAX } from './appErrors.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SVC = `zz-test-apperrors-${process.pid}`;
const mk = (msg, frames) => { const e = new Error(msg); e.stack = `Error: ${msg}\n${frames.join('\n')}`; return e; };

test('hash: same bug under new release path / new lines -> same hash', () => {
  const a = mk('boom', ['    at poll (file:///home/derik/deploy/sportsvyn/releases/abc123/services/live-poller/poll.mjs:10:5)', '    at run (/home/derik/deploy/sportsvyn/releases/abc123/lib/live/x.js:7:1)']);
  const b = mk('boom', ['    at poll (file:///home/derik/deploy/sportsvyn/releases/def456/services/live-poller/poll.mjs:99:12)', '    at run (/home/derik/projects/sportsvyn/lib/live/x.js:70:3)']);
  assert.equal(stackHash(a), stackHash(b));
  assert.doesNotMatch(normaliseStack(a.stack), /abc123|:\d+:\d+/);
});

test('hash: different message or different frames -> different hash', () => {
  const f = ['    at poll (/r/releases/a/lib/x.js:1:1)'];
  assert.notEqual(stackHash(mk('boom', f)), stackHash(mk('bang', f)));
  assert.notEqual(stackHash(mk('boom', f)), stackHash(mk('boom', ['    at other (/r/releases/a/lib/y.js:1:1)'])));
  assert.equal(stackHash('plain string'), stackHash('plain string'));
});

const sql = neon(process.env.DATABASE_URL);
after(async () => {
  await sql`DELETE FROM app_errors WHERE service = ${SVC}`;
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM app_errors WHERE service = ${SVC}`;
  assert.equal(n, 0, 'teardown leaves zero sentinel rows');
});

test('dedupe on DEV: repeat is count+1, ts moves, message refreshed, message truncated', async () => {
  const f = ['    at poll (/r/releases/a/lib/x.js:1:1)'];
  await recordAppError(SVC, mk('first', f));
  const [r1] = await sql`SELECT * FROM app_errors WHERE service = ${SVC}`;
  assert.equal(r1.count, 1);
  const e2 = mk('first', f); // same message -> same hash
  await new Promise((r) => setTimeout(r, 20));
  await recordAppError(SVC, e2);
  const rows = await sql`SELECT * FROM app_errors WHERE service = ${SVC}`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 2);
  assert.ok(new Date(rows[0].ts) > new Date(r1.ts));
  assert.equal(new Date(rows[0].first_seen).getTime(), new Date(r1.first_seen).getTime());
  await recordAppError(SVC, mk('x'.repeat(5000), ['    at big (/r/lib/z.js:1:1)']));
  const [big] = await sql`SELECT message FROM app_errors WHERE service = ${SVC} AND message LIKE 'xxx%'`;
  assert.equal(big.message.length, MESSAGE_MAX);
});

test('recordAppError never throws when the DB fails', async () => {
  const bad = () => Promise.reject(new Error('db down'));
  const orig = console.error; let logged = '';
  console.error = (...a) => { logged += a.join(' '); };
  try { assert.equal(await recordAppError(SVC, new Error('x'), { sql: bad }), false); }
  finally { console.error = orig; }
  assert.match(logged, /write failed: db down/);
});

test('hooks keep crash semantics: record (bounded), then exit 1 - even if the DB hangs', async () => {
  const handlers = {};
  const proc = { on: (ev, fn) => { handlers[ev] = fn; } };
  const codes = [];
  const hang = () => new Promise(() => {});
  installAppErrorHooks('svc', { proc, sql: hang, waitMs: 50, exit: (c) => codes.push(c) });
  assert.deepEqual(Object.keys(handlers).sort(), ['uncaughtException', 'unhandledRejection']);
  const orig = console.error; console.error = () => {};
  try {
    await handlers.uncaughtException(new Error('a'));
    await handlers.unhandledRejection(new Error('b'));
  } finally { console.error = orig; }
  assert.deepEqual(codes, [1, 1]);
});

test('a real process with the hooks still dies with exit 1 on an uncaught throw', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `process.env.DATABASE_URL='postgres://x:x@x.invalid/x'; const m = await import('${path.join(REPO, 'lib/ops/appErrors.js')}'); m.installAppErrorHooks('zz-never', {waitMs: 200}); setTimeout(() => { throw new Error('die'); }, 5);`],
    { encoding: 'utf8', timeout: 15000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /die/);
});

test('each service entry installs the hooks; log-and-exit catches record first', () => {
  for (const f of ['live-poller', 'daily-tick', 'mlb-advance']) {
    const src = readFileSync(path.join(REPO, 'services', f, 'index.mjs'), 'utf8');
    assert.match(src, new RegExp(`installAppErrorHooks\\('${f}'\\)`), f);
  }
  const lp = readFileSync(path.join(REPO, 'services/live-poller/index.mjs'), 'utf8');
  assert.match(lp, /await recordWithin\('live-poller', e\);\s*process\.exit\(1\)/);
  const dt = readFileSync(path.join(REPO, 'services/daily-tick/index.mjs'), 'utf8');
  assert.match(dt, /await recordWithin\('daily-tick', e\);\s*process\.exit\(1\)/);
});
