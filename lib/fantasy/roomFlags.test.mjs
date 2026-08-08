// lib/fantasy/roomFlags.test.mjs — the draft room hands itself back.
//
// THE INCIDENT. A user drafted a defense in round 8. The server refused it (a
// legitimate engine rule), replied `{ ok: false, reason: 'illegal_pick' }`, and
// wrote nothing - the draft was never damaged. But the client had raised
// `revealing` before awaiting, and the rejection branch returned without
// lowering it. `revealing` feeds isMyTurn:
//
//     isMyTurn = !complete && !revealing && onClockTeam === userTeamIndex
//
// so the room decided it was not his turn: the banner read "Team 3 on the clock"
// - third person, about his own seat - every Draft button disappeared, and the
// error banner could not be dismissed because dismissing it meant arming a row
// whose button had just gone. The only way out was force-quitting the app.
//
// The contract is one sentence, and these tests are it: A REJECTED PICK RETURNS
// THE ROOM TO EXACTLY THE PICKABLE STATE IT WAS IN BEFORE THE TAP.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flagsAfterResult, flagsAfterArm, canAct } from './roomFlags.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// The seat from the incident: team index 2, on the clock at pick 94.
const SEAT = { complete: false, onClockTeam: 2, userTeamIndex: 2 };

test('a rejection leaves the room pickable - the exact wedge', () => {
  // Before the tap the seat could act.
  assert.equal(canAct({ ...SEAT, revealing: false }), true, 'precondition: it was his turn');
  // The tap raises revealing, and while it is up the room believes it is not.
  assert.equal(canAct({ ...SEAT, revealing: true }), false, 'mid-flight, correctly not actionable');
  // The rejection must put it straight back.
  const f = flagsAfterResult({ ok: false, reason: 'illegal_pick' });
  assert.equal(f.revealing, false, 'a rejection MUST lower revealing');
  assert.equal(canAct({ ...SEAT, revealing: f.revealing }), true,
    'after a refusal the seat must be able to act again - this is the whole bug');
  assert.equal(f.armedId, null, 'the armed row is released');
  assert.deepEqual(f.err, { reason: 'illegal_pick' }, 'and the reason is shown');
});

test('REJECT then a successful pick - the sequence from the report', () => {
  // 1. tap -> refused
  let flags = flagsAfterResult({ ok: false, reason: 'illegal_pick' });
  assert.equal(canAct({ ...SEAT, revealing: flags.revealing }), true, 'room is pickable again');
  assert.ok(flags.err, 'banner is showing');

  // 2. the user arms a different row - the stale banner clears on the action
  flags = flagsAfterArm('player-123');
  assert.equal(flags.err, null, 'a new action clears the old error');
  assert.equal(flags.armedId, 'player-123');
  assert.equal(canAct({ ...SEAT, revealing: flags.revealing }), true);

  // 3. that pick is accepted
  flags = flagsAfterResult({ ok: true, picksMade: [], status: 'in_progress' });
  assert.equal(flags.err, null, 'no banner after a good pick');
  assert.equal(flags.armedId, null);
  assert.equal(flags.revealing, false, 'and the room is handed back');
});

test('every non-ok shape lowers revealing, including a thrown action', () => {
  // A dropped connection wedged identically: revealing was raised before the
  // await, so a throw left it up. The room now synthesises a rejection.
  for (const res of [
    { ok: false, reason: 'illegal_pick' },
    { ok: false, reason: 'player_unavailable' },
    { ok: false, reason: 'not_your_turn' },
    { ok: false, reason: 'network' },
    { ok: false },
    null,
    undefined,
  ]) {
    const f = flagsAfterResult(res);
    assert.equal(f.revealing, false, `revealing must fall for ${JSON.stringify(res)}`);
    assert.ok(f.err, 'and something must be shown');
  }
  assert.equal(flagsAfterResult(null).err.reason, 'unknown', 'an unnamed failure still names itself');
});

test('a rejection never advances the board', () => {
  // The server wrote nothing; the client must not pretend otherwise.
  const f = flagsAfterResult({ ok: false, reason: 'illegal_pick' });
  assert.ok(!('picksMade' in f), 'no picks are applied from a refusal');
  assert.equal(f.armedId, null);
});

// ---------------------------------------------------------------------------
// The wiring - asserted on source, because the rooms cannot be rendered here.
// ---------------------------------------------------------------------------

test('DraftRoom routes rejections through the contract and cannot skip it', () => {
  const code = stripComments(src('components/sim/DraftRoom.js'));
  assert.match(code, /import \{ flagsAfterResult, flagsAfterArm \}/);
  // The old shape - an early return that set err without touching revealing.
  assert.ok(!/if \(!res\.ok\) \{ setErr\(\{ reason: res\.reason \}\); setArmedId\(null\); return; \}/.test(code),
    'the early return that caused the wedge must be gone');
  // confirm() raises revealing before awaiting, so it must lower it unconditionally.
  const confirmFn = code.slice(code.indexOf('async function confirm('), code.indexOf('async function confirm(') + 700);
  assert.match(confirmFn, /finally\s*\{[\s\S]{0,80}setRevealing\(false\)/,
    'confirm must lower revealing in a finally - a throw wedges the room otherwise');
});

test('TrackerRoom cannot be wedged by a thrown action either', () => {
  const code = stripComments(src('components/sim/TrackerRoom.js'));
  // `busy` disables every DRAFT button there, so it is the same hazard.
  const commit = code.slice(code.indexOf('const commit = useCallback'), code.indexOf('const undo = useCallback'));
  assert.match(commit, /finally\s*\{[\s\S]{0,60}setBusy\(false\)/, 'commit must release busy in a finally');
  const undo = code.slice(code.indexOf('const undo = useCallback'));
  assert.match(undo.slice(0, 1400), /finally\s*\{[\s\S]{0,60}setBusy\(false\)/, 'undo must release busy in a finally');
});
