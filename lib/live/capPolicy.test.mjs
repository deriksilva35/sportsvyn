import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldPoll, createCapNotes } from './capPolicy.js';
import { applyCap, DEFAULT_CAP } from './quota.js';
import { sleepUntilNext } from './cadence.js';

const liveDecision = { state: 'live', sleepSec: 30, liveCount: 4 };
const capped = () => applyCap(liveDecision, DEFAULT_CAP.cfb, 'cfb');

test('a capped live window still polls, and the sleep between polls is >= 300 s', () => {
  const d = capped();
  assert.equal(d.capped, true);
  assert.equal(d.state, 'live-capped');
  assert.equal(shouldPoll({ active: true, lock: {} }), true);
  assert.ok(sleepUntilNext(d) >= 300);
});

test('no poll without an active window and the lock', () => {
  assert.equal(shouldPoll({ active: false, lock: {} }), false);
  assert.equal(shouldPoll({ active: true, lock: null }), false);
});

test('"capped: polling at 5m" is logged once per window', () => {
  const lines = []; const n = createCapNotes((l) => lines.push(l));
  const args = { league: 'cfb', capped: true, calls: 2000, cap: 2000, windowOpen: true };
  for (let i = 0; i < 5; i++) n.tick(args);
  assert.equal(lines.filter((l) => l === '[cfb] capped: polling at 5m').length, 1);
  n.windowClosed();
  n.tick(args);
  assert.equal(lines.filter((l) => l === '[cfb] capped: polling at 5m').length, 2);
});

test('the cap-reached line is logged once per day, not every tick', () => {
  const lines = []; const n = createCapNotes((l) => lines.push(l));
  const now = new Date('2026-10-31T18:37:04Z');
  for (let i = 0; i < 6; i++) n.tick({ league: 'cfb', capped: true, calls: 2000 + i, cap: 2000, windowOpen: i > 0, now });
  const reached = lines.filter((l) => l.includes('daily cap reached'));
  assert.deepEqual(reached, ['[cfb] daily cap reached: 2000/2000 calls - dropping to 5m']);
  n.tick({ league: 'cfb', capped: true, calls: 2001, cap: 2000, windowOpen: true, now: new Date('2026-11-01T18:00:00Z') });
  assert.equal(lines.filter((l) => l.includes('daily cap reached')).length, 2);
});

test('nothing is logged under the cap', () => {
  const lines = []; const n = createCapNotes((l) => lines.push(l));
  n.tick({ league: 'cfb', capped: false, calls: 10, cap: 2000, windowOpen: true });
  assert.deepEqual(lines, []);
});

test('source guard: index.mjs no longer gates the poll on decision.capped', () => {
  const src = readFileSync(new URL('../../services/live-poller/index.mjs', import.meta.url), 'utf8');
  assert.ok(!/!\s*decision\.capped/.test(src));
  assert.match(src, /shouldPoll\(\{ active, lock \}\)/);
  assert.match(src, /createCapNotes\(log\)/);
});
