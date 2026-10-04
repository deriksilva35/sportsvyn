// EPL Weekly 5, ruling sat-5 - PURE:
//   E1  a postponed fixture does not pin "next gameweek"; a re-dated one is a
//       straggler for opening, 'moved' for its old board, and carried by the
//       gameweek it is now played in;
//   E2  a club with two fixtures on the board scores both, locks at the first;
//   E4  the rules copy states every rule the scorer applies.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextRoundOf, carriedOf } from './create.js';
import {
  movedOutOf, effectiveFixtures, pickFixtures, pickLockAt, lockedSlots, refuseReason, clearRefusal,
  MOVED_OUT_H, isOffStatus,
} from './rules.js';
import { scoreSlot, clubFixtures, pickPairs } from './data.js';
import { perfectCandidates, settleGate } from './settle.js';
import { fixtureChip } from './entry.js';
import { RULES_LINES, scoreLine } from './scoring.js';
import { perfectFive } from './board.js';

const H = 3600e3;
const T = Date.parse('2026-10-10T11:30:00Z');
const iso = (h) => new Date(T + h * H).toISOString();

// ---------------------------------------------------------------------------
// E1
// ---------------------------------------------------------------------------
const fx = (week, status, h) => ({ season: 2026, week, status, kickoff_at: iso(h) });

test('E1: the lowest round with a fixture still to play opens', () => {
  assert.deepEqual(nextRoundOf([fx(5, 'final', -48), fx(5, 'scheduled', 2), fx(6, 'scheduled', 100)]), { season: 2026, week: 5 });
  assert.deepEqual(nextRoundOf([fx(5, 'final', -48), fx(5, 'live', 0), fx(6, 'scheduled', 100)]), { season: 2026, week: 5 });
  assert.equal(nextRoundOf([fx(5, 'final', -48)]), null);
});

test('E1: a POSTPONED fixture does not pin its round - the next gameweek opens on schedule', () => {
  const rows = [fx(5, 'final', -48), fx(5, 'postponed', -24), fx(6, 'scheduled', 100), fx(7, 'scheduled', 260)];
  assert.deepEqual(nextRoundOf(rows), { season: 2026, week: 6 });
  // cancelled and not_needed never did
  assert.deepEqual(nextRoundOf([fx(5, 'cancelled', 2), fx(6, 'scheduled', 100)]), { season: 2026, week: 6 });
});

test('E1: a postponed fixture RE-DATED weeks later is a straggler - it never drags "next" back', () => {
  // GW5's fixture re-dated into January, after GW6..GW20 have been played
  const rows = [fx(5, 'final', -48), fx(5, 'scheduled', 2000), fx(6, 'final', 100), fx(20, 'final', 1900), fx(21, 'scheduled', 2100)];
  assert.deepEqual(nextRoundOf(rows), { season: 2026, week: 21 });
  // ... but a round whose last fixture is simply later than usual (no later
  // round has started) still holds: that is the old rule, unchanged
  assert.deepEqual(nextRoundOf([fx(5, 'final', -48), fx(5, 'scheduled', 50), fx(6, 'scheduled', 100)]), { season: 2026, week: 5 });
  // a later round's POSTPONED fixture does not make anything a straggler
  assert.deepEqual(nextRoundOf([fx(5, 'scheduled', 50), fx(6, 'postponed', 10), fx(6, 'scheduled', 100)]), { season: 2026, week: 5 });
});

