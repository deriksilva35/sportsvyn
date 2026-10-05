// lib/auth/ageGateDoors.test.mjs - EVERY WRITE DOOR ASKS THE AGE GATE.
//
// A guard cannot see a file it does not name, so this one names none: it WALKS
// app/ for every 'use server' module and every API route, takes every exported
// action and every POST/PUT/PATCH/DELETE handler, and requires each to either
// call the gate (ageGateRefusal / ageGateResponse, directly or through a
// same-file helper) BEFORE its first database statement, or appear in EXEMPT
// below with the reason it may run for an unanswered account. A new door that
// does neither fails here, and so does an EXEMPT entry whose door has gone.
//
// Then it COUNTS, so a walker that silently matched nothing cannot pass.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rel = (f) => path.relative(REPO, f).split(path.sep).join('/');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.js$/.test(e.name)) acc.push(full);
  }
  return acc;
}

/** Split a module into its top-level functions: name -> body text. */
function functions(text) {
  const out = new Map();
  const rx = /^(?:export )?(?:async )?function (\w+)\s*\(/gm;
  const hits = [...text.matchAll(rx)];
  hits.forEach((m, i) => out.set(m[1], text.slice(m.index, hits[i + 1]?.index ?? text.length)));
  return out;
}

const GATE = /ageGate(Refusal|Response)\(/;

/** Is `name` gated in this module - itself, or via a same-file helper it calls? */
function gated(fns, name, seen = new Set()) {
  const body = fns.get(name);
  if (!body || seen.has(name)) return false;
  seen.add(name);
  if (GATE.test(body)) {
    // BEFORE THE FIRST WRITE: the gate must precede the first sql` in the body.
    const g = body.search(GATE);
    const w = body.indexOf('sql`');
    return w === -1 || g < w;
  }
  for (const [other] of fns) {
    if (other !== name && new RegExp(`\\b${other}\\(`).test(body.replace(/^[^(]*\(/, '')) && gated(fns, other, seen)) return true;
  }
  return false;
}

// key: '<file>#<export>' (actions) or '<file>#<METHOD>' (routes). Reason required.
const EXEMPT = {
  // The gate itself and the way in.
  'app/actions/age.js#submitDateOfBirth': 'the answer to the gate',
  'app/actions/emailOtp.js#verifyEmailCode': 'sign-in; the screen comes right after',
  // Reads - nothing stored.
  'app/actions/handle.js#checkHandle': 'availability read',
  'app/actions/league.js#previewInvite': 'invite preview read',
  'app/actions/sim.js#fetchPlayerStats': 'stats read',
  'app/actions/sim.js#fetchPlayerSummaries': 'stats read',
  'app/app/actions.js#loadMatch': 'public read',
  'app/app/actions.js#loadRankings': 'public read',
  'app/app/actions.js#loadBracket': 'public read',
  'app/app/actions.js#loadStats': 'public read',
  // Leaving / removing your own data is always allowed.
  'app/actions/sim.js#deleteAccount': 'account deletion (5.1.1(v)) never waits on the screen',
  'app/actions/league.js#leaveLeague': 'leaving removes data',
  'app/api/push/unregister/route.js#POST': 'silencing a device',
  'app/api/push/subscribe/route.js#DELETE': 'removing a subscription',
  'app/api/push/prefs/route.js#DELETE': 'removing a preference',
  'app/api/live-activity/end/route.js#POST': 'ending an activity',
  'app/actions/membership.js#openBillingPortal': 'managing/cancelling an existing subscription',
  // Not an account write.
  'app/actions/welcomeSheet.js#sheetDismissed': 'updates an analytics row by id; no user read',
  'app/api/email/signup/route.js#POST': 'signed-out newsletter form; no account',
  'app/api/client-error/route.js#POST': 'error telemetry',
  'app/api/revenuecat/reconcile/route.js#POST': 'records an App Store purchase already made; refusing would lose a paid entitlement',
  // Machines.
  'app/api/revenuecat/webhook/route.js#POST': 'webhook',
  'app/api/stripe/webhook/route.js#POST': 'webhook',
  'app/api/webhooks/resend/route.js#POST': 'webhook',
  'app/api/cron/push-test/route.js#POST': 'cron',
  'app/api/admin/topic-draft/route.js#POST': 'admin (Basic Auth in proxy.js, and requireAdmin() in the handler)',
};
// Whole trees that are not reader doors.
const EXEMPT_TREES = ['app/admin/', 'app/api/admin/', 'app/api/cron/'];

function doors() {
  const files = walk(path.join(REPO, 'app')).filter((f) => !/\.test\./.test(f));
  const out = [];
  for (const f of files) {
    const r = rel(f);
    const raw = readFileSync(f, 'utf8');
    const text = strip(raw);
    const isAction = /^\s*['"]use server['"]/.test(text);
    const isRoute = /\/route\.js$/.test(r);
    if (!isAction && !isRoute) continue;
    const fns = functions(text);
    const names = isAction
      ? [...text.matchAll(/^export async function (\w+)/gm)].map((m) => m[1])
      : [...text.matchAll(/^export async function (POST|PUT|PATCH|DELETE)\b/gm)].map((m) => m[1]);
    for (const n of names) out.push({ file: r, name: n, key: `${r}#${n}`, gated: gated(fns, n) });
  }
  return out;
}

test('every write door calls the age gate before it writes, or is exempt by name', () => {
  const all = doors();
  const open = all.filter((d) => !d.gated && !EXEMPT[d.key] && !EXEMPT_TREES.some((t) => d.file.startsWith(t)));
  assert.deepEqual(open.map((d) => d.key), [],
    'a door that stores user data must call ageGateRefusal/ageGateResponse first (or be added to EXEMPT with a reason)');
});

test('no EXEMPT entry outlives its door, and none is secretly gated', () => {
  const byKey = new Map(doors().map((d) => [d.key, d]));
  for (const k of Object.keys(EXEMPT)) {
    assert.ok(byKey.has(k), `EXEMPT names ${k}, which no longer exists - remove it`);
    assert.equal(byKey.get(k).gated, false, `${k} is gated now - take it out of EXEMPT`);
  }
});

test('WALK AND COUNT: the walker sees the doors it is meant to see', () => {
  const all = doors();
  const g = all.filter((d) => d.gated);
  // 45 server actions + 11 route handlers gated on fri-5; 44 since sat-5 D5
  // removed sim.js#abandonDraft (a door taken away, not left ungated). A
  // change here is a door added or removed: look at which, then update.
  const actions = g.filter((d) => !d.file.endsWith('/route.js')).length;
  const routes = g.filter((d) => d.file.endsWith('/route.js')).length;
  assert.equal(actions, 44, `gated server actions: ${g.filter((d) => !d.file.endsWith('/route.js')).map((d) => d.key).join(', ')}`);
  assert.equal(routes, 11, `gated API handlers: ${g.filter((d) => d.file.endsWith('/route.js')).map((d) => d.key).join(', ')}`);
  // The doors the ruling names, by name - playing, leagues, stored prefs.
  for (const k of [
    'app/actions/pickem.js#savePickAction', 'app/actions/sim.js#makePick', 'app/actions/sim.js#startDraft',
    'app/actions/leagues.js#createLeagueAction', 'app/actions/leagues.js#joinLeagueAction',
    'app/actions/league.js#redeemInvite', 'app/actions/follows.js#followTeam', 'app/actions/handle.js#claimHandle',
    'app/actions/confirm.js#confirmWeeklyEntry', 'app/actions/membership.js#startCheckout',
    'app/api/weekly/save/route.js#POST', 'app/api/daily/lock/route.js#POST', 'app/api/draft/start/route.js#POST',
    'app/api/push/register/route.js#POST', 'app/api/push/prefs/route.js#PUT',
  ]) {
    assert.ok(all.find((d) => d.key === k)?.gated, `${k} must be gated`);
  }
});

test('no inline server action outside admin can skip the walk', () => {
  // An inline 'use server' inside a page is a door this walker would not see
  // as a module export. Admin pages have them (behind Basic Auth); nowhere else.
  const hits = walk(path.join(REPO, 'app')).filter((f) => !/\.test\./.test(f))
    .filter((f) => !rel(f).startsWith('app/admin/'))
    .filter((f) => /\n\s+['"]use server['"]/.test(strip(readFileSync(f, 'utf8'))));
  assert.deepEqual(hits.map(rel), []);
  // And components/ hosts no 'use server' modules at all.
  const comp = walk(path.join(REPO, 'components')).filter((f) => /^\s*['"]use server['"]/.test(strip(readFileSync(f, 'utf8'))));
  assert.deepEqual(comp.map(rel), []);
});
