// lib/stripeWebhookGuard.test.mjs - the livemode guard on the Stripe webhook.
//
// WHY IT EXISTS. There is ONE registered endpoint URL and BOTH Stripe modes
// point at it - https://sportsvyn.com/api/stripe/webhook is enabled in test and
// in live. A test-mode checkout therefore fires a signed, authentic webhook at
// production, and the signature check cannot help: the event is genuine, it is
// just from the wrong world. Without the guard, walking the purchase flow with
// a 4242 card writes a real membership row for whatever client_reference_id it
// carries.
//
// The route cannot be imported under node --test (the @/ alias is a Next build
// concern - same constraint as cronWiring.test.mjs), so the wiring is asserted
// on source and the decision itself is reimplemented and exercised.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(REPO, 'app/api/stripe/webhook/route.js'), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = stripComments(src);

// The predicate exactly as the route states it.
const ignores = (livemode, envValue) => {
  const allowTest = envValue === 'true';
  return !livemode && !allowTest;
};

test('a TEST event is ignored when the env has not opted in', () => {
  assert.equal(ignores(false, undefined), true, 'absent variable guards');
  assert.equal(ignores(false, ''), true);
  assert.equal(ignores(false, 'false'), true);
  assert.equal(ignores(false, '1'), true, 'only the exact string true opts in');
  assert.equal(ignores(false, 'TRUE'), true, 'and it is case-sensitive');
});

test('a TEST event is processed when the env DID opt in', () => {
  assert.equal(ignores(false, 'true'), false);
});

test('a LIVE event is NEVER ignored, whatever the variable says', () => {
  // Production must not be able to switch off real revenue by misconfiguration.
  for (const v of [undefined, '', 'false', 'true', 'nonsense']) {
    assert.equal(ignores(true, v), false, `livemode wins over env=${String(v)}`);
  }
});

test('THE GUARD OPTS IN, IT DOES NOT OPT OUT', () => {
  // A guard that must be switched ON in production is one deploy away from
  // being off. The absence of the variable has to be the safe state.
  assert.match(code, /const allowTest = process\.env\.STRIPE_ALLOW_TEST_EVENTS === 'true';/);
  assert.match(code, /if \(!event\.livemode && !allowTest\)/);
  assert.ok(!/STRIPE_BLOCK_TEST_EVENTS|DISABLE_TEST/.test(code), 'no opt-out spelling');
});

test('it runs AFTER signature verification and BEFORE any handler', () => {
  const verify = code.indexOf('verifyWebhookSignature');
  const parse = code.indexOf('JSON.parse(rawBody)');
  const guard = code.indexOf('if (!event.livemode && !allowTest)');
  const dispatch = code.indexOf('switch (event.type)');
  assert.ok(verify > -1 && parse > verify, 'parse follows verification');
  assert.ok(guard > parse, 'the guard needs the parsed event');
  assert.ok(guard < dispatch, 'and nothing dispatches before it');
});

test('IGNORED IS ACKNOWLEDGED, NOT REJECTED', () => {
  // A 4xx would leave Stripe retrying test events against production for days.
  const block = code.slice(code.indexOf('if (!event.livemode'), code.indexOf('switch (event.type)'));
  assert.match(block, /return Response\.json\(\{ ignored: 'test event'/);
  assert.ok(!/status: 4\d\d/.test(block), 'never a 4xx');
});

test('and it is LOGGED, because silence looks identical to nothing happening', () => {
  const block = code.slice(code.indexOf('if (!event.livemode'), code.indexOf('switch (event.type)'));
  assert.match(block, /console\.log\('\[stripe-webhook\] ignored test-mode event', \{ id: event\.id, type: event\.type \}\)/);
});

test('nothing else about the handler changed', () => {
  for (const t of ['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted']) {
    assert.ok(code.includes(`case '${t}'`), `${t} still handled`);
  }
  assert.match(code, /verifyWebhookSignature\(rawBody, sig, secret\)/);
  assert.match(code, /signature verification failed/);
});
