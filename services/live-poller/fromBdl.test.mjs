// services/live-poller/fromBdl.test.mjs - the poller reads the clock off
// BDL's prose the same way the games sync does, so the two writers of
// matches.metadata.live_state never disagree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromBdl } from './poll.mjs';

const GAME = JSON.parse(readFileSync(new URL('../../lib/gridiron/fixtures/bdl-game-1392216.json', import.meta.url), 'utf8')).data;

test('a live row carries the parsed period and clock; a scheduled or final row carries none', () => {
  const live = fromBdl(GAME, []);
  assert.equal(live.status, 'live');
  assert.deepEqual(live.liveState, { period: 4, clock: '4:40' });
  assert.deepEqual([live.homeScore, live.awayScore], [13, 10]);
  const sched = fromBdl({ ...GAME, status: '9/13 - 1:00 PM EDT', status_state: 'scheduled' }, []);
  assert.equal(sched.status, 'scheduled'); assert.equal(sched.liveState, null);
  const fin = fromBdl({ ...GAME, status: 'Final', status_state: 'final' }, []);
  assert.equal(fin.status, 'final'); assert.equal(fin.liveState, null, 'D6: live_state dies with the game');
  const odd = fromBdl({ ...GAME, status: 'Delayed' }, []);
  assert.equal(odd.status, 'live'); assert.equal(odd.liveState, null, 'unparsed prose withholds the chip and nothing else');
});
