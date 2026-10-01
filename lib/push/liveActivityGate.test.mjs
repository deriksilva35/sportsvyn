// lib/push/liveActivityGate.test.mjs - no Live Activity for basketball yet
// (thu-18). One rule, three doors: the bell does not offer the switch, the
// register route refuses the match, and the poller's rider never counts,
// builds or pushes a card for it.
// Run: node --test lib/push/liveActivityGate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveActivitySupported } from './liveActivityState.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (r) => readFileSync(path.join(REPO, r), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the rule: basketball no, every sport that has a card yes', () => {
  assert.equal(liveActivitySupported('nba'), false);
  for (const lg of ['nfl', 'cfb', 'mlb']) assert.equal(liveActivitySupported(lg), true, lg);
});

test('DOOR 1 - the bell does not offer the switch for basketball', () => {
  const t = strip(src('components/alerts/AlertBell.js'));
  assert.match(t, /const showLive = Boolean\([^;]*liveActivitySupported\(match\?\.leagueSlug\)\)/s);
});

test('DOOR 2 - the register route refuses a basketball match before it registers', () => {
  const t = strip(src('app/api/live-activity/register/route.js'));
  const gate = t.indexOf('liveActivitySupported(m.league_slug)');
  assert.ok(gate > 0, 'the route asks the rule');
  assert.ok(gate < t.indexOf('registerActivity(sql'), 'and asks it before writing the Activity');
  assert.match(t.slice(gate, gate + 200), /status: 400/);
});

test('DOOR 3 - the poller rider never counts, builds or pushes a basketball card', () => {
  const t = strip(src('services/live-poller/poll.mjs'));
  assert.match(t, /const laListeners = liveActivitySupported\(m\.league_slug\)\s*\?\s*await liveActivityCount\(sql, m\.id\)/);
  // the only push path hangs off laEvent, which is only set inside the listener block
  const block = t.slice(t.indexOf('if (laListeners > 0) {'));
  assert.ok(t.indexOf('let laEvent = null;') < t.indexOf('if (laListeners > 0) {'));
  assert.match(block, /if \(laEvent\) \{[\s\S]*pushLiveActivities\(sql/);
});