test('E1: a fixture is MOVED out of its gameweek when it kicks off more than 72h after the rest of it', () => {
  assert.equal(MOVED_OUT_H, 72);
  const others = [iso(0), iso(30)];
  assert.equal(movedOutOf(iso(30 + 72), others), false, 'at the boundary: still this gameweek');
  assert.equal(movedOutOf(iso(30 + 73), others), true);
  assert.equal(movedOutOf(iso(-500), others), false, 'brought forward is not moved out');
  assert.equal(movedOutOf(iso(9999), []), false, 'a one-fixture board has nothing to move away from');
  const board = [{ match_id: 1, kickoff_at: iso(0) }, { match_id: 2, kickoff_at: iso(30) }, { match_id: 3, kickoff_at: iso(20) }];
  const rows = new Map([
    ['1', { id: 1, status: 'final', kickoff_at: iso(0) }],
    ['2', { id: 2, status: 'final', kickoff_at: iso(30) }],
    ['3', { id: 3, status: 'scheduled', kickoff_at: iso(2000) }],   // re-dated to January
  ]);
  const eff = effectiveFixtures(board, rows);
  assert.equal(eff.get('3').status, 'moved');
  assert.equal(eff.get('3').raw_status, 'scheduled');
  assert.equal(eff.get('1').status, 'final');
  assert.ok(isOffStatus('moved'));
  assert.deepEqual(fixtureChip(eff.get('3')), { kind: 'off', text: 'MOVED' });
  // the settle does not wait for it
  const gate = settleGate(board, new Map([...eff].map(([k, m]) => [k, { ...m, resync_at: 'x' }])), new Date(T + 100 * H));
  assert.equal(gate.ready, true);
  // a slot on it never seals and can be cleared; it cannot be picked
  const lineup = { mid: { playerId: 9, matchId: 3, clubId: null, pos: 'MID' } };
  const statusBy = new Map([...eff].map(([k, m]) => [k, m.status]));
  const kickoffBy = new Map([...eff].map(([k, m]) => [k, m.kickoff_at]));
  assert.equal(lockedSlots(lineup, board, new Date(T + 3000 * H), { statusBy, kickoffBy }).size, 0);
  assert.equal(clearRefusal(lineup, 'mid', { board, now: new Date(T + 3000 * H), statusBy, kickoffBy }), null);
  assert.equal(refuseReason({}, 'mid', { playerId: 8, matchId: 3, clubId: 5, pos: 'MID' }, { board, now: new Date(T + 40 * H), statusBy, kickoffBy }), 'not_played');
});

test('E1: the gameweek a re-dated fixture is now played in CARRIES it - once', () => {
  const lastKickoff = iso(2150);
  const cand = (o) => ({ match_id: 77, week: 5, kickoff_at: iso(2000), others: [iso(-48), iso(-20)], ...o });
  assert.deepEqual(carriedOf([cand()], { week: 21, lastKickoff, now: new Date(T + 1950 * H) }).map((c) => c.match_id), [77]);
  assert.equal(carriedOf([cand({ kickoff_at: iso(2200) })], { week: 21, lastKickoff, now: new Date(T + 1950 * H) }).length, 0, 'after this window: a later gameweek\'s');
  assert.equal(carriedOf([cand()], { week: 21, lastKickoff, now: new Date(T + 2001 * H) }).length, 0, 'already kicked off: never carried into a board that opens after it');
  assert.equal(carriedOf([cand({ week: 21 })], { week: 21, lastKickoff, now: new Date(T + 1950 * H) }).length, 0, 'its own round is not a carry');
  // not moved out of its own gameweek (re-dated two days later): it stays there
  assert.equal(carriedOf([cand({ kickoff_at: iso(10), others: [iso(-48), iso(-20)] })], { week: 6, lastKickoff: iso(100), now: new Date(T) }).length, 0);
});

// ---------------------------------------------------------------------------
// E2
// ---------------------------------------------------------------------------
// ARS (42) plays twice: m1 Sat and m3 Wed. LIV (40) once.
const BOARD = [
  { match_id: 1, kickoff_at: iso(0), home: { id: 42, abbr: 'ARS' }, away: { id: 11, abbr: 'LEE' } },
  { match_id: 2, kickoff_at: iso(28), home: { id: 40, abbr: 'LIV' }, away: { id: 12, abbr: 'MCI' } },
  { match_id: 3, kickoff_at: iso(100), home: { id: 13, abbr: 'CHE' }, away: { id: 42, abbr: 'ARS' } },
];
const ars = { playerId: 7, matchId: 1, clubId: 42, pos: 'FWD' };
const liv = { playerId: 8, matchId: 2, clubId: 40, pos: 'MID' };

