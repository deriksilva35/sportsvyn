// scripts/crewProbeAccount.test.mjs - the probe account script against DEV, sentinel style: its own
// address and handle (CREW_PROBE_EMAIL / CREW_PROBE_HANDLE), removed in after().
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { neon } from '@neondatabase/serverless';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFlags } from './crew-probe-account.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'crew-probe-account.mjs');
const sql = neon(process.env.DATABASE_URL);
const EMAIL = `crew-probe-test-${process.pid}@sportsvyn.invalid`;
const HANDLE = `cpt${process.pid}`;
const env = { PATH: process.env.PATH, HOME: process.env.HOME, DATABASE_URL: process.env.DATABASE_URL, CREW_PROBE_EMAIL: EMAIL, CREW_PROBE_HANDLE: HANDLE };

// stdout is a PIPE here (spawnSync default), which is the only way the script accepts --mint-token.
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env, timeout: 60_000 });
const user = async () => (await sql`SELECT * FROM users WHERE email = ${EMAIL}`)[0] ?? null;
const sessionsOf = async (id) => sql`SELECT "sessionToken", expires FROM sessions WHERE "userId" = ${id}`;

after(async () => {
  const u = await user();
  if (u) { await sql`DELETE FROM sessions WHERE "userId" = ${u.id}`; await sql`DELETE FROM users WHERE id = ${u.id}`; }
  assert.equal(await user(), null, 'teardown removed the sentinel user');
});

test('flags: unknown or combined flags are refused; no secret can ride in argv', () => {
  assert.throws(() => parseFlags(['--token', 'abc']), /unknown argument/);
  assert.throws(() => parseFlags(['--ttl-min', '5']), /only goes with/);
  assert.throws(() => parseFlags(['--mint-token', '--apply']), /stands alone/);
  assert.throws(() => parseFlags(['--mint-token', '--ttl-min', 'x']), /whole number/);
  assert.deepEqual(parseFlags(['--mint-token', '--ttl-min', '15']).ttlMin, 15);
});

test('dry run writes nothing; --apply creates the probe user once and is idempotent', async () => {
  assert.equal(await user(), null);
  let r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /dry run: would create/);
  assert.equal(await user(), null, 'a dry run created nothing');
  r = run('--apply');
  assert.equal(r.status, 0, r.stderr);
  const u = await user();
  assert.equal(u.is_probe, true);
  assert.equal(u.handle, HANDLE);
  assert.ok(u.onboarded_at && u.date_of_birth && u.email_opted_out_at, 'passes the age screen, onboarded, never mailed');
  assert.equal(u.morning_email, false);
  r = run('--apply');
  assert.equal(r.status, 0, r.stderr);
  assert.equal((await sql`SELECT count(*)::int n FROM users WHERE email = ${EMAIL}`)[0].n, 1, 'still one row');
});

test('--mint-token: refuses a terminal before touching the database; on a pipe the token is the only stdout line', async () => {
  const u = await user();
  // A pty-less way to prove the refusal path: the script's main() is driven with isTTY true.
  const { main } = await import('./crew-probe-account.mjs');
  const out = []; const err = [];
  await assert.rejects(main({ argv: ['--mint-token'], env, stdout: (s) => out.push(s), stderr: (s) => err.push(s), isTTY: true }), /refuses a terminal/);
  assert.deepEqual(out, []);
  assert.equal((await sessionsOf(u.id)).length, 0, 'nothing written');

  const r = run('--mint-token', '--ttl-min', '15');
  assert.equal(r.status, 0, r.stderr);
  const token = r.stdout.trim();
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(r.stdout, `${token}\n`, 'stdout is the token and nothing else');
  assert.ok(!r.stderr.includes(token), 'stderr never carries the token');
  const rows = await sessionsOf(u.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sessionToken, token);
  const mins = (new Date(rows[0].expires) - Date.now()) / 60_000;
  assert.ok(mins > 13 && mins <= 15.1, `short ttl, got ${mins}`);

  const long = run('--mint-token');
  assert.equal(long.status, 0, long.stderr);
  const days = (new Date((await sessionsOf(u.id)).find((s) => s.sessionToken === long.stdout.trim()).expires) - Date.now()) / 86_400_000;
  assert.ok(days > 364 && days <= 365.1, `365 days, got ${days}`);
});

test('--revoke deletes the probe user sessions and nobody else', async () => {
  const u = await user();
  const [other] = await sql`SELECT id FROM users WHERE NOT is_probe ORDER BY id LIMIT 1`;
  const before = other ? (await sessionsOf(other.id)).length : 0;
  const r = run('--revoke');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /revoked 2 session/);
  assert.equal((await sessionsOf(u.id)).length, 0);
  if (other) assert.equal((await sessionsOf(other.id)).length, before, 'another user keeps their sessions');
});

test('a non-probe row on the probe address is never touched', async () => {
  const [x] = await sql`INSERT INTO users (email, handle) VALUES (${`crew-probe-clash-${process.pid}@sportsvyn.invalid`}, ${`cpc${process.pid}`}) RETURNING id`;
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--mint-token'], { encoding: 'utf8', timeout: 60_000, env: { ...env, CREW_PROBE_EMAIL: `crew-probe-clash-${process.pid}@sportsvyn.invalid` } });
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /NOT flagged is_probe/);
    assert.equal((await sessionsOf(x.id)).length, 0);
  } finally { await sql`DELETE FROM users WHERE id = ${x.id}`; }
});
