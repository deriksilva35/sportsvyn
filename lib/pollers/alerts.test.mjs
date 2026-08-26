// lib/pollers/alerts.test.mjs - the alert dedupe.
//
// NOTHING HERE CALLS maybeAlert. Stubbing `sql` does not stub the mailer, and
// that mistake put roughly twenty real emails in Derik's inbox once already.
// The fingerprint is pure and tested directly; the database path is pinned by
// reading the source, which is the same discipline alertSummary got.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { alertFingerprint, alertSummary, ALERT_DETAIL_CAP } from './alerts.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

// A real refusal payload, the shape describeRefusal emits.
const REFUSALS = [
  { slug: 'georgia-vs-alabama', kept: '2025-09-27T23:30:00.000Z', refused: '2025-09-27T19:30:00.000Z', delta_hours: -4 },
  { slug: 'lsu-vs-ole-miss', kept: '2025-09-27T20:00:00.000Z', refused: '2025-09-27T16:00:00.000Z', delta_hours: -4 },
];
const ALERT = { subject: '[pollers] cfb REFUSED 2 kickoff revision(s)', body: 'source: cfb\n...', detail: REFUSALS };

test('the same condition on a later tick fingerprints identically', () => {
  // The kickoff guard refusing the same games by the same deltas five minutes
  // later is the case this exists for.
  assert.equal(alertFingerprint(ALERT), alertFingerprint({ ...ALERT }));
});

test('any real change to the payload changes the fingerprint', () => {
  const base = alertFingerprint(ALERT);
  assert.notEqual(base, alertFingerprint({ ...ALERT, subject: '[pollers] cfb REFUSED 3 kickoff revision(s)' }));
  assert.notEqual(base, alertFingerprint({ ...ALERT, body: 'source: cfb\nsomething else' }));
  // A ninth game joining the refusal list must reach the inbox.
  assert.notEqual(base, alertFingerprint({ ...ALERT,
    detail: [...REFUSALS, { slug: 'utah-vs-byu', kept: 'a', refused: 'b', delta_hours: -5 }] }));
  // Same games, different delta - a different fact about the slate.
  assert.notEqual(base, alertFingerprint({ ...ALERT,
    detail: [{ ...REFUSALS[0], delta_hours: -5 }, REFUSALS[1]] }));
});

test('THE BODY IS IN THE FINGERPRINT - two outages are not one alert', () => {
  // Most callers send no detail, and their subject is a constant: every failure
  // of the CFB poller is "[pollers] cfb FAILED". On subject alone, a second and
  // unrelated outage would be silently swallowed as a duplicate.
  const subject = '[pollers] cfb FAILED';
  assert.notEqual(
    alertFingerprint({ subject, body: 'source: cfb\n\nCFBD 503' }),
    alertFingerprint({ subject, body: 'source: cfb\n\nconnection reset' }),
    'different failures must still be able to reach the inbox');
});

test('the fingerprint covers the CAPPED detail, i.e. what actually gets stored', () => {
  // Two alerts that persist a byte-identical row must not carry different
  // fingerprints - past the cap the stored detail is the same 25 entries.
  const many = (n) => Array.from({ length: n }, (_, i) => ({ slug: `g${i}`, kept: 'a', refused: 'b', delta_hours: -4 }));
  const a = { subject: 's', body: 'b', detail: many(ALERT_DETAIL_CAP + 5) };
  const b = { subject: 's', body: 'b', detail: [...many(ALERT_DETAIL_CAP), ...many(3)] };
  assert.deepEqual(alertSummary(a).detail, alertSummary(b).detail, 'precondition: same stored detail');
  assert.equal(alertFingerprint(a), alertFingerprint(b));
});

test('a bare alert with no detail still fingerprints', () => {
  assert.match(alertFingerprint({ subject: 's', body: 'b' }), /^[0-9a-f]{16}$/);
  assert.equal(alertFingerprint({ subject: 's', body: 'b' }),
               alertFingerprint({ subject: 's', body: 'b', detail: null }));
  assert.equal(alertFingerprint({ subject: 's', body: 'b', detail: [] }),
               alertFingerprint({ subject: 's', body: 'b', detail: null }),
               'an empty list stores no detail key, so it must match null');
});

// ------------------------------------------------------- the database path

test('a repeat KEEPS the ledger row and suppresses only the email', () => {
  const a = src('lib/pollers/alerts.js');
  const dup = a.slice(a.indexOf('if (prior.fingerprint'), a.indexOf("reason: 'duplicate_payload'"));
  assert.match(dup, /UPDATE sync_runs/, 'the row is kept and updated');
  assert.match(dup, /'repeats'/);
  assert.match(dup, /'lastRepeatAt'/);
  assert.doesNotMatch(dup, /resend|emails\.send/, 'the repeat path must not mail');
  // And it returns before the send, distinguishably from the blunt window guard.
  assert.match(a, /return \{ sent: false, reason: 'duplicate_payload', repeats: prior\.repeats \+ 1 \};/);
});

test('the repeat is COUNTED on one row, not inserted as a new one each tick', () => {
  // plays-live runs every minute; an afternoon-long condition would otherwise
  // write a few hundred near-identical rows into the table forensics scan.
  const a = src('lib/pollers/alerts.js');
  const dup = a.slice(a.indexOf('if (prior.fingerprint'), a.indexOf("reason: 'duplicate_payload'"));
  assert.doesNotMatch(dup, /INSERT INTO sync_runs/);
  assert.match(dup, /WHERE id = \$\{prior\.id\}/, 'updates the row it matched');
});

test('the jsonb merge is TOP-LEVEL, so detail survives and nothing appends', () => {
  // `||` is shallow and appends to arrays. summary is an object and both keys
  // written are top-level, so the sibling `detail` key is untouched - the
  // final_seen_at wipe was this operator used one level deeper.
  const a = src('lib/pollers/alerts.js');
  const dup = a.slice(a.indexOf('if (prior.fingerprint'), a.indexOf("reason: 'duplicate_payload'"));
  assert.match(dup, /summary = summary \|\| jsonb_build_object\(/);
  assert.doesNotMatch(dup, /summary->'detail'/, 'the merge must not reach into detail at all');
});

test('a DIFFERENT payload inside the window is still rate-limited, unchanged', () => {
  const a = src('lib/pollers/alerts.js');
  assert.match(a, /\/\/ A DIFFERENT payload inside the window is still rate-limited, unchanged\.[\s\S]{0,200}?return \{ sent: false, reason: 'rate_limited' \};/);
});

test('the fingerprint is persisted, or the next tick cannot compare against it', () => {
  const a = src('lib/pollers/alerts.js');
  assert.match(a, /const summary = \{ \.\.\.alertSummary\(\{ subject, detail \}\), fingerprint \};/);
  assert.match(a, /summary->>'fingerprint' AS fingerprint/);
  // The window lookup must take the LATEST row, not an arbitrary one.
  assert.match(a, /ORDER BY started_at DESC\s*\n\s*LIMIT 1/);
});
