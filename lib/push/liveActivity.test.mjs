// lib/push/liveActivity.test.mjs - the payload contract, checked field by
// field. No database and no network: everything here is pure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  liveActivityTopic, contentState, updatePayload, endPayload, liveActivityConfig,
} from './liveActivity.js';

const CFG = { topic: 'com.sportsvyn.draftvyn' };

test('the topic is the bundle id plus Apple\'s required suffix', () => {
  assert.equal(liveActivityTopic(CFG), 'com.sportsvyn.draftvyn.push-type.liveactivity');
});

test('the topic follows an APNS_TOPIC override, so both push types move together', () => {
  assert.equal(liveActivityTopic({ topic: 'com.example.other' }), 'com.example.other.push-type.liveactivity');
});

test('EXACTLY THE TEN FIELDS, and an eleventh does not get through', () => {
  // SIX BECAME NINE (the live line) AND NINE BECAME TEN: kickoffAt joined for
  // native 1.3 (2)'s pre-kick state. redZone still has not, and this is the
  // guard that keeps "no more" true by construction rather than by everyone
  // remembering.
  const s = contentState({
    awayAbbr: 'IND', awayScore: 7, homeAbbr: 'KC', homeScore: 14,
    period: 'Q2', clock: '1:39',
    possession: 'KC', situation: '3rd & 7 · IND 34', lastPlay: 'Mahomes pass complete',
    kickoffAt: '2026-09-13T17:00:00.000Z',
    redZone: true, // not in the contract
  });
  assert.deepEqual(Object.keys(s).sort(), ['awayAbbr', 'awayScore', 'clock', 'homeAbbr', 'homeScore', 'kickoffAt', 'lastPlay', 'period', 'possession', 'situation']);
  assert.deepEqual(s, { awayAbbr: 'IND', awayScore: 7, homeAbbr: 'KC', homeScore: 14,
    period: 'Q2', clock: '1:39', possession: 'KC', situation: '3rd & 7 · IND 34',
    lastPlay: 'Mahomes pass complete', kickoffAt: '2026-09-13T17:00:00.000Z' });
});

test('scores are INTEGERS even when the row hands over strings or nulls', () => {
  // A string where the widget expects Int is a decode failure, and a decode
  // failure on a Live Activity looks like a card that quietly stopped moving.
  const s = contentState({ awayScore: '7', homeScore: null, period: 'Q1', clock: '12:00' });
  assert.equal(s.awayScore, 7);
  assert.equal(s.homeScore, 0);
  assert.equal(typeof s.awayScore, 'number');
  assert.equal(typeof s.homeScore, 'number');
});

test('period and clock stay strings, as the poller already has them', () => {
  const s = contentState({ period: 'Q3', clock: '7:28' });
  assert.equal(s.period, 'Q3');
  assert.equal(s.clock, '7:28');
  const missing = contentState({});
  assert.equal(missing.period, '');
  assert.equal(missing.clock, '');
});

test('an update payload is aps.timestamp + event:update + content-state, and nothing else', () => {
  const now = new Date('2026-09-20T20:31:07Z');
  const p = updatePayload({ awayAbbr: 'IND', awayScore: 7, homeAbbr: 'KC', homeScore: 14, period: 'Q2', clock: '1:39' }, { now });
  assert.deepEqual(Object.keys(p), ['aps']);
  assert.deepEqual(Object.keys(p.aps).sort(), ['content-state', 'event', 'timestamp']);
  assert.equal(p.aps.event, 'update');
  // UNIX SECONDS, not milliseconds: Apple compares this against the timestamp
  // the widget already holds, and a millisecond value is always "newer",
  // which hides an out-of-order update instead of dropping it.
  assert.equal(p.aps.timestamp, Math.floor(now.getTime() / 1000));
  assert.equal(p.aps['content-state'].homeScore, 14);
});

test('an end payload carries a dismissal-date, and keeps the final score visible until then', () => {
  const now = new Date('2026-09-20T23:14:00Z');
  const p = endPayload({ awayAbbr: 'IND', awayScore: 17, homeAbbr: 'KC', homeScore: 27, period: 'F', clock: '' }, { now });
  assert.equal(p.aps.event, 'end');
  assert.equal(p.aps['content-state'].awayScore, 17);
  assert.equal(p.aps['dismissal-date'], Math.floor(now.getTime() / 1000) + 30 * 60);
});

test('an explicit dismissal time wins over the default half hour', () => {
  const now = new Date('2026-09-20T23:14:00Z');
  const at = new Date('2026-09-20T23:20:00Z');
  const p = endPayload({}, { now, dismissAt: at });
  assert.equal(p.aps['dismissal-date'], Math.floor(at.getTime() / 1000));
});

test('the gate is apns.js\'s gate, not a second one', () => {
  // Same four facts, same flag. A Live Activity must not be able to send from
  // an environment where an alert cannot.
  assert.equal(liveActivityConfig({}).enabled, false);
  assert.equal(liveActivityConfig({ PUSH_ENABLED: '1' }).enabled, false);
  const armed = liveActivityConfig({
    PUSH_ENABLED: '1', APNS_KEY: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----',
    APNS_KEY_ID: 'ABCDE12345', APNS_TEAM_ID: '87BX25MUHY', APNS_ENV: 'production',
  });
  assert.equal(armed.enabled, true);
  assert.equal(liveActivityTopic(armed), 'com.sportsvyn.draftvyn.push-type.liveactivity');
});
