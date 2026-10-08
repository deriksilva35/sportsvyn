// lib/leagues/pickFormat.test.mjs - how a league scores its Pick'em (S2), PURE:
// the two formats, the lock, the one-time switch and its floor, the record.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PICK_FORMATS, validatePickFormat, formatLocked, formatAt, pickemLeagueScore, pickemRecord, recordLine,
  planFormatChange, switchOffer, SWITCH_EARLIEST, pendingLine,
  PICK_FORMAT_TITLE, PICK_FORMAT_COPY, PICK_FORMAT_TAG, PICK_FORMAT_LOCK_NOTE,
} from './pickFormat.js';
import { validateLeagueSettings, summaryLine } from './settings.js';
import { shapeResults } from './results.js';
import { computeStandings } from './standings.js';
import { CONFIDENCE_START } from '../pickem/confidence.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const BASE = { games: ['pickem'], span: 'season', scoring: 'total', format: 'table', maxMembers: 12 };

test('three formats; ATS is accepted for football leagues and refused for any other sport', () => {
  assert.deepEqual([...PICK_FORMATS], ['regular', 'confidence', 'ats']);
  assert.deepEqual(validatePickFormat(undefined), { ok: true, pickFormat: 'regular' }, 'missing = REGULAR, the column default');
  assert.equal(validatePickFormat('CONFIDENCE').pickFormat, 'confidence');
  assert.equal(validatePickFormat('ats').pickFormat, 'ats', 'Pick\'em is NFL + CFB: ATS is allowed');
  for (const sports of [['nba'], ['mlb'], ['epl'], ['nfl', 'mlb'], []]) {
    const r = validatePickFormat('ats', { sports });
    assert.equal(r.ok, false, `ATS refused for ${sports}`);
    assert.equal(r.code, 'ats_sport');
    assert.match(r.reason, /NFL and college football/);
  }
  assert.equal(validatePickFormat('ats', { sports: ['nfl', 'cfb'] }).ok, true);
  assert.equal(validatePickFormat('nonsense').ok, false);
});

test('the create validator carries the format, and only a Pick\'em league keeps a non-REGULAR one', () => {
  assert.equal(validateLeagueSettings({ ...BASE, pickFormat: 'confidence' }, { survivor: false }).settings.pickFormat, 'confidence');
  assert.equal(validateLeagueSettings(BASE, { survivor: false }).settings.pickFormat, 'regular');
  const daily = validateLeagueSettings({ ...BASE, games: ['daily'], pickFormat: 'confidence' }, { survivor: false });
  assert.equal(daily.settings.pickFormat, 'regular', 'no Pick\'em, no format');
  assert.equal(validateLeagueSettings({ ...BASE, pickFormat: 'ats' }, { survivor: false }).settings.pickFormat, 'ats');
  assert.equal(validateLeagueSettings({ ...BASE, games: ['daily'], pickFormat: 'ats' }, { survivor: false }).settings.pickFormat, 'regular', 'no Pick\'em, no format');
});

test('the summary bar names a confidence league, and says nothing for REGULAR', () => {
  assert.equal(summaryLine({ ...BASE, pickFormat: 'confidence' }), "Pick'em · Confidence · Season · Total points · Table");
  assert.equal(summaryLine({ ...BASE, pick_format: 'confidence' }), "Pick'em · Confidence · Season · Total points · Table", 'a DB row reads the same');
  assert.equal(summaryLine({ ...BASE, pickFormat: 'regular' }), "Pick'em · Season · Total points · Table");
});

