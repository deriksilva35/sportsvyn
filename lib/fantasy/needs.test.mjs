// lib/fantasy/needs.test.mjs — tracker needs/best-available math. NO DATABASE.
// Run: node --test lib/fantasy/needs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  valueGap, openStarterSlotsByPos, detectRun, needsObservation,
  bestAvailableAtMyPick, slotLabel,
} from './needs.js';

test('valueGap: positive = fell to you, matching grade.js displayValue', () => {
  // The mock's own frame-1 rows, at pick 31.
  assert.equal(valueGap(31, 29.1), 1.9);    // Chase: fell past ADP -> value
  assert.equal(valueGap(31, 41.2), -10.2);  // JSN: earlier than market -> reach
  assert.equal(valueGap(31, 55.0), -24);
  assert.equal(valueGap(31, 31), 0);
  assert.equal(valueGap(null, 29.1), null);
  assert.equal(valueGap(31, null), null);
});

const slots = (arr) => arr.map(([key, pick]) => ({ key, pick, label: key }));

test('openStarterSlotsByPos: bench never counts as a need', () => {
  const r = slots([['QB', null], ['RB', { x: 1 }], ['RB', null], ['WR', null], ['WR', null], ['BN', null], ['BN', null]]);
  // Count descending; ties keep the order the slots were encountered in, which is
  // buildRoster's STARTER_ORDER (QB, RB, WR, TE, FLEX, DST, K) — so a QB hole and
  // an RB hole tie the way the roster itself reads, top-down.
  assert.deepEqual(openStarterSlotsByPos(r), [
    { pos: 'WR', count: 2 }, { pos: 'QB', count: 1 }, { pos: 'RB', count: 1 },
  ]);
});

test('openStarterSlotsByPos: a full roster has no needs', () => {
  const r = slots([['QB', { x: 1 }], ['RB', { x: 1 }], ['BN', null]]);
  assert.deepEqual(openStarterSlotsByPos(r), []);
  assert.deepEqual(openStarterSlotsByPos([]), []);
  assert.deepEqual(openStarterSlotsByPos(undefined), []);
});

const pk = (slotPos) => ({ slotPos });

test('detectRun uses the engine thresholds (4 of the last 6)', () => {
  assert.deepEqual(detectRun([pk('RB'), pk('RB'), pk('WR'), pk('RB'), pk('RB'), pk('QB')]), { pos: 'RB', count: 4 });
  // 3 of 6 is under RUN_THRESHOLD -> not a run.
  assert.equal(detectRun([pk('RB'), pk('RB'), pk('WR'), pk('RB'), pk('QB'), pk('TE')]), null);
  // Only the last 6 count: the older RBs fall out of the window.
  assert.equal(detectRun([pk('RB'), pk('RB'), pk('RB'), pk('RB'), pk('WR'), pk('WR'), pk('QB'), pk('TE'), pk('K'), pk('DST')]), null);
  assert.equal(detectRun([]), null);
  assert.equal(detectRun(undefined), null);
});

test('needsObservation: run on an open position reads as the squeeze', () => {
  const o = needsObservation({
    openSlots: [{ pos: 'RB', count: 2 }, { pos: 'TE', count: 1 }],
    recentPicks: [pk('RB'), pk('RB'), pk('WR'), pk('RB'), pk('RB'), pk('QB')],
  });
  assert.equal(o.squeeze, 'RB');
  assert.match(o.text, /^2 backs slots are open and the room has taken 4 backs in a round - RB is the squeeze\.$/);
});

test('needsObservation: a run on a position you do NOT need is not a squeeze', () => {
  const o = needsObservation({
    openSlots: [{ pos: 'TE', count: 1 }],
    recentPicks: [pk('RB'), pk('RB'), pk('RB'), pk('RB'), pk('WR'), pk('QB')],
  });
  assert.equal(o.squeeze, null, 'the room running on RB is irrelevant when RB is filled');
  assert.match(o.text, /One tight end slot is open/);
});

test('needsObservation: singular/plural and the secondary clause', () => {
  const one = needsObservation({ openSlots: [{ pos: 'QB', count: 1 }], recentPicks: [] });
  assert.match(one.text, /^One quarterback slot is open\. The board has not run on it yet\.$/);
  const many = needsObservation({
    openSlots: [{ pos: 'WR', count: 3 }, { pos: 'RB', count: 2 }, { pos: 'TE', count: 1 }],
    recentPicks: [],
  });
  assert.match(many.text, /^3 receivers slots are open, with 2 at RB and 1 at TE\./);
});

test('needsObservation: full starters says so plainly', () => {
  const o = needsObservation({ openSlots: [], recentPicks: [] });
  assert.equal(o.squeeze, null);
  assert.match(o.text, /Every starting slot is filled/);
  assert.deepEqual(needsObservation({}), needsObservation({ openSlots: [], recentPicks: [] }));
});

test('needsObservation: register — no advice, no verdict, hyphens only', () => {
  const cases = [
    needsObservation({ openSlots: [{ pos: 'RB', count: 2 }], recentPicks: [pk('RB'), pk('RB'), pk('RB'), pk('RB')] }),
    needsObservation({ openSlots: [{ pos: 'WR', count: 1 }], recentPicks: [] }),
    needsObservation({ openSlots: [], recentPicks: [] }),
  ];
  for (const { text } of cases) {
    assert.ok(!/[—–]/.test(text), `em/en dash in: ${text}`);
    assert.ok(!/\b(you should|take |target|need to|must |grab |avoid)\b/i.test(text), `advice in: ${text}`);
    assert.ok(!/!/.test(text), `exclamation in: ${text}`);
  }
});

test('bestAvailableAtMyPick: gap measured at MY next pick, not the current one', () => {
  const avail = [
    { ffcPlayerId: '2', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', adp: 33.6 },
    { ffcPlayerId: '1', name: "Ja'Marr Chase", position: 'WR', team: 'CIN', adp: 29.1 },
    { ffcPlayerId: '3', name: 'Jaxon Smith-Njigba', position: 'WR', team: 'SEA', adp: 41.2 },
  ];
  const out = bestAvailableAtMyPick(avail, 34, 3);
  assert.deepEqual(out.map((p) => p.name), ["Ja'Marr Chase", 'Jahmyr Gibbs', 'Jaxon Smith-Njigba'], 'sorted by ADP');
  assert.equal(out[1].gap, 0.4, 'Gibbs 33.6 at pick 34 -> +0.4');
  assert.equal(out[0].gap, 4.9, 'Chase 29.1 at pick 34 -> +4.9');
  // likelyGone is a market FACT, not a probability: his ADP is before your pick.
  assert.equal(out[0].likelyGone, true);
  assert.equal(out[2].likelyGone, false);
  assert.equal(out[2].gap, -7.2);
});

test('bestAvailableAtMyPick: no next pick -> nothing to say', () => {
  assert.deepEqual(bestAvailableAtMyPick([{ adp: 1, name: 'x' }], null), []);
  assert.deepEqual(bestAvailableAtMyPick(undefined, 34), []);
  assert.deepEqual(bestAvailableAtMyPick([], 34), []);
});

test('slotLabel: round.pickInRound, zero padded', () => {
  assert.equal(slotLabel(31, 12), '3.07');
  assert.equal(slotLabel(1, 12), '1.01');
  assert.equal(slotLabel(12, 12), '1.12');
  assert.equal(slotLabel(13, 12), '2.01');
  assert.equal(slotLabel(34, 12), '3.10');
  assert.equal(slotLabel(null, 12), null);
  assert.equal(slotLabel(31, null), null);
});
