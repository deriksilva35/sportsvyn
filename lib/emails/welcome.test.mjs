// lib/emails/welcome.test.mjs — the welcome send.
//
// Two classes of thing are pinned here, and both fail silently in production:
//
//   1. THE MAIL ITSELF. Copy register (hyphens only), the one CTA, and the
//      unsubscribe link. An email is the one artefact nobody can hotfix after
//      it lands in an inbox.
//   2. THE SAFETY PROPERTY. A mail vendor must never be able to fail a signup.
//      That is a structural claim about how the hook is called, so it is
//      asserted on source: the createUser event must NOT await the send.
//
// The send path itself touches the database, so its decision table is exercised
// against DEV in the session rather than here; what this file guards is
// everything that can be checked without one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWelcomeEmail } from './welcome.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const mail = () => buildWelcomeEmail({
  baseUrl: 'https://sportsvyn.com',
  unsubscribeUrl: 'https://sportsvyn.com/api/email/unsubscribe?u=42&t=abc',
});

// ---------------------------------------------------------------------------
// The mail
// ---------------------------------------------------------------------------

test('copy is hyphens only - no em or en dashes reach an inbox', () => {
  const { subject, text, html } = mail();
  for (const [what, s] of [['subject', subject], ['text', text], ['html', html]]) {
    assert.equal((s.match(/[—–]/g) ?? []).length, 0, `${what} contains an em or en dash`);
  }
});

test('there is exactly ONE call to action, and it points at the draft room', () => {
  const { text, html } = mail();
  assert.match(text, /https:\/\/sportsvyn\.com\/sim/, 'plaintext must carry the draft link');
  // One CTA button in the HTML - a second would split the one thing we ask for.
  // The label occurs ONCE: it lives inside the nested Outlook span, which is
  // itself inside the anchor, so the anchor contributes no second copy.
  const ctas = html.match(/Start your first mock draft/g) ?? [];
  assert.equal(ctas.length, 1, 'exactly one CTA label in the HTML');
  assert.equal((html.match(/<a href="https:\/\/sportsvyn\.com\/sim"/g) ?? []).length, 1,
    'exactly one anchor pointing at the draft room');
  assert.ok(!/Draft Pass|\$9\.99|upgrade/i.test(text + html),
    'the welcome mail must not sell - they have just arrived');
});

test('the four beats are present and the Tracker is mentioned once', () => {
  const { text } = mail();
  assert.match(text, /drafts against the market/i, 'what this is');
  assert.match(text, /Start your first mock draft/, 'what to do');
  assert.match(text, /Tracker/, 'draft night');
  assert.match(text, /Unsubscribe:/, 'a way out');
});

test('the unsubscribe link is present in BOTH parts, and is a real link', () => {
  const { text, html } = mail();
  assert.match(text, /Unsubscribe: https:\/\/sportsvyn\.com\/api\/email\/unsubscribe\?/);
  assert.match(html, /<a href="https:\/\/sportsvyn\.com\/api\/email\/unsubscribe\?[^"]*"[^>]*>\s*Unsubscribe\s*<\/a>/);
});

test('the HTML depends on nothing a mail client will strip', () => {
  const { html } = mail();
  assert.ok(!/<style/i.test(html), 'no <style> block - clients strip them');
  assert.ok(!/<link/i.test(html), 'no external stylesheet');
  assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(html), 'no remote fonts');
  assert.ok(!/display:\s*(flex|grid)/.test(html), 'no flex or grid - table layout only');
});

// ---------------------------------------------------------------------------
// The safety property
// ---------------------------------------------------------------------------