test('REGULAR = wins from the lineup; CONFIDENCE = the board\'s own points', () => {
  const conf = { conf: true, settled: true, score: 31, lineup: { 1: 'home', 2: 'home', 3: 'away' }, results: { 1: 'home', 2: 'away', 3: 'away' } };
  assert.equal(pickemLeagueScore('regular', conf), 2, 'two right picks, not 31 points');
  assert.equal(pickemLeagueScore('confidence', conf), 31);
  // a board that was never ranked (before 20 Oct) scores its wins in either league
  const reg = { conf: false, settled: true, score: 9, lineup: {}, results: {} };
  assert.equal(pickemLeagueScore('regular', reg), 9);
  assert.equal(pickemLeagueScore('confidence', reg), 9);
  // not settled: nothing yet
  assert.equal(pickemLeagueScore('regular', { ...conf, settled: false, results: null, score: null }), null);
  assert.equal(pickemLeagueScore('confidence', { ...conf, settled: false, results: null, score: null }), null);
});

test('the record: right and wrong picks over games with a winner; void and tie are neither', () => {
  assert.deepEqual(pickemRecord({ 1: 'home', 2: 'home', 3: 'away', 4: 'home' }, { 1: 'home', 2: 'away', 3: null, 5: 'home' }), { w: 1, l: 1 });
  assert.equal(recordLine({ w: 11, l: 2 }), '11-2');
  assert.equal(recordLine(null), '');
});

test('formatAt: weeks before a switch keep the old format, from it on the new one', () => {
  const lg = { pick_format: 'confidence', pick_format_prev: 'regular', pick_format_from: CONFIDENCE_START };
  assert.equal(formatAt(lg, '2026-10-16T00:15:00Z'), 'regular');
  assert.equal(formatAt(lg, '2026-10-23T00:15:00Z'), 'confidence');
  assert.equal(formatAt({ pick_format: 'confidence' }, '1999-01-01T00:00:00Z'), 'confidence', 'no switch: from the start');
  assert.equal(formatAt(null, '2026-10-23T00:15:00Z'), 'regular', 'a league without the column is REGULAR');
});

test('THE LOCK: a free change before the first week locks; after it, QUEUED for next season', () => {
  const now = new Date('2026-10-08T12:00:00Z');
  const fresh = { pick_format: 'regular', pick_format_switch_open: false, starts_at: '2026-10-09T00:15:00Z', games: ['pickem'] };
  assert.equal(formatLocked(fresh, now), false);
  assert.deepEqual(planFormatChange(fresh, 'confidence', { now }), { ok: true, kind: 'set', from: null });
  const locked = { ...fresh, starts_at: '2026-10-02T00:15:00Z' };
  assert.equal(formatLocked(locked, now), true);
  assert.deepEqual(planFormatChange(locked, 'confidence', { now }), { ok: true, kind: 'queue', from: null });
  assert.equal(planFormatChange(locked, 'confidence', { now, isOwner: false }).code, 'not_owner');
  assert.equal(planFormatChange(locked, 'regular', { now }).code, 'same', 'the current format with nothing queued');
  assert.deepEqual(planFormatChange({ ...locked, pick_format_pending: 'confidence' }, 'regular', { now }), { ok: true, kind: 'clear', from: null },
    'choosing the current format while one is queued clears it');
  assert.equal(planFormatChange(fresh, 'regular', { now }).code, 'same');
  assert.equal(planFormatChange(fresh, 'confidence', { now, isOwner: false }).code, 'not_owner');
  assert.equal(planFormatChange({ ...fresh, games: ['daily'] }, 'confidence', { now }).code, 'no_pickem');
  assert.deepEqual(planFormatChange(fresh, 'ats', { now }), { ok: true, kind: 'set', from: null });
  assert.equal(planFormatChange({ ...fresh, pickemSports: ['nba'] }, 'ats', { now }).code, 'ats_sport', 'a non-football league cannot score ATS');
  assert.equal(planFormatChange(fresh, 'nonsense', { now }).code, 'bad_pick_format');
});

