// lib/games/lobbyV2Shape.test.mjs — the Games tab v2 card shapes (GAMES TAB v2, item 9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyCard, weeklyCard, pickemRow, draftRow, introLine, numberWord, timeLeft, DASH } from './lobbyV2Shape.js';

const NOW = '2026-09-12T20:00:00Z';
const board = { id: 6, closesAt: '2026-09-13T04:00:00Z' };

test('Daily: play / in progress / done, stats with dashes never zeros', () => {
  const play = dailyCard({ board, run: null, uid: 1, now: NOW, edition: 27 });
  assert.equal(play.state, 'play'); assert.equal(play.cta, "Play today's board"); assert.equal(play.timeLeft, '8h 0m left');
  assert.deepEqual(play.stats.map((s) => s.value), [DASH, DASH, DASH], 'nothing played -> dashes, not 0');
  assert.equal(play.edition, 'Edition 27');
  const prog = dailyCard({ board, run: { startedAt: NOW, completedAt: null }, uid: 1, now: NOW });
  assert.equal(prog.state, 'in-progress'); assert.equal(prog.cta, 'In progress');
  const done = dailyCard({ board, run: { startedAt: NOW, completedAt: NOW }, uid: 1, now: NOW,
    yesterday: { score: 148.63 }, best: 171.2, rank: { rank: 18, of: 1204 } });
  assert.equal(done.state, 'done'); assert.equal(done.cta, 'Done · see your grade');
  assert.deepEqual(done.stats, [{ label: 'Yesterday', value: '148.6' }, { label: 'Best', value: '171.2' }, { label: 'of 1,204', value: '#18' }]);
  assert.equal(dailyCard({ board: null, uid: 1 }).state, 'none');
  const out = dailyCard({ board, uid: null, playingToday: 41, now: NOW });
  assert.equal(out.state, 'signed-out'); assert.equal(out.cta, 'Sign in to play'); assert.equal(out.stats[0].value, '41');
});

test('Weekly: unset / set / locked / settled, no projection stat anywhere', () => {
  const home = { state: 'play', filled: 3, remaining: 3, locksAt: '2026-09-15T00:15:00Z', week: 1 };
  const unset = weeklyCard({ home, uid: 1 });
  assert.equal(unset.state, 'unset'); assert.equal(unset.cta, 'Set your six'); assert.equal(unset.sub, 'Week 1 · 3 of 6 set');
  assert.ok(!unset.stats.some((s) => /project/i.test(s.label)), 'no projection exists - none is shown');
  const set = weeklyCard({ home: { ...home, filled: 6 }, scored: 31.4, rank: { rank: 212, of: 1204 }, uid: 1 });
  assert.equal(set.state, 'set'); assert.equal(set.cta, 'Lineup set · view');
  assert.deepEqual(set.stats, [{ label: 'Scored', value: '31.4' }, { label: 'of 1,204', value: '#212' }]);
  assert.equal(weeklyCard({ home: { ...home, state: 'locked', filled: 6 }, uid: 1 }).cta, 'Lineup locked · view');
  assert.equal(weeklyCard({ home: { ...home, state: 'settled', score: 120.5 }, uid: 1 }).stats[0].value, '120.5');
  assert.equal(weeklyCard({ home, uid: null }).cta, 'Sign in to play');
  assert.equal(weeklyCard({ home: null, uid: 1 }).state, 'none');
});

test("Pick'em: counts of pickable per sport, first lock, pill by state", () => {
  const nfl = { pickable: 14, pickedOpen: 0, nextKickoff: '2026-09-13T17:00:00Z' };
  const cfb = { pickable: 22, pickedOpen: 4, nextKickoff: '2026-09-12T20:00:00Z' };
  const r = pickemRow({ nfl, cfb, uid: 1 });
  assert.deepEqual(r.lines.map((l) => l.text), ['NFL 0 of 14 · first lock ', 'CFB 4 of 22 · first lock ']);
  assert.equal(r.lines[0].at, nfl.nextKickoff); assert.deepEqual(r.pill, { label: 'Pick', tone: 'volt' });
  assert.equal(r.firstLock, cfb.nextKickoff, 'the soonest of the two');
  assert.deepEqual(pickemRow({ nfl: { ...nfl, pickedOpen: 14 }, cfb: { ...cfb, pickedOpen: 22 }, uid: 1 }).pill, { label: 'Done', tone: 'jade' });
  assert.deepEqual(pickemRow({ nfl: { pickable: 0, pickedOpen: 0 }, cfb: null, uid: 1 }).pill, { label: 'Locked', tone: 'muted' });
  assert.equal(pickemRow({ nfl: null, cfb: null, uid: 1 }).lines[0].text, 'NFL no board yet');
  const out = pickemRow({ nfl, cfb: null, uid: null });
  assert.equal(out.lines[0].text, 'NFL 14 games · first lock '); assert.equal(out.pill, null);
});