test('E2: a club with two fixtures - both are his, in board order', () => {
  assert.deepEqual(pickFixtures(ars, BOARD).map((g) => g.match_id), [1, 3]);
  assert.deepEqual(pickFixtures(liv, BOARD).map((g) => g.match_id), [2]);
  assert.deepEqual(pickPairs(ars, BOARD), [{ matchId: 1, playerId: 7 }, { matchId: 3, playerId: 7 }]);
  const cf = clubFixtures(BOARD);
  assert.deepEqual(cf.get('42').matchIds, [1, 3]);
  assert.equal(cf.get('42').opp, 'vs LEE, @ CHE');
  assert.equal(cf.get('42').matchId, 1, 'the first fixture is the one the pick names');
  assert.equal(cf.get('40').opp, 'vs MCI');
});

test('E2: the slot locks at his club\'s FIRST fixture (current kickoff) - not the second', () => {
  assert.equal(pickLockAt(ars, BOARD), T);
  const between = new Date(T + 10 * H);
  assert.ok(lockedSlots({ fwd: ars }, BOARD, between).has('fwd'), 'sealed after m1 although m3 is days away');
  assert.equal(refuseReason({}, 'fwd', ars, { board: BOARD, now: between }), 'game_started');
  assert.equal(refuseReason({}, 'mid', liv, { board: BOARD, now: between }), null);
  // the first moved later (live kickoff): the lock follows it
  const kickoffBy = new Map([['1', iso(50)]]);
  assert.equal(pickLockAt(ars, BOARD, { kickoffBy }), T + 50 * H);
  assert.equal(refuseReason({}, 'fwd', ars, { board: BOARD, now: between, kickoffBy }), null);
  // the first POSTPONED: the lock moves to the second, and he is still pickable
  const statusBy = new Map([['1', 'postponed']]);
  assert.equal(pickLockAt(ars, BOARD, { statusBy }), T + 100 * H);
  assert.equal(refuseReason({}, 'fwd', ars, { board: BOARD, now: between, statusBy }), null);
  assert.equal(lockedSlots({ fwd: ars }, BOARD, between, { statusBy }).size, 0);
  // both off: not played, never seals
  const both = new Map([['1', 'postponed'], ['3', 'cancelled']]);
  assert.ok(Number.isNaN(pickLockAt(ars, BOARD, { statusBy: both })));
  assert.equal(refuseReason({}, 'fwd', ars, { board: BOARD, now: between, statusBy: both }), 'not_played');
});

test('E2: a board with no team ids (an older snapshot) falls back to the one fixture the pick names', () => {
  const bare = BOARD.map(({ match_id, kickoff_at }) => ({ match_id, kickoff_at }));
  assert.deepEqual(pickFixtures(ars, bare).map((g) => g.match_id), [1]);
});

const line = (o) => ({ row: { minutes_played: 90, goals: 0, assists: 0, yellow_cards: 0, red_cards: 0, conceded_on_pitch: 1, ...o }, source: 'stats' });

