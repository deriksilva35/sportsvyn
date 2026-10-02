// lib/live/nbaPlaysCadence.test.mjs - THE NBA PLAYS EXCEPTION (Derik, thu-40).
//
// The house rule is one cadence: the box score and the plays ride
// StatsTracker.due(). The NBA's plays (and the card's last play) are the one
// written exception: every 30 s poll while a game is LIVE, plus once at the
// final. The box score keeps due(). Pinned here: the pure rule, the reason
// written where the cadence lives, and the poller and the replay both using it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StatsTracker, nbaPlaysDue, NBA_PLAYS_EVERY_LIVE_POLL, STATS_EVERY_NTH_POLL } from './statsCadence.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

test('plays are due on EVERY poll for every live game; the box only on the tenth', () => {
  assert.equal(NBA_PLAYS_EVERY_LIVE_POLL, true);
  assert.equal(STATS_EVERY_NTH_POLL, 10, 'the box cadence is unchanged');
  const t = new StatsTracker();
  const live = [{ id: 1, status: 'live' }, { id: 2, status: 'live' }, { id: 3, status: 'scheduled' }];
  let boxes = 0; let plays = 0;
  for (let p = 1; p <= 20; p += 1) {
    const due = t.due({ polls: p, matches: live });
    boxes += due.length;
    plays += nbaPlaysDue({ matches: live, due }).length;
  }
  assert.equal(boxes, 4, 'two games x polls 10 and 20');
  assert.equal(plays, 40, 'two games x twenty polls');
});

test('the final gets its plays once more (through due()\'s final entry), and nothing after', () => {
  const t = new StatsTracker();
  t.due({ polls: 1, matches: [{ id: 7, status: 'live' }] });
  const due = t.due({ polls: 2, matches: [{ id: 7, status: 'final' }] });
  assert.deepEqual(nbaPlaysDue({ matches: [{ id: 7, status: 'final' }], due }), [{ id: 7, why: 'final' }]);
  const later = t.due({ polls: 3, matches: [{ id: 7, status: 'final' }] });
  assert.deepEqual(nbaPlaysDue({ matches: [{ id: 7, status: 'final' }], due: later }), []);
  assert.deepEqual(nbaPlaysDue({ matches: [{ id: 8, status: 'scheduled' }], due: [] }), [], 'never before the tip');
});

test('THE EXCEPTION IS WRITTEN WHERE THE CADENCE LIVES, with its reason and its cost', () => {
  const c = src('lib/live/statsCadence.js');
  assert.match(c, /THE NBA PLAYS EXCEPTION \(Derik's ruling thu-40\)/);
  assert.match(c, /WHY\./);
  assert.match(c, /COST\./);
  assert.match(c, /600\/min/);
  assert.match(c, /THE BOX SCORE CADENCE IS UNCHANGED/);
});

test('the poller and the replay both use it; the box stays on due()', () => {
  const idx = strip(src('services/live-poller/index.mjs'));
  assert.match(idx, /import \{ StatsTracker, nbaPlaysDue \} from '\.\.\/\.\.\/lib\/live\/statsCadence\.js';/);
  assert.match(idx, /const dueList = stats\.due\(\{ polls: window\.polls, matches: watched \}\);/);
  assert.match(idx, /if \(lg\.slug === 'nba'\) \{\s*for \(const d of nbaPlaysDue\(\{ matches: watched, due: dueList \}\)\) \{[\s\S]*?syncNbaLastPlay\(d\.id\)/);
  const dueLoop = idx.slice(idx.indexOf('for (const d of dueList)'), idx.indexOf('nbaPlaysDue({ matches: watched'));
  assert.ok(!/syncNbaLastPlay/.test(dueLoop), 'the plays are not ALSO on the box cadence');
  const run = strip(src('lib/nba/replayRun.js'));
  assert.match(run, /for \(const d of nbaPlaysDue\(\{ matches: watched, due \}\)\)/);
});
