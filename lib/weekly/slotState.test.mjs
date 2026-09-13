// lib/weekly/slotState.test.mjs - the four states a slot can be in, and the
// rule that a number never appears before there is one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { slotState, slotStates, countingIds } from './slotState.js';

// COMMENTS ARE STRIPPED BEFORE THE SOURCE PINS BELOW RUN. Every one of those
// files EXPLAINS in prose that there is one scorer and that it is
// fantasyPoints - which is exactly the sentence a naive grep then trips on.
// The pin is about what the code does, so the prose comes out first.
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const src = (rel) => stripComments(readFileSync(new URL(rel, import.meta.url), 'utf8'));

const row = (o = {}) => ({ slot: 'QB', id: 7, name: 'A Player', team: 'KC', points: 0, played: false, ...o });
const FINAL = { status: 'final' };
const LIVE = { status: 'live', metadata: { live_state: { period: 3, clock: '7:22' } } };
const SCHED = { status: 'scheduled', kickoffAt: '2026-09-14T20:25:00Z' };

test('A FINAL GAME shows the final number', () => {
  const st = slotState({ row: row({ points: 18.4, played: true }), game: FINAL });
  assert.equal(st.kind, 'final');
  assert.equal(st.label, 'final');
  assert.equal(st.started, true);
  assert.equal(st.points, 18.4);
  assert.equal(st.kickoffAt, null);
});

test('A LIVE GAME shows the running number and the clock', () => {
  const st = slotState({ row: row({ points: 6.1, played: true }), game: LIVE });
  assert.equal(st.kind, 'live');
  assert.equal(st.label, 'Q3 7:22', 'the word Live is dropped - the row already reads as live');
  assert.equal(st.started, true);
  assert.equal(st.points, 6.1);
});

test('a live game with no period falls back to the bare word', () => {
  const st = slotState({ row: row({ played: true }), game: { status: 'live', metadata: null } });
  assert.equal(st.label, 'Live');
  assert.equal(st.started, true);
});

test('AN UNSTARTED GAME shows the kickoff, and NO number', () => {
  const st = slotState({ row: row(), game: SCHED });
  assert.equal(st.kind, 'scheduled');
  assert.equal(st.started, false);
  assert.equal(st.points, null, 'a 0 beside a man who has not kicked off is a wrong number, not a low one');
  assert.equal(st.kickoffAt, SCHED.kickoffAt);
  assert.equal(st.label, null);
});

test('A BYE is its own state and borrows no kickoff', () => {
  const st = slotState({ row: row({ team: 'DET' }), game: null });
  assert.equal(st.kind, 'bye');
  assert.equal(st.label, 'bye');
  assert.equal(st.started, false);
  assert.equal(st.points, null);
  assert.equal(st.kickoffAt, null, 'there is no game, so there is no time to print');
});

test('an empty slot is empty, not a bye and not a zero', () => {
  assert.equal(slotState({ row: row({ id: null, name: null, team: null }) }).kind, 'empty');
  assert.equal(slotState({ row: null }).kind, 'empty');
  assert.equal(slotState({}).points, null);
});

test('THE STAT ROWS WIN OVER THE SLATE, both directions', () => {
  // Points with no game at all: the stat row is the authority on whether he
  // played, and a slate join that missed must not erase a real number.
  const orphan = slotState({ row: row({ points: 12.2, played: true }), game: null });
  assert.equal(orphan.kind, 'final');
  assert.equal(orphan.points, 12.2);
  // And a stat row for a game the slate still calls scheduled still counts -
  // but it does not promote the row to 'final', because the slate is the
  // authority on the state and it has not said so.
  const early = slotState({ row: row({ points: 3.1, played: true }), game: SCHED });
  assert.equal(early.started, true);
  assert.equal(early.points, 3.1);
  assert.equal(early.kind, 'scheduled');
  assert.equal(early.label, null, 'we do not claim final on a slate that says otherwise');
  assert.equal(early.kickoffAt, null, 'and a kickoff time beside a score is the reading that is certainly wrong');
});

test('slotStates totals only what it would print, and counts what started', () => {
  const rows = [
    row({ slot: 'QB', id: 1, team: 'KC', points: 18.4, played: true }),
    row({ slot: 'RB', id: 2, team: 'SF', points: 6.1, played: true }),
    row({ slot: 'WR', id: 3, team: 'NE', points: 0, played: false }),
    row({ slot: 'TE', id: 4, team: 'DET', points: 0, played: false }),
    row({ slot: 'FLEX', id: null, name: null, team: null }),
    row({ slot: 'FLEX2', id: null, name: null, team: null }),
  ];
  const games = new Map([['KC', FINAL], ['SF', LIVE], ['NE', SCHED]]);  // DET on a bye
  const v = slotStates({ rows, gamesByTeam: games });
  assert.equal(v.total, 24.5);
  assert.equal(v.startedCount, 2);
  assert.equal(v.slots, 4, 'two unset slots are not slots with a player in them');
  assert.deepEqual(v.rows.map((x) => x.state.kind),
    ['final', 'live', 'scheduled', 'bye', 'empty', 'empty']);
});

test('THE HEADER TOTAL IS THE SUM OF THE ROWS UNDER IT', () => {
  const rows = [
    row({ slot: 'QB', id: 1, team: 'KC', points: 18.4, played: true }),
    row({ slot: 'RB', id: 2, team: 'SF', points: 6.1, played: true }),
    row({ slot: 'WR', id: 3, team: 'NE', points: 0, played: false }),
  ];
  const v = slotStates({ rows, gamesByTeam: new Map([['KC', FINAL], ['SF', LIVE], ['NE', SCHED]]) });
  const shown = v.rows.reduce((a, x) => a + (x.state.points ?? 0), 0);
  assert.equal(v.total, Math.round(shown * 10) / 10);
});

test('countingIds names the six bestBall chose and invents nothing', () => {
  assert.deepEqual([...countingIds([{ id: 4 }, { id: 9 }, { id: null }])], [4, 9]);
  assert.equal(countingIds([]).size, 0);
  assert.equal(countingIds().size, 0);
});

// ---------------------------------------------------------------------------
// ONE SCORER (relay item 4)
// ---------------------------------------------------------------------------
test('THIS MODULE SCORES NOTHING - it decides what to show, never what a player is worth', () => {
  const t = src('./slotState.js');
  assert.equal(/fantasyPoints/.test(t), false, 'no scorer may be imported here');
  assert.equal(/SCORING|RECEPTION_PTS|passYds|recYds|rushTd/.test(t), false,
    'no scoring rule may be reimplemented here');
});

test('the live path has exactly ONE producer of points, and it is fantasyPoints', () => {
  // poolWithScores is the only thing that turns stat rows into points, and it
  // calls the one scorer. liveEntryRows reads that output and adds it up.
  const settle = src('./settle.js');
  assert.match(settle, /import \{ fantasyPoints \} from '\.\.\/fantasy\/scoring\.js'/);
  assert.match(settle, /byPlayer\.set\(r\.id, prev \+ fantasyPoints\(toStatLine\(r\), 'ppr'\)\)/);

  const live = src('./live.js');
  assert.equal(/fantasyPoints/.test(live), false, 'live.js sums, it does not score');
  assert.match(live, /import \{ poolWithScores \} from '\.\/settle\.js'/);

  // And no surface in the live path may reach for the scorer itself.
  for (const f of ['../../app/weekly/page.js', '../../app/draft/page.js',
    '../draft/liveCard.js', '../../components/weekly/WeeklyRoom.js']) {
    assert.equal(/fantasyPoints/.test(src(f)), false, `${f} must not score anything itself`);
  }
});
