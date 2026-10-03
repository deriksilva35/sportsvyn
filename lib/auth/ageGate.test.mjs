// lib/auth/ageGate.test.mjs - the age screen's rules, pure. node --test.
//
// The DEV half (sign-up, the under-13 cascade, the prompt-once) is
// ageGateDb.test.mjs; the door walk is ageGateDoors.test.mjs; the column's
// privacy is ageGateDob.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MIN_AGE, parseDob, ageOn, judgeAnswer, gateVerdict, ageRedirectTarget, isAgeExempt, safeNext,
  sessionTokenFrom, REASON_UNDERAGE, REASON_AGE_REQUIRED, AGE_CHECK_PATH,
} from './ageGate.js';
import { ageCookieValue } from './ageCookie.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (r) => readFileSync(path.join(REPO, r), 'utf8');
const NOW = new Date(Date.UTC(2026, 9, 3, 15)); // 3 Oct 2026

test('the minimum age is 13', () => assert.equal(MIN_AGE, 13));

test('parseDob: a real past calendar date, else a typed refusal', () => {
  assert.deepEqual(parseDob({ month: '2', day: '28', year: '2001' }, NOW), { ok: true, iso: '2001-02-28' });
  assert.equal(parseDob({ month: '2', day: '29', year: '2001' }, NOW).reason, 'invalid', 'no 29 Feb in 2001');
  assert.equal(parseDob({ month: '2', day: '29', year: '2004' }, NOW).ok, true, 'leap day exists in 2004');
  assert.equal(parseDob({ month: '', day: '1', year: '2000' }, NOW).reason, 'incomplete');
  assert.equal(parseDob({}, NOW).reason, 'incomplete');
  assert.equal(parseDob({ month: '13', day: '1', year: '2000' }, NOW).reason, 'invalid');
  assert.equal(parseDob({ month: '1', day: '1', year: '1899' }, NOW).reason, 'invalid');
  assert.equal(parseDob({ month: '10', day: '4', year: '2026' }, NOW).reason, 'invalid', 'tomorrow is not a birthday');
});

test('ageOn is birthday-exact', () => {
  assert.equal(ageOn('2013-10-03', NOW), 13, 'the 13th birthday is today');
  assert.equal(ageOn('2013-10-04', NOW), 12, 'the 13th birthday is tomorrow');
  assert.equal(ageOn('1990-01-01', NOW), 36);
  assert.equal(ageOn(null, NOW), null);
});

test('judgeAnswer: 13 today passes, 12 refuses, and a refused browser refuses ANY date', () => {
  assert.deepEqual(judgeAnswer({ month: 10, day: 3, year: 2013 }, { now: NOW }), { ok: true, iso: '2013-10-03' });
  assert.equal(judgeAnswer({ month: 10, day: 4, year: 2013 }, { now: NOW }).reason, REASON_UNDERAGE);
  // THE BACK-BUTTON RETRY: an adult date from a blocked browser is still refused.
  assert.equal(judgeAnswer({ month: 1, day: 1, year: 1980 }, { blocked: true, now: NOW }).reason, REASON_UNDERAGE);
  assert.equal(judgeAnswer({ month: 2, day: 30, year: 1980 }, { now: NOW }).reason, 'invalid');
});

test('gateVerdict: NULL is "not asked yet" and refused; a stored 13+ date plays', () => {
  assert.deepEqual(gateVerdict(null, NOW), { ok: false, reason: REASON_AGE_REQUIRED });
  assert.deepEqual(gateVerdict({ date_of_birth: null }, NOW), { ok: false, reason: REASON_AGE_REQUIRED });
  assert.deepEqual(gateVerdict({ date_of_birth: '1990-05-01' }, NOW), { ok: true });
  assert.deepEqual(gateVerdict({ date_of_birth: '2013-10-03' }, NOW), { ok: true });
  // A row that should never exist (an under-13 date) still cannot play.
  assert.equal(gateVerdict({ date_of_birth: '2016-01-01' }, NOW).reason, REASON_UNDERAGE);
});

test('the proxy decision: signed-in page navigations only, bound to THIS session', () => {
  const tok = 'session-token-a';
  const mine = ageCookieValue(tok);
  const base = { method: 'GET', pathname: '/games', search: '', sessionToken: tok, expected: mine };
  // Signed out: never redirected - browsing stays open.
  assert.equal(ageRedirectTarget({ ...base, sessionToken: null }), null);
  // Unanswered session: to the check, carrying where it was going.
  assert.equal(ageRedirectTarget({ ...base, search: '?d=1', ageCookie: null }),
    `${AGE_CHECK_PATH}?next=${encodeURIComponent('/games?d=1')}`);
  // Passed: straight through.
  assert.equal(ageRedirectTarget({ ...base, ageCookie: mine }), null);
  // ANOTHER SESSION'S MARKER (a shared browser, a new sign-in) does not pass.
  assert.equal(ageRedirectTarget({ ...base, ageCookie: ageCookieValue('session-token-b') }).startsWith(AGE_CHECK_PATH), true);
  // A server action is a POST to a page path: it gates itself, never redirected.
  assert.equal(ageRedirectTarget({ ...base, method: 'POST' }), null);
  for (const p of ['/age', '/age/blocked', '/age/check', '/signin', '/signin/check-email', '/api/me', '/admin/x',
    '/terms', '/privacy', '/sim/account', '/favicon.ico', '/j/abc/opengraph-image', '/_next/static/x.js']) {
    assert.equal(isAgeExempt(p), true, `${p} is exempt`);
    assert.equal(ageRedirectTarget({ ...base, pathname: p }), null, `${p} is not redirected`);
  }
  for (const p of ['/', '/games', '/pickem', '/leagues/new', '/sim', '/scores', '/daily']) {
    assert.equal(isAgeExempt(p), false, `${p} is behind the screen for a signed-in, unanswered reader`);
  }
});