test('Draft: rooms open <day> / rules / waiting / drafting / locked / settled', () => {
  const next = draftRow({ home: null, next: { opensAt: '2026-09-15T13:00:00Z', week: 2 } });
  assert.equal(next.lines[1].text, 'Week 2 rooms open '); assert.equal(next.lines[1].at, '2026-09-15T13:00:00Z');
  assert.deepEqual(next.pill, { label: 'Tue', tone: 'muted' });
  assert.equal(next.lines[0].text, '12 seats · 8 rounds · 30s clock');
  assert.deepEqual(draftRow({ home: { state: 'rules', week: 1, locksAt: '2026-09-13T17:00:00Z' } }).pill, { label: 'Draft', tone: 'volt' });
  assert.equal(draftRow({ home: { state: 'waiting', week: 1, picks: 5 } }).lines[1].text, 'Week 1 · your seat · 5 picks in');
  assert.deepEqual(draftRow({ home: { state: 'drafting', week: 1, seat: 4 } }).pill, { label: 'Live', tone: 'volt' });
  assert.equal(draftRow({ home: { state: 'locked', week: 1, entered: true } }).lines[1].text, 'Week 1 · your roster is in');
  assert.deepEqual(draftRow({ home: { state: 'settled', week: 1 } }).pill, { label: 'Done', tone: 'jade' });
  assert.deepEqual(draftRow({ home: null, next: null }).pill, { label: 'Locked', tone: 'muted' });
});

test('the intro line: three fixtures', () => {
  const daily = dailyCard({ board, run: null, uid: 1, now: NOW });
  const weekly = weeklyCard({ home: { state: 'play', filled: 6, locksAt: '2026-09-15T00:15:00Z', week: 1 }, uid: 1 });
  const nfl = { pickable: 14, pickedOpen: 0, nextKickoff: '2026-09-13T17:00:00Z' };
  // 1. the mock's Saturday: Daily + Weekly open, 14 NFL games lock Sunday
  const a = introLine({ daily, weekly, pickem: { ...pickemRow({ nfl, cfb: null, uid: 1 }), sports: { nfl, cfb: null } }, draft: draftRow({}) });
  assert.equal(a.open, 'Three boards open.');
  assert.deepEqual(a.lock, { count: 14, league: 'NFL', at: '2026-09-13T17:00:00Z' });
  // 2. everything done or closed: nothing open, no lock
  const b = introLine({ daily: dailyCard({ board: null, uid: 1 }), weekly: weeklyCard({ home: { state: 'locked', filled: 6, week: 1 }, uid: 1 }),
    pickem: { ...pickemRow({ nfl: { pickable: 0 }, cfb: null, uid: 1 }), sports: { nfl: { pickable: 0 }, cfb: null } }, draft: draftRow({ home: { state: 'locked', week: 1 } }) });
  assert.equal(b.open, 'No boards open.'); assert.equal(b.lock, null);
  // 3. signed out with a CFB lock sooner than the NFL one
  const cfb = { pickable: 22, pickedOpen: 0, nextKickoff: '2026-09-12T20:00:00Z' };
  const c = introLine({ daily: dailyCard({ board, uid: null, now: NOW }), weekly: null,
    pickem: { ...pickemRow({ nfl, cfb, uid: null }), sports: { nfl, cfb } }, draft: null });
  assert.equal(c.open, 'Two boards open.');
  assert.deepEqual(c.lock, { count: 22, league: 'CFB', at: '2026-09-12T20:00:00Z' });
});

test('number words and time left', () => {
  assert.equal(numberWord(14, { cap: true }), 'Fourteen'); assert.equal(numberWord(2), 'two'); assert.equal(numberWord(31), '31');
  assert.equal(timeLeft('2026-09-13T04:00:00Z', '2026-09-12T21:46:00Z'), '6h 14m left');
  assert.equal(timeLeft('2026-09-13T04:00:00Z', '2026-09-13T03:20:00Z'), '40m left');
  assert.equal(timeLeft('2026-09-13T04:00:00Z', '2026-09-13T05:00:00Z'), 'closed');
  assert.equal(timeLeft(null, NOW), null);
});
