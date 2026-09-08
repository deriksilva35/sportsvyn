// lib/email/broadcastRules.test.mjs - the three refusals that keep a broadcast
// pointed at the right people, plus the wiring assertions that prove the script
// actually calls them (a guard that exists but is not called passes a unit test
// and ships the bug - same lesson as the launch-flow suite).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  databaseFingerprint,
  assertLiveTarget,
  validateTestRecipient,
} from './broadcastRules.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = readFileSync(path.join(REPO, 'scripts/broadcast.mjs'), 'utf8');
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const OWNERS = [
  'deriksilva@gmail.com',
  'derik@safetymanagers.com',
  'derik@sportsvyn.com',
  'deriksilva+welcome@gmail.com',
  'deriksilva+welcome2@gmail.com',
  'deriksilva@compsysllc.com',
  'derik@theskry.com',
];

// ---------------------------------------------------------------------------
// fingerprint
// ---------------------------------------------------------------------------

test('the PROD slug is recognised', () => {
  assert.equal(
    databaseFingerprint('postgresql://u:p@ep-winter-dawn-123.us-east-2.aws.neon.tech/db'),
    'PROD',
  );
});

test('anything else - including nothing at all - reads as DEV', () => {
  assert.equal(databaseFingerprint('postgresql://u:p@ep-summer-hill-9.aws.neon.tech/db'), 'DEV');
  assert.equal(databaseFingerprint(''), 'DEV');
  assert.equal(databaseFingerprint(undefined), 'DEV');
  assert.equal(databaseFingerprint(null), 'DEV');
});

// ---------------------------------------------------------------------------
// live target
// ---------------------------------------------------------------------------

test('a live send against DEV is refused', () => {
  assert.throws(() => assertLiveTarget('DEV'), /refusing --send against DEV/);
});

test('a live send against PROD proceeds', () => {
  assert.doesNotThrow(() => assertLiveTarget('PROD'));
});

// ---------------------------------------------------------------------------
// --to allowlist
// ---------------------------------------------------------------------------

test('every owner address is accepted, case-insensitively', () => {
  for (const o of OWNERS) {
    assert.equal(validateTestRecipient(o, OWNERS), o);
    assert.equal(validateTestRecipient(o.toUpperCase(), OWNERS), o.toLowerCase());
  }
});

test('an arbitrary address is refused - the override is not a side door', () => {
  for (const bad of [
    'sill.alison@yahoo.com',          // a real recipient from the roster
    'deriksilva@gmail.com.evil.com',  // suffix spoof
    'xderiksilva@gmail.com',          // prefix spoof
    'deriksilva+other@gmail.com',     // plus-tag not on the list
    '',
    undefined,
  ]) {
    assert.throws(() => validateTestRecipient(bad, OWNERS), /refused|requires/,
      `accepted ${bad}`);
  }
});

// ---------------------------------------------------------------------------
// wiring - the script must actually use these, in the right order
// ---------------------------------------------------------------------------

