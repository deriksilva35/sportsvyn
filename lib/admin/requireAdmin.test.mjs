// lib/admin/requireAdmin.test.mjs - the admin credential check, both layers.
//
// adminAuth.js is the pure check proxy.js and requireAdmin() share; it is tested
// directly. requireAdmin.js imports next/headers, which plain node cannot load,
// so its source is copied into test-tmp/ with that one import pointed at a stub
// whose headers() returns what each test sets - the code under test is the
// file's own, byte for byte apart from the import line.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkAdminBasic, assertAdminAuthorization, AdminAuthError } from './adminAuth.js';
import { stubPath } from '../testing/stubDir.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV = { ADMIN_USERNAME: 'editor', ADMIN_SECRET: 's3cret:with:colons' };
const basic = (u, p) => `Basic ${Buffer.from(`${u}:${p}`, 'utf-8').toString('base64')}`;
const RIGHT = basic(ENV.ADMIN_USERNAME, ENV.ADMIN_SECRET);

test('the right credential passes', () => {
  assert.equal(checkAdminBasic(RIGHT, ENV), 'ok');
  assert.doesNotThrow(() => assertAdminAuthorization(RIGHT, ENV));
});

test('a missing header is refused', () => {
  for (const h of [null, undefined, '']) {
    assert.equal(checkAdminBasic(h, ENV), 'refused');
    assert.throws(() => assertAdminAuthorization(h, ENV), AdminAuthError);
  }
});

test('a wrong credential is refused', () => {
  for (const h of [
    basic('editor', 'wrong'),
    basic('someone', ENV.ADMIN_SECRET),
    basic('editor', 's3cret'),                 // prefix of the real secret
    basic('editor', `${ENV.ADMIN_SECRET}x`),   // real secret plus one
    `Bearer ${ENV.ADMIN_SECRET}`,               // the old route's scheme
    `basic ${RIGHT.slice(6)}`,                  // scheme is case-exact, as in the proxy
    `Basic ${Buffer.from('editor').toString('base64')}`, // no colon
    'Basic !!!not-base64!!!',
  ]) {
    assert.equal(checkAdminBasic(h, ENV), 'refused', h);
  }
});

test('a missing env is refused, never a pass - even with an empty credential', () => {
  for (const env of [{}, { ADMIN_USERNAME: 'editor' }, { ADMIN_SECRET: 'x' },
    { ADMIN_USERNAME: '', ADMIN_SECRET: '' }, undefined]) {
    assert.equal(checkAdminBasic(RIGHT, env), 'unconfigured');
    assert.equal(checkAdminBasic(basic('', ''), env), 'unconfigured');
    assert.throws(() => assertAdminAuthorization(RIGHT, env),
      (e) => e instanceof AdminAuthError && e.reason === 'unconfigured');
  }
});

// --- requireAdmin() itself, through a next/headers stub ---------------------

const headersStub = stubPath('__next_headers_stub.mjs');
const wrapped = stubPath('__requireAdmin_under_test.mjs');
after(() => { for (const f of [headersStub, wrapped]) { try { unlinkSync(f); } catch {} } });

writeFileSync(headersStub, `export let current = new Map();
export function setAuth(v) { current = new Map(v == null ? [] : [['authorization', v]]); }
export async function headers() { return { get: (k) => current.get(k.toLowerCase()) ?? null }; }
`);
const original = readFileSync(path.join(HERE, 'requireAdmin.js'), 'utf8');
assert.match(original, /from 'next\/headers';/);
writeFileSync(wrapped, original
  .replace(`from 'next/headers';`, `from '${pathToFileURL(headersStub).href}';`)
  .replaceAll(`from './adminAuth.js';`, `from '${pathToFileURL(path.join(HERE, 'adminAuth.js')).href}';`));

const { setAuth } = await import(pathToFileURL(headersStub).href);
const { requireAdmin } = await import(pathToFileURL(wrapped).href);

function withEnv(env, fn) {
  const saved = { u: process.env.ADMIN_USERNAME, s: process.env.ADMIN_SECRET };
  for (const [k, v] of Object.entries({ ADMIN_USERNAME: env.ADMIN_USERNAME, ADMIN_SECRET: env.ADMIN_SECRET })) {
    if (v == null) delete process.env[k]; else process.env[k] = v;
  }
  return Promise.resolve(fn()).finally(() => {
    if (saved.u == null) delete process.env.ADMIN_USERNAME; else process.env.ADMIN_USERNAME = saved.u;
    if (saved.s == null) delete process.env.ADMIN_SECRET; else process.env.ADMIN_SECRET = saved.s;
  });
}

test('requireAdmin: reads the request Authorization header and checks process.env', async () => {
  await withEnv(ENV, async () => {
    setAuth(RIGHT);
    await requireAdmin();
    setAuth(null);
    await assert.rejects(requireAdmin(), (e) => e.name === 'AdminAuthError' && e.reason === 'refused');
    setAuth(basic('editor', 'nope'));
    await assert.rejects(requireAdmin(), (e) => e.reason === 'refused');
  });
  await withEnv({}, async () => {
    setAuth(RIGHT);
    await assert.rejects(requireAdmin(), (e) => e.reason === 'unconfigured');
  });
});

test('the proxy uses the same check, not a copy', () => {
  const proxy = readFileSync(path.join(HERE, '..', '..', 'proxy.js'), 'utf8');
  assert.match(proxy, /import \{ checkAdminBasic \} from '\.\/lib\/admin\/adminAuth\.js';/);
  assert.match(proxy, /checkAdminBasic\(request\.headers\.get\('authorization'\)/);
  assert.ok(!/timingSafeEqual/.test(proxy), 'no second compare lives in the proxy');
});
