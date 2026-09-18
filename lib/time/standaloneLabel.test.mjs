// lib/time/standaloneLabel.test.mjs - THE DAY ON A KICKOFF.
//
// THE DEFECT: a Weekly slate runs Thursday night to Monday night, and every
// kickoff on the page printed a bare clock time. "5:15 PM" on one row and
// "5:15 PM" on another were four days apart and identical on screen - on the
// one board where which DAY a slot locks is the whole decision.
//
// TWO OPTIONS, BOTH DEFAULTING TO TODAY'S OUTPUT so the five surfaces using
// this island (Pick'em, the Daily season board, Today, the Draft card, Scores)
// do not move: `weekday` prepends "Thu ", `zone` false drops " PDT".
//
// tz:null IS THE SSR PATH - the ET string the server emits and the first
// client render must match. Asserting the zone this box happens to be in would
// be asserting the box.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { standaloneTimeLabel } from './standaloneLabel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = (rel) => readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf8');
const render = ({ iso, ...opts }) => standaloneTimeLabel(iso, { ...opts, tz: null });

const THU = '2026-09-17T21:15:00Z';
const MON = '2026-09-21T21:15:00Z';
const SUN = '2026-09-20T14:00:00Z';

test('THU AND MON AT THE SAME CLOCK TIME RENDER DIFFERENTLY', () => {
  const thu = render({ iso: THU, weekday: true, zone: false });
  const mon = render({ iso: MON, weekday: true, zone: false });
  assert.equal(thu, 'Thu 5:15 PM');
  assert.equal(mon, 'Mon 5:15 PM');
  assert.notEqual(thu, mon, 'the whole reason this prop exists');
  // And without the prop they are the same string, which is the bug.
  assert.equal(render({ iso: THU, zone: false }), render({ iso: MON, zone: false }));
});

test('a Sunday one o\'clock reads as Sunday', () => {
  assert.equal(render({ iso: SUN, weekday: true, zone: false }), 'Sun 10:00 AM');
});

test('THE DEFAULT IS UNCHANGED - every other surface keeps its exact string', () => {
  // Pick'em, the Daily season board, Today, the Draft card and Scores all call
  // this with `iso` alone. If this assertion moves, they moved.
  assert.equal(render({ iso: THU }), '5:15 PM ET');
  assert.equal(render({ iso: SUN }), '10:00 AM ET');
});

test('the zone rides with the weekday when it is asked for', () => {
  assert.equal(render({ iso: THU, weekday: true }), 'Thu 5:15 PM ET');
  assert.equal(render({ iso: THU, weekday: true, zone: false }), 'Thu 5:15 PM');
  assert.equal(render({ iso: THU, zone: false }), '5:15 PM');
});

test('THE DAY AND THE HOUR COME FROM ONE FORMAT CALL', () => {
  // A second Intl call for the day can disagree with the first across a
  // midnight boundary in the viewer's zone - "Sun 11:30 PM" printed as
  // "Mon 11:30 PM". One formatToParts, one instant, one zone.
  const src = repo('lib/time/standaloneLabel.js');
  assert.match(src, /const day = v\('weekday'\)/);
  assert.equal((src.match(/new Intl\.DateTimeFormat/g) ?? []).length, 1,
    'ONE formatter, parameterised by zone - not one per zone and a third for the day');
  // And the component is now a three-line renderer over it.
  const cmp = repo('components/StandaloneTime.js');
  assert.match(cmp, /import \{ standaloneTimeLabel \} from '@\/lib\/time\/standaloneLabel'/);
  assert.doesNotMatch(cmp, /new Intl\.DateTimeFormat/, 'no formatting left in the component');
});

test('the next lock is the only Weekly time that states a zone', () => {
  const room = repo('components/weekly/WeeklyRoom.js');
  assert.match(room, /next lock <StandaloneTime iso=\{nextLockIso\} weekday \/>/);
  // Every other call in the room drops it.
  const calls = room.match(/<StandaloneTime iso=\{[^}]+\}[^/]*\/>/g) ?? [];
  const zoned = calls.filter((c) => !c.includes('zone={false}'));
  assert.equal(zoned.length, 1, `one zoned time, found: ${zoned.join(' | ')}`);
  assert.ok(calls.length >= 4, `and the rest carry the day: ${calls.length} calls`);
});