test('the script imports the rules rather than reimplementing them', () => {
  const t = stripComments(script);
  assert.match(t, /from '..\/lib\/email\/broadcastRules.js'/);
  assert.match(t, /assertLiveTarget\(/);
  assert.match(t, /validateTestRecipient\(/);
});

test('the DEV refusal fires for BOTH live paths - roster and test send', () => {
  const t = stripComments(script);
  // assertLiveTarget must run under the LIVE flag before any send loop, not
  // inside only one branch of it.
  // CALL SITES, NOT DEFINITIONS. testSend is defined above main, so its body
  // precedes the guard in source legitimately - what must follow the guard is
  // where main DISPATCHES to it. Same for the roster loop: the dry-run print
  // also iterates list, so the marker is the ledger check only the send loop
  // makes.
  const guard = t.indexOf('assertLiveTarget(');
  const rosterLoop = t.indexOf('alreadySent(r.id)');
  const testCall = t.indexOf('return testSend(');
  assert.ok(guard > -1 && rosterLoop > -1 && testCall > -1);
  assert.ok(guard < rosterLoop, 'roster send can run before the DEV refusal');
  assert.ok(guard < testCall, 'test send can be dispatched before the DEV refusal');
});

test('the test send is ledgered as a test, not as broadcast history', () => {
  const t = stripComments(script);
  assert.match(t, /kind:?\s*'test'|'test',/, 'test rows carry kind test');
  assert.match(t, /test:\s*true/, 'test rows carry test: true in summary');
});

test('the test send bypasses the typed count but not the postal/copy gates', () => {
  const t = stripComments(script);
  const testBlock = t.slice(t.indexOf('async function testSend'), t.indexOf('async function main'));
  assert.ok(testBlock.length > 0, 'no testSend function');
  assert.ok(!testBlock.includes('rl.question'), 'test send must not prompt for a count');
  const mainT = t.slice(t.indexOf('async function main'));
  const postalGate = mainT.indexOf('EMAIL_POSTAL_ADDRESS is required');
  const testCall = mainT.indexOf('return testSend(');
  assert.ok(postalGate > -1 && testCall > -1 && postalGate < testCall,
    'the CAN-SPAM postal gate must precede the test-send dispatch');
});

// ---------------------------------------------------------------------------
// render hardening - after Spark stripped the dark bg to white-on-white
// ---------------------------------------------------------------------------
// Asserted as source because render() lives in the script and the script opens
// a database on import. The three claims are exactly the three Spark failures.

// ---------------------------------------------------------------------------
// THE BULLETPROOF-DARK GUARDS NOW READ THE FILE THE SCRIPT SENDS.
// These used to grep broadcast.mjs for the dark table it built by hand after
// Spark stripped the first draft to white-on-white. The script no longer
// builds any HTML - it reads docs/email/launch-email-sep8.html from disk and
// substitutes one unsubscribe link - so the markup under guard is the file.
// The file is read here the same way the script reads it; nothing is
// rendered through the script, because the substitution does not touch any
// of these properties.
// ---------------------------------------------------------------------------
const LAUNCH_HTML = readFileSync(path.join(REPO, 'docs', 'email', 'launch-email-sep8.html'), 'utf8');

test('the sent HTML is the launch file, and the script builds no markup of its own', () => {
  const t = stripComments(script);
  assert.match(t, /launch-email-sep8\.html/, 'the script no longer names the launch file');
  assert.match(t, /readFileSync\(HTML_FILE\)/, 'the file is read from disk');
  assert.doesNotMatch(t, /<table role="presentation"|<p style=|<td bgcolor=/, 'the script is building HTML again');
});

test('the dark ground: what the launch file actually carries, stated exactly', () => {
  // WHAT SPARK TAUGHT: <body> styles are the first thing a client strips, so
  // a background that lives ONLY on <body> can vanish. The launch file's
  // ground is inline `background:` on <body>, the outer 100% table and the
  // 600px wrapper table - and a bgcolor ATTRIBUTE on the hero cell and the
  // CTA cell only. So the wrapper is NOT belt-and-braces the way the old
  // hand-built mail was. This test pins that construction so it cannot
  // silently get weaker; whether to harden the file is a design call on the
  // email, not on this script.
  assert.match(LAUNCH_HTML, /<body[^>]*style="[^"]*background:#000/, 'body ground');
  assert.match(LAUNCH_HTML, /<table[^>]*width="600"[^>]*style="[^"]*background:#0A0A0A/, '600px wrapper ground, inline');
  assert.match(LAUNCH_HTML, /<td[^>]*bgcolor="#0A0A0A"[^>]*style="[^"]*background-color:#0A0A0A/, 'hero cell: bgcolor attribute + inline');
  assert.doesNotMatch(LAUNCH_HTML, /<table[^>]*width="600"[^>]*bgcolor=/, 'if the wrapper gains a bgcolor attribute, update this pin - that is the hardening');
  assert.match(LAUNCH_HTML, /<meta name="color-scheme" content="dark">/);
});

test('no text element in the launch file relies on inherited color', () => {
  for (const m of LAUNCH_HTML.matchAll(/<p style="([^"]*)/g)) {
    assert.match(m[1], /color:#/, `a <p> without its own color: ${m[1].slice(0, 80)}`);
  }
  for (const m of LAUNCH_HTML.matchAll(/<a href=[^>]*style="([^"]*)/g)) {
    assert.match(m[1], /color:#/, `an <a> without its own color: ${m[1].slice(0, 80)}`);
  }
});

test('the CTA is a table cell with a background attribute, not a styled <a>', () => {
  // The construction Spark degraded was a background on the <a> itself.
  const i = LAUNCH_HTML.indexOf('<td align="center" bgcolor="#D4FF00"');
  assert.ok(i >= 0, 'CTA cell lost its bgcolor attribute');
  const cta = LAUNCH_HTML.slice(i, LAUNCH_HTML.indexOf('</td>', i));
  assert.match(cta, /<a href="https:\/\/sportsvyn\.com\/games"/, 'the CTA links the lobby');
  assert.ok(!/href[^>]*background/.test(cta), 'the button background moved back onto the <a>');
});

test('the unsubscribe link is the one placeholder the script substitutes, once', () => {
  assert.equal(LAUNCH_HTML.split('{{unsubscribe_url}}').length - 1, 1);
  assert.match(LAUNCH_HTML, /<a href="\{\{unsubscribe_url\}\}"[^>]*>Unsubscribe<\/a>/);
});

// ---------------------------------------------------------------------------
// the founder's verify copy - always sent, never counted
// ---------------------------------------------------------------------------

test('every live send delivers the owner verify copy, ledgered apart', () => {
  const t = stripComments(script);
  assert.match(t, /OWNER_VERIFY_ADDRESS = 'deriksilva@gmail.com'/);
  assert.match(t, /'owner-verify'/, 'its ledger kind must never read as audience history');
  // It fires inside the LIVE branch (after the typed count), before the loop.
  const confirm = t.indexOf('Confirmation did not match');
  const verify = t.indexOf('owner verify copy');
  const loop = t.indexOf('alreadySent(r.id)');
  assert.ok(confirm < verify && verify < loop,
    'verify goes first inside the live branch - it must not skip the typed count');
});

test('the verify copy never touches the recipient count', () => {
  const t = stripComments(script);
  const verifyBlock = t.slice(t.indexOf('owner verify copy'), t.indexOf('alreadySent(r.id)'));
  assert.ok(!/sent \+= 1|sent\+\+/.test(verifyBlock), 'uncounted means uncounted');
  assert.match(t, /sent \$\{sent\} \+ owner copy/, 'the report names the copy separately');
});

test('exclusion still owns the audience - the verify address stays on OWNER_ADDRESSES', () => {
  const t = stripComments(script);
  const owners = t.slice(t.indexOf('OWNER_ADDRESSES = ['), t.indexOf('];', t.indexOf('OWNER_ADDRESSES = [')));
  assert.ok(owners.includes("'deriksilva@gmail.com'"),
    'the verify copy is IN ADDITION to exclusion, not instead of it');
});