test('THE ONE-TIME SWITCH: from the 20 Oct week at the earliest, never a week already under way', () => {
  const now = new Date('2026-10-08T12:00:00Z');
  const old = { pick_format: 'regular', pick_format_switch_open: true, starts_at: '2026-09-11T00:15:00Z', games: ['pickem', 'daily'] };
  assert.equal(SWITCH_EARLIEST, CONFIDENCE_START);
  assert.deepEqual(planFormatChange(old, 'confidence', { now, weekStartsAt: '2026-10-06T04:00:00Z' }),
    { ok: true, kind: 'switch', from: CONFIDENCE_START }, 'used on 8 Oct: the 20 Oct week');
  assert.equal(planFormatChange(old, 'confidence', { now: new Date('2026-11-05T12:00:00Z'), weekStartsAt: '2026-11-10T05:00:00.000Z' }).from,
    '2026-11-10T05:00:00.000Z', 'used mid-week in November: the next week not under way');
  assert.equal(planFormatChange({ ...old, pick_format_switch_open: false }, 'confidence', { now }).kind, 'queue', 'used once, gone: a change now queues');
});

test('the offer the league page shows: owner only, Pick\'em only, and only while a change is possible', () => {
  const now = new Date('2026-10-08T12:00:00Z');
  const old = { pick_format: 'regular', pick_format_switch_open: true, starts_at: '2026-09-11T00:15:00Z', games: ['pickem'] };
  assert.deepEqual(switchOffer(old, { now, isOwner: true }), { to: 'confidence', options: ['confidence', 'ats'], kind: 'switch' });
  assert.equal(switchOffer(old, { now, isOwner: false }), null);
  assert.deepEqual(switchOffer({ ...old, pick_format_switch_open: false }, { now, isOwner: true }), { to: 'confidence', options: ['confidence', 'ats'], kind: 'queue' });
  assert.equal(switchOffer({ ...old, pick_format_switch_open: false, pick_format_pending: 'confidence' }, { now, isOwner: true }), null, 'a queued change shows Undo instead');
  assert.deepEqual(switchOffer({ ...old, pick_format_switch_open: false, starts_at: '2026-10-09T00:15:00Z' }, { now, isOwner: true }),
    { to: 'confidence', options: ['confidence', 'ats'], kind: 'set' });
  assert.deepEqual(switchOffer({ ...old, pickemSports: ['nba'] }, { now, isOwner: true }).options, ['confidence'], 'no ATS card off football');
  assert.equal(switchOffer({ ...old, games: ['daily'] }, { now, isOwner: true }), null);
});

test('shapeResults scores Pick\'em on the league\'s format at each contest\'s lock, and carries the record', () => {
  const row = (week, locks, conf, score, lineup, results) => ({
    game: 'pickem', sport: 'nfl', season_year: 2026, week, pd: null, locks_at: locks, settled: true, user_id: 1,
    score, conf, pk_lineup: lineup, pk_results: results, submitted_at: null,
  });
  const rows = [
    row(6, '2026-10-16T00:15:00Z', false, 2, { 1: 'home', 2: 'away', 3: 'home' }, { 1: 'home', 2: 'away', 3: 'away' }),
    row(7, '2026-10-23T00:15:00Z', true, 5, { 1: 'home', 2: 'away', 3: 'home' }, { 1: 'home', 2: 'away', 3: 'away' }),
  ];
  const regular = shapeResults({ contestRows: rows, unit: 'week', league: { pick_format: 'regular' } }).results;
  assert.deepEqual(regular.map((r) => r.score), [2, 2]);
  const conf = shapeResults({ contestRows: rows, unit: 'week', league: { pick_format: 'confidence' } }).results;
  assert.deepEqual(conf.map((r) => r.score), [2, 5]);
  const switched = shapeResults({ contestRows: [rows[1]], unit: 'week', league: { pick_format: 'confidence', pick_format_prev: 'regular', pick_format_from: '2026-10-27T04:00:00Z' } }).results;
  assert.deepEqual(switched.map((r) => r.score), [2], 'a week before the switch stays as it was scored');
  assert.deepEqual(conf.map((r) => r.record), [{ w: 2, l: 1 }, { w: 2, l: 1 }]);
  assert.equal(shapeResults({ contestRows: rows, unit: 'week' }).results[1].score, 2, 'no league given = REGULAR, as before');
});

