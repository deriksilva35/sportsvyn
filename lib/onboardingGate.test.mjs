// lib/onboardingGate.test.mjs - userHasHandle answers its own name.
//
// THE DEFECT (6-9 Sep 2026): needsOnboarding moved to `onboarded_at == null`
// (2718e30) while userHasHandle kept returning !needsOnboarding(row) over a
// row it had SELECTed only `handle` from. onboarded_at was undefined on every
// row it saw, so every signed-in user - 168 of them with handles - was gated
// into a claim modal whose action would have renamed them.
//
// PURE: sql is injected, so the row is whatever the test says it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { userHasHandle, needsOnboarding } from './onboarding.js';
import { refuseClaimOverExisting } from './daily/handles.js';

// A tagged-template stand-in that returns the given rows for any query, and
// records that it was asked - so a test can also prove the gate SELECTs.
const fakeSql = (rows) => { const f = () => Promise.resolve(rows); f.calls = 0; return new Proxy(f, { apply(t, th, a) { t.calls++; return t(...a); } }); };

test('a user WITH a handle and NULL onboarded_at is NOT gated', async () => {
  // Exactly the row the gate's own SELECT produces: handle only.
  assert.equal(await userHasHandle(1, fakeSql([{ handle: 'sportsvyn_og' }])), true);
  // And the full row, onboarded or not - the gate must not care.
  assert.equal(await userHasHandle(1, fakeSql([{ handle: 'sportsvyn_og', onboarded_at: null }])), true);
  assert.equal(await userHasHandle(1, fakeSql([{ handle: 'sportsvyn_og', onboarded_at: '2026-09-06' }])), true);
});

test('a user with NO handle IS gated, onboarded or not', async () => {
  assert.equal(await userHasHandle(2, fakeSql([{ handle: null }])), false);
  assert.equal(await userHasHandle(2, fakeSql([{ handle: null, onboarded_at: '2026-09-06' }])), false,
    'being onboarded does not conjure a handle');
});

test('signed out, or no row, is not gated (the gate is for accounts, sign-in is elsewhere)', async () => {
  assert.equal(await userHasHandle(null, fakeSql([])), true);
  assert.equal(await userHasHandle(99, fakeSql([])), true);
});

test('the sheet still asks its own question: onboarded_at, not handle', () => {
  assert.equal(needsOnboarding({ handle: 'x', onboarded_at: null }), true);
  assert.equal(needsOnboarding({ handle: null, onboarded_at: '2026-09-06' }), false);
});

test('a claim over an existing handle is refused and names the handle kept', () => {
  const r = refuseClaimOverExisting({ handle: 'sportsvyn_og' });
  assert.equal(r.ok, false); assert.equal(r.reason, 'has_handle'); assert.equal(r.handle, 'sportsvyn_og');
  assert.match(r.message, /@sportsvyn_og/); assert.match(r.message, /not changed/);
  assert.equal(refuseClaimOverExisting({ handle: null }), null);
  assert.equal(refuseClaimOverExisting(null), null);
});

test('claimHandle refuses before writing; renameHandle owns the cooldown (source guard)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../app/actions/handle.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const claim = src.slice(src.indexOf('export async function claimHandle'), src.indexOf('export async function renameHandle'));
  assert.match(claim, /refuseClaimOverExisting\(me\)/, 'claimHandle consults the refusal');
  assert.doesNotMatch(claim, /canRename|renameAvailableAt/, 'claimHandle has no rename branch');
  const rename = src.slice(src.indexOf('export async function renameHandle'), src.indexOf('async function writeHandle'));
  assert.match(rename, /canRename\(me\.handle_changed_at\)/, 'the cooldown lives in renameHandle');
  assert.equal((src.match(/UPDATE users SET handle =/g) ?? []).length, 1, 'one write, shared');
});
