// lib/fantasy/teardown.test.mjs - everything is free for the 2026 season.
//
// THE GATE TESTS ARE INVERTED, NOT DELETED - the 6dd5370 pattern. A test that
// merely disappeared would leave nothing saying the gate must not come back by
// accident; these assert the absence directly, and fail if a paywall returns
// without somebody also deciding to change them.
//
// WHAT IS NOT TORN DOWN, and is asserted here so a later cleanup does not go
// too far: the webhooks, lib/membership.js, the memberships table, plans.js and
// the purchase components all stay. Two live passes expire 2027-02-16, and
// deleting purchase code while somebody holds an entitlement breaks their
// account rather than stopping a charge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(path.join(REPO, p), 'utf8');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// THE FIVE GATES
// ---------------------------------------------------------------------------

test('GATE 1+2 REMOVED SERVER-SIDE: no entitlement refusal can be returned', () => {
  // Removed rather than hardwired: a branch that can never be taken is a lie
  // about why a request could fail, and the reason string would outlive the
  // rule in every handler still matching on it.
  const s = code('lib/fantasy/drafts.js');
  assert.equal(/entitlement_custom/.test(s), false, 'the custom console is free');
  assert.equal(/entitlement_tracker/.test(s), false, 'tracker mode is free');
});

test('GATE 3: the team cap no longer gates - 16 teams is not oversize', async () => {
  const { FREE_TEAMS_MAX, TEAMS_MAX, configLocks } = await import('./config.js');
  assert.equal(FREE_TEAMS_MAX, TEAMS_MAX, 'the free cap IS the ceiling');
  assert.equal(configLocks({ teamsCount: 16, rosterSlots: {} }).oversize, false);
  // The constant is LIFTED, not deleted, because configLocks still uses it to
  // caption a pool-provenance notice - which is true regardless of price.
  assert.equal(typeof FREE_TEAMS_MAX, 'number');
  assert.equal(configLocks({ teamsCount: 12, rosterSlots: { SUPERFLEX: 1 } }).superflex, true,
    'the superflex LOCK still reports, it just no longer costs anything');
});

test('GATE 4: superflex is not disabled for anyone', () => {
  const s = code('components/sim/StartForm.js');
  assert.equal(/SUPERFLEX' && !member/.test(s), false, 'the stepper is not member-gated');
  assert.equal(/memberBlocked = isCustom && !member/.test(s), false, 'custom is not blocked');
  assert.match(s, /const memberBlocked = false/);
});

test('GATE 5: the Exposure Report is free - it was not even on the list', () => {
  // Found by the recon, not the brief. It rendered a locked preview to anyone
  // without `sim`.
  const s = code('app/sim/history/page.js');
  assert.equal(/ent\.sim \? await getExposureReport/.test(s), false);
  assert.match(s, /locked=\{false\}/);
});

// ---------------------------------------------------------------------------
// THE PITCH
// ---------------------------------------------------------------------------

test('NO SHIPPED SURFACE STILL SELLS A PAID FEATURE', () => {
  const walk = (dir, out = []) => {
    for (const f of readdirSync(dir)) {
      if (['node_modules', '.next', '.git'].includes(f)) continue;
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(js|jsx)$/.test(f) && !/\.test\./.test(f)) out.push(p);
    }
    return out;
  };
  // Phrases that promise a feature costs money. The word "membership" itself is
  // fine - the notice page and the account status line both use it honestly.
  const BANNED = [
    /is a member feature/i,
    /are member features/i,
    /needs the Draft Pass/i,
    /SEE PLANS/,
    /Members get more/i,
    /member unlock/i,
  ];
  const hits = [];
  for (const dir of ['app', 'components', 'lib']) {
    for (const file of walk(path.join(REPO, dir))) {
      const text = readFileSync(file, 'utf8');
      for (const re of BANNED) if (re.test(text)) hits.push(`${path.relative(REPO, file)} :: ${re}`);
    }
  }
  assert.deepEqual(hits, [], `still selling features that are free:\n${hits.join('\n')}`);
});

test('/membership is a NOTICE, and still a route', () => {
  // Kept over a 404: it is in sitemap.xml at 0.6, linked from six surfaces, and
  // the App Store listing may reference it.
  const s = read('app/membership/page.js');
  assert.match(s, /Everything is free for the 2026 season/);
  assert.equal(/startCheckout/.test(s), false, 'no checkout form on the notice');
  assert.equal(/PLANS\.map/.test(s), false, 'no plan grid');
  assert.match(s, /resolveShellMode/, '3.1.1 redirect still unconditional');
  assert.ok(existsSync(path.join(REPO, 'app/membership/page.js')));
});

// ---------------------------------------------------------------------------
// WHAT MUST SURVIVE
// ---------------------------------------------------------------------------

test('THE PLUMBING IS UNTOUCHED - two live passes still have to resolve', () => {
  for (const p of [
    'app/api/stripe/webhook/route.js',
    'app/api/revenuecat/webhook/route.js',
    'lib/membership.js',
    'lib/stripe/plans.js',
    'components/sim/PassBuy.js',
  ]) {
    assert.ok(existsSync(path.join(REPO, p)), `${p} must not be deleted`);
  }
  // An in-flight Apple renewal that 404s retries and then dead-letters.
  assert.match(read('app/api/revenuecat/webhook/route.js'), /export async function POST/);
  assert.match(read('app/api/stripe/webhook/route.js'), /export async function POST/);
});

test('the `suite` entitlement shape stays - editorial is untouched', async () => {
  const { getEntitlements } = await import('../membership.js');
  const none = await getEntitlements(null);
  assert.deepEqual(none, { sim: false, suite: false }, 'both keys still exist');
});