test('E2: he scores EVERY fixture - the slot is the sum, live and final', () => {
  const m = (status) => ({ status, home_team_id: 42, away_team_id: 11, home_score: 1, away_score: 1 });
  const fxs = new Map([['1', m('final')], ['3', { ...m('scheduled'), home_team_id: 13, away_team_id: 42 }]]);
  const lines = new Map([['1:7', line({ goals: 1 })]]);          // 2 + 4 = 6
  let s = scoreSlot(ars, BOARD, fxs, lines);
  assert.equal(s.points, 6);
  assert.equal(s.state, 'live', 'one done, one to come');
  assert.equal(s.fixtures.length, 2);
  assert.deepEqual(s.fixtures.map((f) => f.state), ['final', 'pending']);
  fxs.set('3', { ...m('final'), home_team_id: 13, away_team_id: 42 });
  lines.set('3:7', line({ goals: 2, assists: 1 }));               // 2 + 8 + 3 = 13
  s = scoreSlot(ars, BOARD, fxs, lines);
  assert.equal(s.points, 19);
  assert.equal(s.state, 'final');
  assert.equal(s.parts.filter((p) => p.key === 'goal').length, 3);
  // the settle reads stored stats only: a live line in the second never counts
  lines.set('3:7', { ...line({ goals: 2, assists: 1 }), source: 'live' });
  assert.equal(scoreSlot(ars, BOARD, fxs, lines, { statsOnly: true }).points, 6);
  // the second fixture postponed: the first alone, slot final
  fxs.set('3', { ...m('postponed') });
  s = scoreSlot(ars, BOARD, fxs, new Map([['1:7', line({ goals: 1 })]]));
  assert.equal(s.points, 6);
  assert.equal(s.state, 'final');
  // a single-fixture club is unchanged
  assert.equal(scoreSlot(liv, BOARD, new Map([['2', { status: 'scheduled' }]]), new Map()).state, 'pending');
  assert.equal(scoreSlot(null, BOARD).state, 'empty');
});

test('E2: the perfect five counts a double-gameweek player once, with both fixtures summed', () => {
  const r = (pid, mid, team, pos, o) => ({ player_id: pid, match_id: mid, team_id: team, position: pos, name: `P${pid}`, minutes_played: 90, goals: 0, assists: 0, conceded_on_pitch: 1, ...o });
  const rows = [r(7, 1, 42, 'Attacker', { goals: 1 }), r(7, 3, 42, 'Attacker', { goals: 1 }), r(8, 2, 40, 'Midfielder', {})];
  const c = perfectCandidates(rows, new Map(), new Map([['42', 'ARS']]));
  assert.equal(c.length, 2);
  assert.equal(c.find((x) => x.playerId === '7').points, 12);
  assert.equal(c.find((x) => x.playerId === '7').club, 'ARS');
  const cands = [...c,
    { playerId: 'g', pos: 'GK', clubId: 1, points: 2 }, { playerId: 'd', pos: 'DEF', clubId: 2, points: 2 },
    { playerId: 'm', pos: 'MID', clubId: 3, points: 2 }];
  assert.equal(perfectFive(cands).players.find((p) => p.playerId === '7').points, 12);
});

// ---------------------------------------------------------------------------
// E4
// ---------------------------------------------------------------------------
test('E4: the rules copy states the clean-sheet, second-yellow, yellow-cap and flag rules', () => {
  const all = RULES_LINES.join('\n');
  assert.match(all, /Clean sheet: DEF\/GK 4 · MID 1/);
  assert.match(all, /60\+ minutes/);
  assert.match(all, /concede nothing while he is on the pitch/);
  assert.match(all, /nothing in the whole match/, 'the whole-match fallback');
  assert.match(all, /second yellow: −3 in all, not −4/);
  assert.match(all, /Yellow −1 - one per match at most/);
  assert.match(all, /flagged \(INJ, SUSP, DOUBT\), not blocked/);
  assert.match(all, /scores both, and his pick locks at the first/);
  // ... and the copy is what the scorer does
  const base = { position: 'DEF', minutes: 90, concededOnPitch: 1 };
  assert.equal(scoreLine({ ...base, yellow: 2, red: 1 }).points, 2 - 3, 'second yellow: -3, not -4');
  assert.equal(scoreLine({ ...base, yellow: 2 }).points, 2 - 1, 'yellows cap at -1');
  assert.equal(scoreLine({ ...base, concededOnPitch: 0 }).points, 2 + 4);
  assert.equal(scoreLine({ ...base, minutes: 59, concededOnPitch: 0 }).points, 1, 'no clean sheet under 60');
});
