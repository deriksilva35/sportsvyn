// lib/auth/adapterPath.test.mjs - two defects on the Apple adapter path, both
// found in production on 2026-08-09, both invisible until somebody counted rows.
//
//   1. User 19 got no welcome email AND NO LEDGER ROW. User 20 came through the
//      same route four hours later and was fine.
//   2. Both were labelled first_seen_context 'apple:web'. So was every other
//      Apple account. 'apple:shell' was not merely rare - it was unreachable.
//
// They share a cause in the sense that both were killed by the shape of the
// Apple callback request, but the mechanisms are different and so are the
// fixes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callbackUrlIsShell } from './firstSeen.js';
import { BLOCKING_OUTCOMES, STUCK_AFTER_MINUTES } from './welcomeEmail.js';
import { shellSigninHref } from '../shell/signinHref.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const welcome = stripComments(src('lib/auth/welcomeEmail.js'));
const firstSeen = stripComments(src('lib/auth/firstSeen.js'));

// ---------------------------------------------------------------------------
// DEFECT 1 - the work did not survive the response
// ---------------------------------------------------------------------------

test('THE FLOATING PROMISE IS GONE', () => {
  // `Promise.resolve().then(...)` with nothing awaiting it is fine on a
  // long-lived server and fatal on a serverless one: once the response is sent
  // the invocation can be frozen, and an unsettled promise is discarded. No
  // email, no ledger row, no error - the work never resumes to report it did
  // not happen. That is user 19.
  assert.ok(!/Promise\.resolve\(\)\s*\n?\s*\.then\(\(\) => sendWelcomeEmail/.test(welcome),
    'the fire-and-forget shape must not come back');
  assert.match(welcome, /after\(\(\) => sendWelcomeEmail\(user\)\)/,
    'the send is registered with after(), which keeps the invocation alive for it');
});

test('the fallback is INLINE, never floating', () => {
  // Outside a request scope - a script, a test, a runtime without after - the
  // work is awaited. sendWelcomeEmail cannot throw, so awaiting it can never
  // fail a signup; a slower signup is a cost, a silently dropped one is a defect.
  const fn = welcome.slice(welcome.indexOf('export async function fireWelcomeEmail'));
  assert.match(fn, /catch \{\s*\n\s*return sendWelcomeEmail\(user\);/);
  assert.match(fn, /export async function fireWelcomeEmail/, 'the caller can await it');
});

test('the hook AWAITS the entry point, so the fallback actually runs', () => {
  // With fireWelcomeEmail now async, a bare call would reintroduce exactly the
  // floating promise this fix removed - just one layer further out.
  const auth = stripComments(src('auth.js'));
  assert.match(auth, /await fireWelcomeEmail\(user\)/,
    'the createUser event must await it');
  assert.ok(!/^\s*fireWelcomeEmail\(user\);/m.test(auth), 'and never call it bare');
});

test('A REPLAY CANNOT DOUBLE-SEND - the backfill guard', () => {
  // Required before any backfill for user 19: sending somebody a second copy of
  // a welcome email is worse than the miss it would be repairing.
  assert.match(welcome, /export async function alreadySent\(userId\)/);
  assert.match(welcome, /summary->>'outcome' = ANY\(\$\{BLOCKING_OUTCOMES\}::text\[\]\)/,
    "keyed on the blocking outcomes - a prior 'disabled' or 'failed' is a reason to retry");
  assert.match(welcome, /if \(await alreadySent\(userId\)\) return 'already-sent';/);
  // The check runs BEFORE the enabled flag, so a replay is safe whatever the
  // flags happen to be.
  const body = welcome.slice(welcome.indexOf('export async function sendWelcomeEmail'));
  assert.ok(body.indexOf('alreadySent') < body.indexOf('welcomeEmailEnabled'),
    'idempotency is checked first');
});

test('a failed idempotency read REFUSES rather than risking a duplicate', () => {
  const fn = welcome.slice(welcome.indexOf('export async function alreadySent'), welcome.indexOf('export async function sendWelcomeEmail'));
  assert.match(fn, /return true;/, 'unreadable history means do not send');
});

// ---------------------------------------------------------------------------
// DEFECT 2 - the surface signal did not survive Apple
// ---------------------------------------------------------------------------

test('THE SHELL MARKER RIDES INSIDE THE CALLBACK URL', () => {
  // Apple posts back cross-site, so the SameSite=Lax sv_shell cookie is absent
  // in the one request where the account is created. The callback-url cookie
  // is the thing auth.js already relaxed to SameSite=None+Secure to survive
  // that POST, so that is where the marker has to be.
  const href = shellSigninHref('/sim', true);
  assert.equal(href, '/signin?callbackUrl=%2Fsim%3Fshell%3Dsim-app&shell=sim-app');
  // Both placements, and they are not the same thing: the sibling param makes
  // the sign-in PAGE render as the app; the encoded one survives Apple.
  const params = new URLSearchParams(href.slice(href.indexOf('?') + 1));
  assert.equal(params.get('shell'), 'sim-app', 'sibling param for the page');
  assert.equal(params.get('callbackUrl'), '/sim?shell=sim-app', 'and inside the value');
});

test('the web link is untouched - no marker, no encoding surprises', () => {
  assert.equal(shellSigninHref('/sim', false), '/signin?callbackUrl=%2Fsim');
  assert.equal(shellSigninHref('/sim/tracker', false), '/signin?callbackUrl=%2Fsim%2Ftracker');
  assert.ok(!shellSigninHref('/sim', false).includes('shell'));
});

test('a destination that already has a query keeps it', () => {
  const href = shellSigninHref('/sim/draft/12?tab=board', true);
  const cb = new URLSearchParams(href.slice(href.indexOf('?') + 1)).get('callbackUrl');
  assert.equal(cb, '/sim/draft/12?tab=board&shell=sim-app');
});

test('the callbackUrl is PARSED, not substring-matched', () => {
  // 'sim-app' appearing anywhere in a path must not be read as the marker.
  assert.equal(callbackUrlIsShell('/sim?shell=sim-app'), true);
  assert.equal(callbackUrlIsShell('%2Fsim%3Fshell%3Dsim-app'), true, 'cookie values arrive encoded');
  assert.equal(callbackUrlIsShell('https://sportsvyn.com/sim?shell=sim-app'), true, 'absolute too');
  assert.equal(callbackUrlIsShell('/articles/why-sim-app-is-good'), false, 'a path is not a marker');
  assert.equal(callbackUrlIsShell('/sim?shell=other'), false);
  assert.equal(callbackUrlIsShell('/sim'), false);
  assert.equal(callbackUrlIsShell(''), false);
  assert.equal(callbackUrlIsShell(null), false);
  assert.equal(callbackUrlIsShell('%%%broken'), false, 'a bad escape must not throw');
});

test('the cookie is still the PRIMARY signal; the callbackUrl is a fallback', () => {
  // Ordinary same-site signups must be unaffected by any of this.
  const fn = firstSeen.slice(firstSeen.indexOf('export async function resolveSurface'));
  const cookieAt = fn.indexOf('SHELL_COOKIE');
  const cbAt = fn.indexOf('callback-url');
  assert.ok(cookieAt > -1 && cbAt > cookieAt, 'the shell cookie is checked first');
  assert.match(fn, /if \(jar\.get\(SHELL_COOKIE\)\?\.value === SHELL_VALUE\) return SURFACE_SHELL;/);
});

test('both callback-url cookie names are read', () => {
  // Auth.js prefixes with __Secure- on HTTPS deployments and not otherwise.
  const fn = firstSeen.slice(firstSeen.indexOf('export async function resolveSurface'));
  assert.match(fn, /__Secure-authjs\.callback-url/);
  assert.match(fn, /'authjs\.callback-url'/);
});

test('resolveSurface still cannot throw', () => {
  // A signup must not fail because we could not label it.
  const fn = firstSeen.slice(firstSeen.indexOf('export async function resolveSurface'), firstSeen.indexOf('export function callbackUrlIsShell'));
  assert.match(fn, /catch \{\s*\n\s*return SURFACE_WEB;/);
});

// ---------------------------------------------------------------------------
// Set-once is NOT weakened
// ---------------------------------------------------------------------------

test('markFirstSeen still writes only where the column IS NULL', () => {
  // Neither fix touches this. A corrected label for users 19 and 20 would be a
  // deliberate, provable one-off - not something the code does on its own.
  assert.match(firstSeen, /first_seen_context IS NULL/);
  assert.ok(!/SET first_seen_context = \$\{context\}\s*WHERE id = \$\{userId\}\s*RETURNING/.test(firstSeen));
});

// ---------------------------------------------------------------------------
// THE LEDGER INVERSION - record before sending
// ---------------------------------------------------------------------------
//
// The send-then-record ordering cost a real user a duplicate. User 19's mail
// went out on 2026-08-09 and the row that should have followed it never landed;
// four days later the gap read as "the hook never ran", a replay was fired, and
// they got a second copy. The Resend dashboard settled it - two deliveries, one
// ledger row, the older one timestamped to the exact minute of signup.

test('THE ROW OPENS BEFORE THE VENDOR IS CALLED', () => {
  const fn = welcome.slice(welcome.indexOf('export async function sendWelcomeEmail'));
  const opened = fn.indexOf('rowId = await recordStart(userId)');
  const sent = fn.indexOf('resend.emails.send');
  assert.ok(opened > -1, 'recordStart must be called');
  assert.ok(sent > -1, 'the send must be there');
  assert.ok(opened < sent, 'the ledger row must exist BEFORE the mail is handed over');
});

test("a decision NOT to send closes in one write - no spurious 'sending' row", () => {
  // disabled / no-email / opted-out never touch a vendor, so opening a row for
  // them would leave a 'sending' that blocks a legitimate later retry.
  const fn = welcome.slice(welcome.indexOf('export async function sendWelcomeEmail'), welcome.indexOf('export async function fireWelcomeEmail'));
  for (const outcome of ['disabled', 'no-email', 'opted-out']) {
    const re = new RegExp(`recordFinish\\(null, \\{ ok: false, userId, outcome: '${outcome}'`);
    assert.match(fn, re, `${outcome} closes immediately with no open row`);
  }
});

test("A STUCK 'sending' ROW BLOCKS A REPLAY", () => {
  // The whole inversion. A row that never closed might be a delivered mail that
  // lost its acknowledgement, so it is treated as sent rather than retried.
  assert.deepEqual(BLOCKING_OUTCOMES, ['sent', 'sending']);
  assert.match(welcome, /summary->>'outcome' = ANY\(\$\{BLOCKING_OUTCOMES\}::text\[\]\)/);
  // 'disabled' and 'failed' are deliberately NOT blocking - both are reasons to
  // try again.
  assert.ok(!BLOCKING_OUTCOMES.includes('disabled'));
  assert.ok(!BLOCKING_OUTCOMES.includes('failed'));
});

test('the failure mode inverted to the SAFE direction', () => {
  // Old: sent-but-unrecorded - invisible, and it invites a duplicate because
  // the duplicate guard reads the ledger.
  // New: recorded-but-possibly-unsent - visible, countable, and it refuses.
  assert.ok(!/await resend\.emails\.send[\s\S]{0,400}?await record\(\{ ok: true/.test(welcome),
    'the old send-then-record ordering must not come back');
  assert.match(welcome, /async function recordStart\(userId\)/);
  assert.match(welcome, /async function recordFinish\(id, \{/);
});

test('the Resend message id is stored, so delivery is answerable from the ledger', () => {
  // The duplicate was finally diagnosed from a phone screenshot of a vendor
  // dashboard. That should not have been the only way to know.
  assert.match(welcome, /messageId: res\?\.data\?\.id \?\? null/);
  assert.match(welcome, /\.\.\.\(messageId \? \{ messageId \} : \{\}\)/,
    'and omitted rather than written as null when there is none');
});

test('a ledger that is DOWN still records the outcome, out of order', () => {
  // recordStart returning null must not swallow the result - one row is better
  // than none.
  const fn = welcome.slice(welcome.indexOf('async function recordFinish'), welcome.indexOf('export const BLOCKING_OUTCOMES'));
  assert.match(fn, /if \(id == null\) \{/);
  assert.match(fn, /INSERT INTO sync_runs/, 'falls back to a terminal insert');
});

test('the stuck threshold is short, because a send is one round trip', () => {
  assert.equal(STUCK_AFTER_MINUTES, 10);
  assert.match(welcome, /started_at < now\(\) - make_interval\(mins => \$\{STUCK_AFTER_MINUTES\}\)/);
});

test('the ledger is actually READ somewhere - counts are useless unseen', () => {
  // Nothing read this table before. The cost of that was four days of not
  // noticing a user had been missed.
  assert.match(welcome, /export async function welcomeLedgerSummary/);
  const admin = stripComments(src('app/admin/signups/page.js'));
  assert.match(admin, /import \{ welcomeLedgerSummary \} from '@\/lib\/auth\/welcomeEmail'/);
  assert.match(admin, /await welcomeLedgerSummary\(\)\.catch\(\(\) => null\)/,
    'and a ledger read must never take the admin page down');
  assert.match(admin, /\{ledger && <WelcomeLedger ledger=\{ledger\} \/>\}/);
});

test('the report surfaces BOTH gap kinds, and they mean different things', () => {
  // STUCK: opened and never closed - may or may not have been delivered.
  // MISSING: no row at all - the hook did not fire, the original defect.
  assert.match(welcome, /summary->>'outcome' = 'sending'/, 'stuck query');
  assert.match(welcome, /NOT EXISTS \(\s*\n?\s*SELECT 1 FROM sync_runs s/, 'missing query');
  const admin = stripComments(src('app/admin/signups/page.js'));
  assert.match(admin, /Stuck at sending over/);
  assert.match(admin, /Users with no ledger row/);
  assert.match(admin, /clean \? 'no gaps'/, 'the daily question is "is it zero"');
});