test('the table: raw points total, W-L summed over the same window', () => {
  const members = [{ userId: 1, handle: 'a' }, { userId: 2, handle: 'b' }];
  const r = (userId, bucket, score, record) => ({ game: 'pickem', sport: 'nfl', period: bucket, bucket, userId, score, record });
  const { rows } = computeStandings({
    members, scoring: 'total',
    results: [r(1, '2026-10-20', 40, { w: 9, l: 4 }), r(1, '2026-10-27', 36, { w: 8, l: 5 }), r(2, '2026-10-20', 51, { w: 11, l: 2 })],
  });
  const by = Object.fromEntries(rows.map((x) => [x.userId, x]));
  assert.equal(by[1].total, 76);
  assert.deepEqual(by[1].record, { w: 17, l: 9 });
  assert.equal(by[2].total, 51);
  assert.deepEqual(by[2].record, { w: 11, l: 2 });
});

test('the create sheet asks "How should your league score?" from the shared copy; the board prints the record second', () => {
  const form = src('components/leagues/CreateLeagueForm.js');
  assert.match(form, /title=\{PICK_FORMAT_TITLE\}/);
  assert.match(form, /eligibleFormats\(\)\.map/);
  assert.match(form, /fd\.set\('pickFormat', effPick\)/);
  assert.ok(!/'ats'/.test(form), 'the sheet reads the eligible list, it names no format');
  const board = src('components/leagues/LeagueBoard.js');
  assert.match(board, /\{fmt\(r\.total\)\}\s*\{r\.record \? <span className="lv-trow-rec"/);
  assert.match(src('app/actions/leagues.js'), /pickFormat: formData\.get\('pickFormat'\)/);
});

test('THE MOCK COPY: the constants are the strings Derik signed off, and every surface reads the constants', () => {
  // The only place the literals are written out: a change to the copy is a change to this line.
  assert.equal(PICK_FORMAT_TITLE, 'How should your league score?');
  assert.equal(PICK_FORMAT_COPY.regular, 'Pick the winner of every game. One point each.');
  assert.equal(PICK_FORMAT_TAG.regular, 'Easiest to start');
  assert.equal(PICK_FORMAT_COPY.confidence, 'Pick winners, then rank them. Your surest pick is worth the most.');
  assert.equal(PICK_FORMAT_TAG.confidence, 'Same as the public game');
  assert.equal(PICK_FORMAT_LOCK_NOTE, "You can change this until your league's first week locks. After that, a change starts next season.");
  const form = src('components/leagues/CreateLeagueForm.js');
  for (const k of ['PICK_FORMAT_COPY[f]', 'PICK_FORMAT_TAG[f]', 'PICK_FORMAT_TITLE', 'PICK_FORMAT_LOCK_NOTE']) assert.ok(form.includes(k), `the create step reads ${k}`);
  assert.ok(src('components/leagues/PickFormatSwitch.js').includes('PICK_FORMAT_LOCK_NOTE'), 'the switch reads the same note');
});

test('pendingLine: names the queued format, nothing when none (or when it equals the current one)', () => {
  assert.equal(pendingLine({ pick_format: 'regular', pick_format_pending: 'confidence' }), 'Switches to Confidence next season');
  assert.equal(pendingLine({ pick_format: 'confidence', pick_format_pending: 'regular' }), 'Switches to Regular next season');
  assert.equal(pendingLine({ pick_format: 'regular', pick_format_pending: null }), null);
  assert.equal(pendingLine({ pick_format: 'regular', pick_format_pending: 'regular' }), null);
  assert.match(src('components/leagues/LeagueBoard.js'), /pendingLine\(league\) && <PendingPickFormat/);
});
