// lib/shell/signOutTarget.test.mjs — where sign-out lands, and the cookie that
// has to survive it. NO DATABASE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  signOutTarget, deleteAccountTarget, WEB_SIGNOUT_TARGET, SHELL_SIGNOUT_TARGET,
} from './signOutTarget.js';
import { SHELL_COOKIE, SHELL_VALUE, SHELL_PARAM } from './constants.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

test('shell sign-out lands on the app front door, not the website', () => {
  assert.equal(signOutTarget(true), '/sim?shell=sim-app');
  assert.equal(SHELL_SIGNOUT_TARGET, '/sim?shell=sim-app');
  // The whole point: it must NOT be the marketing site.
  assert.ok(!signOutTarget(true).startsWith('/?'));
  assert.notEqual(signOutTarget(true), '/');
});

test('web sign-out behaviour is unchanged', () => {
  assert.equal(signOutTarget(false), '/');
  assert.equal(signOutTarget(), '/');
  assert.equal(signOutTarget(undefined), '/');
  assert.equal(WEB_SIGNOUT_TARGET, '/');
});

test('the shell target re-arms shell mode via the param', () => {
  // Carried on the URL so the landing is correct even without the cookie, and so
  // ShellPersist re-writes the cookie on arrival.
  assert.match(signOutTarget(true), new RegExp(`${SHELL_PARAM}=${SHELL_VALUE}`));
});

test('delete-account lands the same way, keeping its ?deleted marker', () => {
  assert.equal(deleteAccountTarget(false), '/sim?deleted=1');
  assert.equal(deleteAccountTarget(true), '/sim?deleted=1&shell=sim-app');
  // The lobby reads ?deleted to render its post-deletion state - it must survive
  // in both modes.
  for (const t of [deleteAccountTarget(true), deleteAccountTarget(false)]) {
    assert.match(t, /deleted=1/);
  }
});

test('every sign-out surface routes through the helper (no stray redirectTo)', () => {
  for (const rel of [
    'components/sim/SignOutButton.js',
    'components/SiteHeader.js',
    'components/sim/DeleteAccount.js',
  ]) {
    const s = src(rel);
    assert.match(s, /signOutTarget|deleteAccountTarget/, `${rel} does not use the helper`);
    // A hardcoded redirectTo: '/' is the exact bug this fixes - the app turning
    // into the website on sign-out.
    assert.ok(!/redirectTo:\s*'\/'/.test(s), `${rel} still hardcodes redirectTo: '/'`);
  }
});

// ---------------------------------------------------------------------------
// sv_shell survival
// ---------------------------------------------------------------------------

test('sv_shell is not an Auth.js cookie, so sign-out cannot clear it', () => {
  // Auth.js clears only the cookies it owns (authjs.session-token, callback-url,
  // csrf-token, ...). Verified empirically too: a POST to /api/auth/signout with
  // sv_shell present returns no Set-Cookie for it.
  assert.ok(!SHELL_COOKIE.startsWith('authjs'), 'sv_shell must not be namespaced as an auth cookie');
  assert.ok(!SHELL_COOKIE.startsWith('__Secure-'), 'sv_shell must not collide with an auth cookie name');
  const auth = src('auth.js');
  // The only cookie auth.js overrides is callbackUrl; if that ever grows to name
  // sv_shell, the suppression could be cleared on sign-out.
  assert.ok(!auth.includes(SHELL_COOKIE), 'auth.js must not manage the shell cookie');
});

test('the shell cookie is SESSION-scoped in both setters (documented limit)', () => {
  // Neither setter passes max-age/expires, so sv_shell dies with the browser (or
  // webview) session. That is deliberate for the ?shell=sim-app path - a web
  // visitor must not be stuck chromeless forever - and it does NOT affect
  // sign-out, which is a same-session POST + redirect.
  //
  // It DOES mean a webview cold start begins without the cookie. That is covered
  // because the native container re-writes it on /app mount (NativeShellCookie),
  // and because the sign-out target now carries the param explicitly.
  for (const rel of ['components/sim/ShellPersist.js', 'components/shell/NativeShellCookie.js']) {
    const s = src(rel);
    // Both setters reference the SHELL_COOKIE constant rather than hardcoding
    // "sv_shell" - which is the right thing, so assert on the identifier.
    assert.match(s, /SHELL_COOKIE/, `${rel} should write the shell cookie`);
    // Scan the ASSIGNMENT only. A whole-file scan matches the prose in these
    // files' own headers ("Session cookie (no max-age)") and reports the
    // documented behaviour as a violation of itself.
    const assign = /document\.cookie\s*=\s*`([^`]*)`/.exec(s);
    assert.ok(assign, `${rel} should actually set document.cookie`);
    assert.ok(!/max-age|expires/i.test(assign[1]), `${rel}: session scope is the documented behaviour`);
  }
  assert.equal(SHELL_COOKIE, 'sv_shell'); // the value is still pinned, just not here
});