test('the marker is a hash of the token, never the token', () => {
  const v = ageCookieValue('abc');
  assert.match(v, /^[0-9a-f]{32}$/);
  assert.notEqual(v, 'abc');
  assert.equal(ageCookieValue(null), null);
  assert.equal(sessionTokenFrom((n) => (n === 'authjs.session-token' ? 't1' : undefined)), 't1');
  assert.equal(sessionTokenFrom((n) => (n === '__Secure-authjs.session-token' ? 't2' : undefined)), 't2');
  assert.equal(sessionTokenFrom(() => undefined), null);
});

test('safeNext: site-relative only, and never back to the screen itself', () => {
  assert.equal(safeNext('/pickem?x=1'), '/pickem?x=1');
  assert.equal(safeNext('//evil.com'), '/games');
  assert.equal(safeNext('https://evil.com'), '/games');
  assert.equal(safeNext('/\\evil.com'), '/games');
  assert.equal(safeNext('/age'), '/games');
  assert.equal(safeNext('/age/check?next=/x'), '/games');
  assert.equal(safeNext(undefined), '/games');
});

// ---------------------------------------------------------------------------
// THE SCREEN IS NEUTRAL (COPPA). Read the source that renders BEFORE the
// answer: the page and its form. No cutoff, no age wording, no preselection.
// ---------------------------------------------------------------------------
test('the DOB screen never states or hints at the cutoff, and preselects nothing', () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const f of ['app/age/page.js', 'app/age/AgeForm.js']) {
    const t = strip(src(f));
    assert.doesNotMatch(t, /MIN_AGE/, `${f} must not import the threshold`);
    assert.doesNotMatch(t, /(?<![0-9])1[38](?![0-9])/, `${f} must not print the cutoff (or the coming 18)`);
    assert.doesNotMatch(t, /years? old|old enough|\bunder\b|\bover\b|\bteen|\bchild|\bkids?\b|\badult|\bminimum|at least/i,
      `${f} must not word an age requirement`);
    assert.doesNotMatch(t, /defaultValue|selected=|\bchecked\b/, `${f} must not preselect an answer`);
  }
  const form = strip(src('app/age/AgeForm.js'));
  // Every picker opens on an empty placeholder: useState('') x3.
  assert.equal((form.match(/useState\(''\)/g) ?? []).length, 3, 'month, day and year all start empty');
  for (const ph of ['Month', 'Day', 'Year']) {
    assert.match(form, new RegExp(`<option value="" disabled>${ph}</option>`), `${ph} placeholder`);
  }
  // The year list is continuous from this year back - no gap at any age.
  assert.match(form, /length: thisYear - 1900 \+ 1/);
});

test('the refusal screen says the rule plainly, AFTER the answer', () => {
  const t = src('app/age/blocked/page.js');
  assert.match(t, /Sportsvyn is for ages \{MIN_AGE\} and up/);
  assert.doesNotMatch(t, /<form|AgeForm|signin/i, 'no second answer, no sign-in link');
});

// ---------------------------------------------------------------------------
// THE PROXY CLAUSE (proxy.js cannot be imported: next/server). Source checks.
// ---------------------------------------------------------------------------
test('proxy.js: the age clause runs only for a session, before the admin scope, from the pure decision', () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const t = strip(src('proxy.js'));
  assert.match(t, /const sessionToken = sessionTokenFrom\(/);
  assert.match(t, /if \(sessionToken\) \{\s*const ageDest = ageRedirectTarget\(/);
  assert.match(t, /method: request\.method/, 'the method reaches the decision (server actions are POSTs)');
  assert.ok(t.indexOf('ageRedirectTarget(') < t.indexOf('const isAdminPath'), 'the clause precedes the admin scope');
  // The matcher: one entry per session-cookie name, both `has` a cookie.
  const m = t.match(/matcher:\s*\[([\s\S]*?)\n  \],/)[1];
  for (const name of ['__Secure-authjs.session-token', 'authjs.session-token']) {
    assert.match(m, new RegExp(`has: \\[\\{ type: 'cookie', key: '${name.replace('.', '\\.')}' \\}\\]`), `matcher keyed on ${name}`);
  }
});
