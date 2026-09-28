// components/sim/autoDraft.test.mjs - the AUTO DRAFT control.
//
// The button was a muted grey chip reading "Auto" with a small switch, sitting
// beside a List/Board segmented control of the same visual weight. One decides
// which panel you are looking at; the other hands your seat to the engine for
// every remaining round. It had no confirmation at all.
//
// These pin the three things that make the louder version safe: the label says
// what it is, turning it ON asks first, and turning it OFF still does not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const room = stripComments(src('components/sim/DraftRoom.js'));
const css = src('components/sim/sim.css');

test('the label is the full words, not an abbreviation', () => {
  assert.match(room, /<span className="sw" \/>Auto Draft/);
  assert.ok(!/<span className="sw" \/>Auto</.test(room), '"Auto" alone is gone');
});

test('TURNING IT ON ASKS FIRST', () => {
  // There was no confirmation. With the control now volt-filled, a curious tap
  // would otherwise forfeit the draft in one press.
  assert.match(room, /if \(next && !window\.confirm\(AUTO_CONFIRM\)\) return;/);
  // The guard precedes every effect of the toggle - state, haptic, persistence.
  const fn = room.slice(room.indexOf('async function toggleAuto()'), room.indexOf('useEffect', room.indexOf('async function toggleAuto()')));
  const guard = fn.indexOf('window.confirm');
  assert.ok(guard > -1);
  assert.ok(guard < fn.indexOf('setAuto(next)'), 'nothing is set before the answer');
  assert.ok(guard < fn.indexOf('sendHaptic'), 'and nothing is felt');
  assert.ok(guard < fn.indexOf('setAutoDraft(draftId'), 'and nothing is persisted');
});

test('TURNING IT OFF DOES NOT ASK', () => {
  // Switching it off returns control. It costs nothing and must stay one tap -
  // a confirmation there would be a dialog standing between someone and their
  // own draft.
  assert.match(room, /if \(next && !window\.confirm/, 'the guard is conditional on next');
  assert.ok(!/if \(!window\.confirm/.test(room), 'not an unconditional confirm');
});

test('the prompt states the CONSEQUENCE, not the mechanism', () => {
  assert.match(room, /export const AUTO_CONFIRM = 'Let the room make your picks\? Auto Draft fills every remaining round for you\.'/);
  // "Enable auto-draft?" describes a setting. This describes what happens to
  // the draft the person is currently in.
  assert.ok(!/Enable auto/i.test(room));
  assert.ok(!/[—–]/.test(room.match(/AUTO_CONFIRM = '[^']*'/)[0]), 'hyphens only');
});

test('VOLT FILL, not volt text on grey', () => {
  const rule = css.slice(css.indexOf('.auto-toggle {'), css.indexOf('.auto-toggle:hover'));
  assert.match(rule, /background: var\(--volt\);/);
  assert.match(rule, /color: var\(--ink\);/);
  assert.ok(!/background: var\(--graphite\)/.test(rule), 'the muted chip is gone');
});

test('the ON state is the LIVE colour, because the seat is being drafted for', () => {
  // ON is not a brighter version of OFF - it is a condition you can switch off.
  assert.match(css, /\.auto-toggle\.on \{ background: var\(--live\); border-color: var\(--live\); color: #fff; \}/);
});

test('BEHAVIOUR IS UNCHANGED: same action, same engine path', () => {
  // The restyle must not become a rewrite. AUTO still flips drafts.is_auto via
  // setAutoDraft and still drives turns through timerAutoPick - the same
  // server-authoritative path the pick timer uses.
  assert.match(room, /const res = await setAutoDraft\(draftId, next\);/);
  assert.match(room, /if \(!res\.ok\) \{ setAuto\(!next\); setErr\(\{ reason: res\.reason \}\); \}/,
    'and it still reverts on a server refusal');
  assert.match(room, /const res = await timerAutoPick\(draftId\);/);
  assert.match(room, /const canPick = isMyTurn && !auto;/, 'AUTO still owns the seat while on');
});

test('placement is unchanged - still in the room header beside the view toggle', () => {
  const head = room.slice(room.indexOf('<div className="room-head">'), room.indexOf('{lastLine &&'));
  assert.ok(head.indexOf('room-view') < head.indexOf('auto-toggle'), 'view toggle first, AUTO after');
  assert.match(head, /\{!complete && \(/, 'and it still hides on a finished draft');
});
