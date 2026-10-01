// lib/auth/safeCallback.test.mjs - callbackUrl is same-origin only, on every
// sign-in path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { safeCallback, authRedirect } from './safeCallback.js';
import { shellSigninHref } from '../shell/signinHref.js';
import { codeFromCallback } from '../fantasy/inviteCode.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

test('relative paths pass unchanged, query and shell marker included', () => {
  for (const ok of [
    '/', '/sim', '/my', '/join/ABCDEFGH?shell=sim-app', '/sim?shell=sim-app',
    '/nfl/game/x#plays', '/games?d=2026-10-01&x=a%20b',
  ]) assert.equal(safeCallback(ok), ok, ok);
});

test('our host, absolute, passes; the request host passes', () => {
  assert.equal(safeCallback('https://sportsvyn.com/sim'), 'https://sportsvyn.com/sim');
  assert.equal(safeCallback('https://www.sportsvyn.com/my?shell=sim-app'), 'https://www.sportsvyn.com/my?shell=sim-app');
  assert.equal(safeCallback('http://localhost:3000/sim', { host: 'localhost:3000' }), 'http://localhost:3000/sim');
  assert.equal(safeCallback('https://preview-x.vercel.app/a', { host: 'preview-x.vercel.app' }), 'https://preview-x.vercel.app/a');
});

test('everything off-origin becomes "/"', () => {
  for (const bad of [
    '//evil.com', '//evil.com/sim', '///evil.com', '/\\evil.com', '\\\\evil.com', '/\\/evil.com',
    'https://evil.com', 'http://evil.com/', 'https://sportsvyn.com.evil.com/',
    'https://evilsportsvyn.com/', 'https://sportsvyn.com@evil.com/', 'https://user:pw@sportsvyn.com/',
    'http://sportsvyn.com/', 'https://sportsvyn.com:8443/',
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,hi',
    '%2F%2Fevil.com', '/%2F/evil.com', '/%2fevil.com', '/%5Cevil.com', '%2f%2fevil.com',
    '/\t/evil.com', '/\n/evil.com', ' /sim', 'evil.com', 'sim', '', null, undefined, 42, {},
    'http://localhost:3000/sim',
  ]) assert.equal(safeCallback(bad), '/', JSON.stringify(bad));
  // A request host does not open a different one.
  assert.equal(safeCallback('https://evil.com/', { host: 'localhost:3000' }), '/');
});

test('Auth.js redirect callback: absolute on baseUrl, never off-origin', () => {
  const baseUrl = 'https://sportsvyn.com';
  assert.equal(authRedirect({ url: '/sim?shell=sim-app', baseUrl }), 'https://sportsvyn.com/sim?shell=sim-app');
  assert.equal(authRedirect({ url: 'https://sportsvyn.com/my', baseUrl }), 'https://sportsvyn.com/my');
  assert.equal(authRedirect({ url: 'https://www.sportsvyn.com/my', baseUrl }), 'https://www.sportsvyn.com/my');
  assert.equal(authRedirect({ url: 'http://localhost:3000/my', baseUrl: 'http://localhost:3000' }), 'http://localhost:3000/my');
  for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', 'https://sportsvyn.com.evil.com'])
    assert.equal(authRedirect({ url: bad, baseUrl }), 'https://sportsvyn.com/', bad);
});

test('signin href builder and join-code reader go through the rule', () => {
  assert.equal(shellSigninHref('https://evil.com', false), '/signin?callbackUrl=%2F');
  assert.equal(shellSigninHref('/sim', true), '/signin?callbackUrl=%2Fsim%3Fshell%3Dsim-app&shell=sim-app');
  assert.equal(codeFromCallback('/join/ABCDEFGH?shell=sim-app'), 'ABCDEFGH');
  assert.equal(codeFromCallback('//join/ABCDEFGH'), null);
});

test('every consumer imports the one helper', () => {
  const uses = {
    'app/signin/page.js': /safeCallback\(params\?\.callbackUrl/,
    'app/signin/SignInForm.js': /safeCallback\(rawCallbackUrl/,
    'app/signin/AppleSignInButton.js': /callbackUrl: safeCallback\(callbackUrl/,
    'auth.js': /redirect: authRedirect/,
    'lib/shell/signinHref.js': /safeCallback\(String\(dest/,
    'lib/fantasy/inviteCode.js': /safeCallback\(callbackUrl\)/,
    'app/api/email/click/route.js': /safeCallback\(to\)/,
  };
  for (const [file, re] of Object.entries(uses)) assert.match(read(file), re, file);
  // /signin reads ?callbackUrl=, never ?next=.
  assert.doesNotMatch(read('components/league/GamesStrip.js'), /signin\?next=/);
});
