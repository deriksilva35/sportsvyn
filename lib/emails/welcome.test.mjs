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
  assert.match(code, /events:\s*\{/, 'auth config must register events');
  assert.match(code, /createUser\(\{\s*user\s*\}\)/, 'the hook must exist and take the new user');
  assert.match(code, /await fireWelcomeEmail\(user\)/, 'and must await the entry point');

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
  assert.match(welcome, /\} catch \(e\) \{\s*\n\s*await record\(\{ ok: false, userId, outcome: 'failed'/,
    'sendWelcomeEmail catches everything, so awaiting it cannot fail a signup');
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
  assert.match(sender, /createHmac/, 'the link must be signed');
  assert.match(route, /createHmac/, 'the route must verify the signature');
  assert.match(route, /timingSafeEqual/, 'signature comparison must be constant time');
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

test('the welcome fires from the OTP INSERT branch, never on a returning sign-in', () => {
  const code = stripComments(src('lib/auth/emailOtp.js'));
  assert.match(code, /import \{ fireWelcomeEmail \}/, 'the OTP flow must import the sender');

  // Slice the create-or-resolve block and confirm the call sits on the side
  // that ran the INSERT, not the side that found an existing row.
  const start = code.indexOf('let user = (await sql`SELECT id FROM users');
  assert.ok(start > -1, 'the resolve/create block must still exist');
  const block = code.slice(start, start + 900);
  const insertAt = block.indexOf('INSERT INTO users');
  const elseAt = block.indexOf('} else {');
  const fireAt = block.indexOf('fireWelcomeEmail(');
  assert.ok(fireAt > insertAt, 'the send must come after the INSERT');
  assert.ok(fireAt < elseAt, 'the send must be INSIDE the create branch, not the existing-user branch');
});

test('the OTP site schedules the send too - BOTH creation sites, same fix', () => {
  // This also used to assert the floating shape. The magic-link path had the
  // identical hole: a Server Action on serverless is torn down at the response
  // just like a route handler, so its unsettled promise was discarded too. It
  // happened to work for user 18 the same way it happened to work for user 20 -
  // by luck, not by design.
  const code = stripComments(src('lib/auth/emailOtp.js'));
  assert.match(code, /await fireWelcomeEmail\(\{ id: user\.id, email: identifier \}\)/,
    'the OTP INSERT branch must await the entry point');
  // Still only on the INSERT branch - a returning sign-in must never re-welcome.
  const branch = code.slice(code.indexOf('INSERT INTO users'), code.indexOf('} else {'));
  assert.match(branch, /fireWelcomeEmail/, 'the send belongs to account creation');
});
