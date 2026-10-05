// lib/shell/widgetNudge.test.mjs - THE WIDGETS' TWO NUDGES (sun-24).
//   picksChanged     after every save door's SUCCESS, never on a refusal
//   sessionChanged   when the shell's account differs from the last one seen
// Shell mode and a native container only; silent everywhere else.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendPicksChanged, sendSessionChangedIfNew, sessionNudge, PICK_GAMES, SESSION_SEEN_KEY } from './bridge.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let posted;
function env({ shell = true, container = true } = {}) {
  posted = [];
  globalThis.document = { cookie: shell ? 'a=1; sv_shell=sim-app' : 'a=1' };
  globalThis.window = { postMessage: (m, o) => posted.push([m, o]), ...(container ? { webkit: { messageHandlers: {} } } : {}) };
}
const store = (init = null) => {
  const m = new Map(init == null ? [] : [[SESSION_SEEN_KEY, init]]);
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m };
};

beforeEach(() => env());

test('picksChanged: posted in the shell with a container, with its game key', () => {
  assert.equal(sendPicksChanged('pickem'), true);
  assert.deepEqual(posted, [[{ type: 'picksChanged', game: 'pickem' }, '*']]);
  assert.deepEqual(PICK_GAMES, ['pickem', 'series', 'weekly', 'draft', 'october', 'run', 'six', 'epl5', 'daily']);
});

test('picksChanged: silent off the shell, with no container, or for an unknown game', () => {
  env({ shell: false });
  assert.equal(sendPicksChanged('weekly'), false);
  env({ container: false });
  assert.equal(sendPicksChanged('weekly'), false);
  env();
  assert.equal(sendPicksChanged('survivor'), false);
  assert.deepEqual(posted, []);
});

test('sessionChanged: the first look posts; the same state again does not; a change does', () => {
  const s = store();
  assert.equal(sendSessionChangedIfNew({ signedIn: true, handle: 'derik' }, s), true);
  assert.deepEqual(posted.at(-1)[0], { type: 'sessionChanged', signedIn: true });
  assert.equal(sendSessionChangedIfNew({ signedIn: true, handle: 'derik' }, s), false, 'same account, no nudge');
  assert.equal(sendSessionChangedIfNew({ signedIn: false, handle: null }, s), true);
  assert.deepEqual(posted.at(-1)[0], { type: 'sessionChanged', signedIn: false });
  assert.equal(sendSessionChangedIfNew({ signedIn: true, handle: 'other' }, s), true, 'another account');
  assert.equal(posted.length, 3);
  assert.equal(sendSessionChangedIfNew(null, s), false, 'no answer from /api/me: nothing');
});

test('sessionNudge is pure, and storage that throws never breaks the header', () => {
  assert.deepEqual(sessionNudge(null, { signedIn: false }), { store: 'out', post: true, signedIn: false });
  assert.deepEqual(sessionNudge('out', { signedIn: false }), { store: 'out', post: false, signedIn: false });
  const bad = { getItem: () => { throw new Error('private'); }, setItem: () => { throw new Error('private'); } };
  assert.equal(sendSessionChangedIfNew({ signedIn: true, handle: 'x' }, bad), true);
  env({ shell: false });
  assert.equal(sendSessionChangedIfNew({ signedIn: true, handle: 'y' }, store()), false, 'off the shell: silent');
});

// ---------------------------------------------------------------------------
// EVERY SAVE DOOR, BY NAME AND COUNT. Each file must call sendPicksChanged with
// its key, and only on the success side of its own refusal check.
// ---------------------------------------------------------------------------

const DOORS = [
  ['components/pickem/PickemBoard.js', 'pickem', 1],
  ['components/pickem/SeriesBoard.js', 'series', 1],
  ['components/weekly/WeeklyRoom.js', 'weekly', 3],
  ['components/sim/DraftRoom.js', 'draft', 1],
  ['components/october/OctoberCard.js', 'october', 2],
  ['components/run/RunRoster.js', 'run', 2],
  ['components/six/SixCard.js', 'six', 2],
  ['components/eplWeekly5/EplWeekly5Card.js', 'epl5', 2],
  ['components/daily/season/SeasonBoard.js', 'daily', 2],
];

test('every save door posts picksChanged, the counted number of times, with its own key', () => {
  for (const [f, key, n] of DOORS) {
    const src = readFileSync(path.join(REPO, f), 'utf8');
    const hits = [...src.matchAll(/sendPicksChanged\('(\w+)'\)/g)].map((m) => m[1]);
    assert.deepEqual(hits, Array(n).fill(key), f);
  }
  // the keys the doors use are the keys the bridge accepts, all of them
  assert.deepEqual([...new Set(DOORS.map((d) => d[1]))].sort(), [...PICK_GAMES].sort());
});

test('never on a refusal: the one-line doors post only in the else of `if (!r?.ok)`', () => {
  for (const f of ['components/october/OctoberCard.js', 'components/run/RunRoster.js', 'components/six/SixCard.js', 'components/eplWeekly5/EplWeekly5Card.js']) {
    const src = readFileSync(path.join(REPO, f), 'utf8');
    for (const line of src.split('\n').filter((l) => l.includes('sendPicksChanged('))) {
      assert.match(line, /^\s*if \(!r\?\.ok\) \{.*\} else sendPicksChanged\('\w+'\);$/, `${f}: ${line.trim()}`);
    }
  }
  const draft = readFileSync(path.join(REPO, 'components/sim/DraftRoom.js'), 'utf8');
  assert.match(draft, /if \(res\.status === 'completed'\) \{ sendPicksChanged\('draft'\);/);
  const header = readFileSync(path.join(REPO, 'components/shell/AppHeader.js'), 'utf8');
  assert.match(header, /sendSessionChangedIfNew\(next\)/);
});