test('the createUser hook does not BLOCK on the mailer - but the work survives', () => {
  // THIS TEST USED TO ASSERT THE OPPOSITE, AND IT WAS WRONG.
  //
  // It pinned `!/await fireWelcomeEmail/` on the reasoning that awaiting would
  // re-couple signup to Resend. The intent was right; the mechanism it locked
  // in was a floating promise, and on a serverless runtime an unsettled promise
  // is discarded the moment the response is sent. On 2026-08-09 user 19 got no
  // welcome email and NO LEDGER ROW at all, while user 20 came through the same
  // Apple route four hours later and was fine. The test was green throughout -
  // it was pinning the defect as a requirement.
  //
  // The intent survives, enforced properly: fireWelcomeEmail registers the send
  // with after(), so the handler returns without waiting on the mail vendor AND
  // the platform keeps the invocation alive to finish it. The hook awaits the
  // entry point, which returns as soon as the work is scheduled - and which, in
  // the no-request-scope fallback, does the work inline rather than dropping it.
  const code = stripComments(src('auth.js'));
  // MOVED (age-gate, sat-2): creation no longer sends. The createUser hook
  // stays (provenance), and the awaited entry point now lives at the age
  // screen's passing answer - lib/auth/ageGateDb.js, pinned below.
  assert.match(code, /events:\s*\{/, 'auth config must register events');
  assert.match(code, /createUser\(\{\s*user\s*\}\)/, 'the hook must exist and take the new user');
  assert.doesNotMatch(code, /fireWelcomeEmail/, 'and must NOT send at creation');
  assert.match(stripComments(src('lib/auth/ageGateDb.js')), /welcome = await sendWelcome\(/,
    'the age screen awaits the entry point');

  // The thing that actually protects the signup is that the SEND is scheduled,
  // not inlined, when a request scope exists.
  const welcome = stripComments(src('lib/auth/welcomeEmail.js'));
  assert.match(welcome, /after\(\(\) => sendWelcomeEmail\(user\)\)/,
    'the send runs after the response, not during it');
  assert.ok(!/Promise\.resolve\(\)\s*\n?\s*\.then\(\(\) => sendWelcomeEmail/.test(welcome),
    'and never as a floating promise again');

  // And the promise that made the old shape defensible still holds: nothing in
  // the send path can throw into the caller.
  assert.match(welcome, /export async function sendWelcomeEmail/);
  assert.match(welcome, /\} catch \(e\) \{\s*\n\s*await recordFinish\(rowId, \{ ok: false, userId, outcome: 'failed'/,
    'sendWelcomeEmail catches everything, so awaiting it cannot fail a signup');
  // And the catch closes the OPEN row rather than opening a second one - a
  // mid-send crash must not leave both a 'sending' and a 'failed' for one user.
  assert.match(welcome, /catch \(e\) \{\s*\n\s*await recordFinish\(rowId,/);
});

test('the sender swallows everything and reports a reason instead of throwing', () => {
  const code = stripComments(src('lib/auth/welcomeEmail.js'));
  assert.match(code, /export async function sendWelcomeEmail/);
  assert.match(code, /catch\s*\(e\)\s*\{[\s\S]{0,200}return 'failed'/,
    'the outer catch must convert a throw into a reason');
  // Failures are recorded, not retried - by instruction.
  assert.match(code, /sync_runs/, 'failures must land in the ledger');
  assert.ok(!/setTimeout|retry|attempt\s*\+\+/i.test(code), 'no inline retry');
});

test('nothing sends unless the flag is explicitly on', () => {
  const code = stripComments(src('lib/auth/welcomeEmail.js'));
  assert.match(code, /WELCOME_EMAIL_ENABLED === '1'/,
    'the flag must be an explicit opt-in, not a truthiness check');
});

test('the unsubscribe link is signed, and the route verifies it', () => {
  const sender = stripComments(src('lib/auth/welcomeEmail.js'));
  const route = stripComments(src('app/api/email/unsubscribe/route.js'));
  const signer = stripComments(src('lib/email/linkSecret.js'));
  assert.match(sender, /const token = unsubscribeToken\(userId\)/, 'the link must be signed');
  assert.match(route, /const ok = verifyUnsubscribe\(u, t\)/, 'the route must verify the signature');
  assert.match(signer, /createHmac\('sha256', secret\)/, 'signed with HMAC');
  assert.match(signer, /timingSafeEqual/, 'signature comparison must be constant time');
  // ONE secret, set on both sides, with no fallback to the app secret: the
  // droplet's copy of the app secret did not match production, and every link
  // in the 8 Sep launch email failed to verify.
  assert.match(signer, /process\.env\.EMAIL_LINK_SECRET/);
  for (const f of [sender, route, signer]) assert.doesNotMatch(f, /NEXTAUTH_SECRET|AUTH_SECRET|dev-only/, 'no fallback secret signs an email link');
  // Idempotent: a second click must not move the recorded opt-out time.
  assert.match(route, /COALESCE\(email_opted_out_at, now\(\)\)/,
    'when they said no is worth preserving');
});

// ---------------------------------------------------------------------------
// THE LEDGER TELLS THE WHOLE TRUTH
//
// The first production magic-link signup delivered no mail and left NO ledger
// row, because 'disabled' and 'opted-out' returned silently. That made "the
// flag is off" and "the hook never fired" produce identical evidence - nothing -
// and the diagnosis had to be read out of the source. Silence in that table must
// mean exactly one thing: the code never ran.
// ---------------------------------------------------------------------------

test('every return path in sendWelcomeEmail records an outcome first', () => {
  const code = stripComments(src('lib/auth/welcomeEmail.js'));
  const body = code.slice(code.indexOf('export async function sendWelcomeEmail'));
  // Each outcome string must appear in a record({...outcome:'x'}) call as well
  // as in a return - a return without a matching record is a silent path.
  for (const outcome of ['disabled', 'no-email', 'opted-out', 'sent', 'failed']) {
    assert.ok(new RegExp(`outcome: '${outcome}'`).test(body),
      `'${outcome}' must be written to the ledger, not just returned`);
  }
  assert.ok(!/^\s*if \(!welcomeEmailEnabled\(\)\) return/m.test(body),
    'the disabled path must record before returning');
});

// ---------------------------------------------------------------------------
// THE MAGIC-LINK TRIGGER
//
// This repo's OTP flow writes the user row itself and never calls the adapter,
// so Auth.js's events.createUser cannot fire on it. The send is therefore
// triggered from the INSERT branch - and ONLY that branch, or every sign-in
// would re-send.
// ---------------------------------------------------------------------------

test('NO WELCOME AT CREATION: the OTP INSERT branch and the createUser event never send', () => {
  // These two tests used to pin the send INTO both creation sites. Since the
  // age gate (sat-2) creation is the wrong moment: an under-13 sign-up would be
  // mailed before the screen deletes it. The send now belongs to the age
  // screen's passing answer, for a NEW account only (lib/auth/ageGateDb.js;
  // behaviour pinned against DEV in lib/auth/ageGateDb.test.mjs).
  const otp = stripComments(src('lib/auth/emailOtp.js'));
  assert.match(otp, /INSERT INTO users/, 'the OTP flow still creates the account');
  assert.doesNotMatch(otp, /fireWelcomeEmail|sendWelcomeEmail|welcomeEmail/, 'and sends nothing');
  assert.doesNotMatch(stripComments(src('auth.js')), /fireWelcomeEmail|sendWelcomeEmail/);
});

test('the age screen sends it: only on the write that stored the date, only for a NEW account', () => {
  const gate = stripComments(src('lib/auth/ageGateDb.js'));
  const fn = gate.slice(gate.indexOf('export async function applyAnswer'), gate.indexOf('export async function accountFacts'));
  const wrote = fn.indexOf('RETURNING id');
  const isNew = fn.indexOf('isNewAccount(createdAt, now)) welcome = await sendWelcome(');
  const underage = fn.indexOf('REASON_UNDERAGE');
  assert.ok(wrote > -1 && isNew > wrote, 'after the UPDATE that wrote, gated on isNewAccount');
  assert.ok(isNew < underage, 'on the passing branch, before any refusal path');
  assert.match(gate, /export const FRESH_ACCOUNT_MS = 24 \* 60 \* 60 \* 1000;/, '"new" is 24 hours, pinned');
});
