// lib/games/playRegistry.test.mjs - the registry's entries and its pure item
// builders (thu-38 + fri-1). The reads are proven against DEV in
// playRegistryDb.test.mjs; this file proves the WORDS and the TIMES each
// game's state becomes, on fixtures relative to NOW.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PLAY_REGISTRY, weeklyItem, pickemItem, draftItem, octoberItem, runItem, seriesItem,
  nbaPickemItem, sixItem, dailyItem, survivorItem, eplWeekly5Item,
} from './playRegistry.js';
import { phaseOf, isActionable } from './playLobby.js';

const NOW = new Date('2026-10-01T18:00:00Z');
const H = 3_600_000;
const at = (ms) => new Date(NOW.getTime() + ms).toISOString();
const E = (key) => PLAY_REGISTRY.find((e) => e.key === key);
const IN = { signedIn: true, now: NOW };
const OUT = { signedIn: false, now: NOW };

test('ONE REGISTRY: every game the relay names, each a complete entry', () => {
  const keys = PLAY_REGISTRY.map((e) => e.key);
  for (const k of ['nfl-weekly', 'nfl-pickem', 'nfl-draft', 'cfb-pickem', 'mlb-october', 'mlb-run', 'mlb-series',
    'nba-pickem', 'nba-six', 'epl-weekly-5', 'daily']) assert.ok(keys.includes(k), `${k} is registered`);
  assert.equal(new Set(keys).size, keys.length, 'keys are unique');
  for (const e of PLAY_REGISTRY) {
    for (const f of ['key', 'sport', 'game', 'name', 'mark', 'href', 'cta', 'kicker']) {
      assert.equal(typeof e[f], 'string', `${e.key}.${f}`);
      assert.ok(e[f].length > 0, `${e.key}.${f} is not blank`);
    }
    assert.equal(typeof e.read, 'function', `${e.key}.read`);
    assert.equal(typeof e.item, 'function', `${e.key}.item`);
    assert.ok(e.href.startsWith('/'), `${e.key} links into the site`);
  }
  assert.equal(E('daily').sport, 'all', 'The Daily sits under ALL SPORTS');
});

test('EPL Weekly 5 is registered (merged 2 Oct), and Survivor stays behind its flag', () => {
  const src = readFileSync(new URL('./playRegistry.js', import.meta.url), 'utf8');
  assert.equal(E('epl-weekly-5')?.sport, 'epl');
  assert.equal(E('epl-weekly-5').href, '/epl-weekly-5');
  assert.match(src, /const survivor = survivorOn\(\) \? await survivorRowFor\(/, 'no /games row while the flag is off');
});

test('Weekly: open with a lock and 2 of 6 set; 6 of 6 is complete; the next week is a door', () => {
  const home = { state: 'building', week: 5, filled: 2, locksAt: at(30 * H) };
  const i = weeklyItem(E('nfl-weekly'), { home }, IN);
  assert.equal(i.title, 'Week 5');
  assert.equal(i.status, '2 of 6');
  assert.deepEqual(i.at, { iso: at(30 * H), words: 'locks' });
  assert.deepEqual(i.progress, { done: 2, total: 6 });
  assert.equal(isActionable(i, NOW), true);
  const full = weeklyItem(E('nfl-weekly'), { home: { ...home, filled: 6 } }, IN);
  assert.equal(full.complete, true);
  const play = weeklyItem(E('nfl-weekly'), { home: { state: 'play', week: 5, locksAt: at(30 * H) } }, IN);
  assert.equal(play.status, '0 of 6', 'no entry is 0 of 6, not a blank');
  const out = weeklyItem(E('nfl-weekly'), { home: { state: 'play', week: 5, locksAt: at(30 * H) } }, OUT);
  assert.equal(out.progress, null, 'signed out carries no progress');
  const door = weeklyItem(E('nfl-weekly'), { home: null, next: { opensAt: at(40 * H), week: 6 } }, IN);
  assert.equal(phaseOf(door, NOW), 'upcoming');
  assert.equal(weeklyItem(E('nfl-weekly'), { home: null, next: null }, IN), null, 'no week, no item');
  const locked = weeklyItem(E('nfl-weekly'), { home: { state: 'locked', week: 5, filled: 6, entered: true } }, IN);
  assert.equal(phaseOf(locked, NOW), 'locked');
});

test("Pick'em: the next kickoff is the lock; first lock vs next lock; all kicked is locked", () => {
  const card = { total: 16, picked: 3, pickable: 16, pickedOpen: 3, nextKickoff: at(2 * H), displayWeek: 5, boardNumber: 5 };
  const i = pickemItem(E('nfl-pickem'), { card }, IN);
  assert.equal(i.status, '3 of 16 picked');
  assert.equal(i.at.words, 'first lock');
  assert.equal(i.locksAt, at(2 * H));
  assert.deepEqual(i.progress, { done: 3, total: 16 });
  const mid = pickemItem(E('nfl-pickem'), { card: { ...card, pickable: 10, pickedOpen: 10, picked: 13 } }, IN);
  assert.equal(mid.at.words, 'next lock');
  assert.equal(mid.complete, true, 'every still-open game picked');
  const kicked = pickemItem(E('nfl-pickem'), { card: { ...card, pickable: 0, nextKickoff: null } }, IN);
  assert.equal(phaseOf(kicked, NOW), 'locked');
  const settled = pickemItem(E('cfb-pickem'), { card: { settled: true, record: { correct: 9, played: 12 }, displayWeek: 6 } }, IN);
  assert.equal(phaseOf(settled, NOW), 'done');
  const plan = pickemItem(E('cfb-pickem'), { card: null, plan: { opensAt: at(20 * H) } }, IN);
  assert.equal(phaseOf(plan, NOW), 'upcoming');
  assert.equal(pickemItem(E('cfb-pickem'), { card: null, plan: { opensAt: at(-H) } }, IN), null,
    'a planned door already past is a board the cron has not filed - no item, not an "opens" in the past');
});

test('Draft: on the clock names the round and BACK TO ROOM; a roster in is complete', () => {
  const live = draftItem(E('nfl-draft'), { home: { state: 'drafting', week: 4, locksAt: at(2 * H) }, round: 4 });
  assert.equal(live.status, 'Round 4 · your pick');
  assert.equal(live.cta, 'BACK TO ROOM');
  assert.equal(live.right, 'R4');
  assert.equal(isActionable(live, NOW), true);
  const waiting = draftItem(E('nfl-draft'), { home: { state: 'waiting', week: 4, locksAt: at(2 * H) } });
  assert.equal(isActionable(waiting, NOW), false);
  const rules = draftItem(E('nfl-draft'), { home: { state: 'rules', week: 4, locksAt: at(2 * H) } });
  assert.equal(isActionable(rules, NOW), true, 'an open room not taken is your move');
});

test('Draft signed out: the row shows, "Sign in to draft", and is never a move (fri-2)', () => {
  const i = draftItem(E('nfl-draft'), { home: null, next: null }, OUT);
  assert.equal(i.status, 'Sign in to draft');
  assert.equal(i.href, '/draft');
  assert.equal(phaseOf(i, NOW), 'locked', 'no lock to beat: not in YOUR MOVE');
});

test('October: the next unstarted first pitch is the lock; FINISH CARD once started', () => {
  const contest = { id: 1, board: [{ kickoff_at: at(-H) }, { kickoff_at: at(2 * H) }, { kickoff_at: at(5 * H) }], meta: { games: 3 } };
  const i = octoberItem(E('mlb-october'), { contest, filled: 2, size: 5 }, IN);
  assert.equal(i.locksAt, at(2 * H));
  assert.equal(i.status, '2 of 5 picked');
  assert.equal(i.cta, 'FINISH CARD');
  assert.equal(octoberItem(E('mlb-october'), { contest, filled: 0, size: 5 }, IN).cta, 'PICK FIVE');
  const done = octoberItem(E('mlb-october'), { contest: { ...contest, board: [{ kickoff_at: at(-H) }] }, filled: 5, size: 5 }, IN);
  assert.equal(phaseOf(done, NOW), 'locked', 'every game started: locked');
  assert.match(done.status, /locked/);
  assert.equal(octoberItem(E('mlb-october'), null, IN), null);
});

test('The Run: the next CLUB lock, or locked once every club has started', () => {
  const contest = { id: 2, meta: { label: 'Wild Card' } };
  const open = runItem(E('mlb-run'), { contest, next: { kickoffAt: at(3 * H) }, filled: 4, size: 9 }, IN);
  assert.equal(open.locksAt, at(3 * H));
  assert.equal(open.status, '4 of 9 set');
  const shut = runItem(E('mlb-run'), { contest, next: null, filled: 9, size: 9 }, IN);
  assert.equal(phaseOf(shut, NOW), 'locked');
  assert.equal(shut.status, 'Wild Card · locked');
});

test('Series Pick\'em: only while unsettled, locks at the round lock', () => {
  const s = { contest: { id: 3, locks_at: at(4 * H) }, label: 'Division Series', total: 4, picked: 1 };
  const i = seriesItem(E('mlb-series'), s, IN);
  assert.equal(i.status, '1 of 4 series picked');
  assert.equal(isActionable(i, NOW), true);
  assert.equal(seriesItem(E('mlb-series'), null, IN), null);
});

test("NBA Pick'em: counts on the CURRENT tips; before the first board, the slate's 6 AM ET door", () => {
  const st = { settled: false, games: 3, pickable: 2, pickedOpen: 1, picked: 2, score: null, nextTip: at(2 * H) };
  const i = nbaPickemItem(E('nba-pickem'), { st }, IN);
  assert.equal(i.status, '1 of 2 picked');
  assert.deepEqual(i.at, { iso: at(2 * H), words: 'next lock' });
  assert.equal(i.groupNote, 'Tonight · 3 games');
  const tipped = nbaPickemItem(E('nba-pickem'), { st: { ...st, pickable: 0, nextTip: null } }, IN);
  assert.match(tipped.status, /all tipped · 2 picked/);
  assert.equal(phaseOf(tipped, NOW), 'locked');
  const settled = nbaPickemItem(E('nba-pickem'), { st: { settled: true, games: 3, score: 2, max: 3 } }, IN);
  assert.equal(settled.status, 'Settled · 2 of 3 right');
  const door = nbaPickemItem(E('nba-pickem'), { st: null, plan: { opensAt: at(19 * 24 * H), board: [{}, {}, {}] } }, IN);
  assert.equal(phaseOf(door, NOW), 'upcoming');
  assert.equal(door.status, 'Daily · 3 games');
});

test("Tonight's Six: n of 6, the next tip is the lock, all tipped is locked", () => {
  const i = sixItem(E('nba-six'), { st: { games: 3, filled: 4, locked: 0, size: 6, nextTip: at(H) } }, IN);
  assert.equal(i.status, '4 of 6');
  assert.equal(i.at.words, 'next tip');
  assert.deepEqual(i.progress, { done: 4, total: 6 });
  const tipped = sixItem(E('nba-six'), { st: { games: 3, filled: 6, locked: 6, size: 6, nextTip: null } }, IN);
  assert.equal(tipped.status, '3 games · all tipped · 6 of 6 in play');
  assert.equal(phaseOf(tipped, NOW), 'locked');
});

test('The Daily: open until it closes; played is complete; no board is no move', () => {
  const play = dailyItem(E('daily'), { state: 'play', closesAt: at(6 * H) }, IN);
  assert.equal(isActionable(play, NOW), true);
  assert.deepEqual(play.at, { iso: at(6 * H), words: 'closes' });
  const done = dailyItem(E('daily'), { state: 'done', closesAt: at(6 * H) }, IN);
  assert.equal(isActionable(done, NOW), false);
  assert.equal(phaseOf(dailyItem(E('daily'), { state: 'none' }, IN), NOW), 'locked');
  const out = dailyItem(E('daily'), { state: 'signed-out', closesAt: at(6 * H) }, OUT);
  assert.equal(phaseOf(out, NOW), 'open');
});

test('EPL Weekly 5: the next kickoff is the lock; first lock before any has kicked', () => {
  const contest = { id: 9, week: 7, settled: false };
  const i = eplWeekly5Item(E('epl-weekly-5'), { contest, filled: 2, size: 5, nextKickoff: at(4 * H), kicked: false }, IN);
  assert.equal(i.title, 'Gameweek 7');
  assert.equal(i.status, '2 of 5 picked');
  assert.deepEqual(i.at, { iso: at(4 * H), words: 'first lock' });
  assert.equal(isActionable(i, NOW), true);
  const mid = eplWeekly5Item(E('epl-weekly-5'), { contest, filled: 5, size: 5, nextKickoff: at(H), kicked: true }, IN);
  assert.equal(mid.at.words, 'next lock');
  assert.equal(mid.complete, true);
  const done = eplWeekly5Item(E('epl-weekly-5'), { contest: { ...contest, settled: true }, filled: 5, size: 5, score: 31 }, IN);
  assert.equal(phaseOf(done, NOW), 'done');
  assert.equal(eplWeekly5Item(E('epl-weekly-5'), null, IN), null);
});

test('NO TIME IS BAKED INTO A STATUS: every item carries its instant, and its words carry no clock', () => {
  const items = [
    weeklyItem(E('nfl-weekly'), { home: { state: 'building', week: 5, filled: 2, locksAt: at(30 * H) } }, IN),
    pickemItem(E('nfl-pickem'), { card: { total: 3, picked: 1, pickable: 3, pickedOpen: 1, nextKickoff: at(H), displayWeek: 5 } }, IN),
    octoberItem(E('mlb-october'), { contest: { board: [{ kickoff_at: at(H) }], meta: { games: 1 } }, filled: 1, size: 5 }, IN),
    runItem(E('mlb-run'), { contest: { meta: { label: 'Wild Card' } }, next: { kickoffAt: at(H) }, filled: 1, size: 9 }, IN),
    nbaPickemItem(E('nba-pickem'), { st: { games: 2, pickable: 2, pickedOpen: 0, picked: 0, nextTip: at(H) } }, IN),
    sixItem(E('nba-six'), { st: { games: 2, filled: 0, size: 6, nextTip: at(H) } }, IN),
    survivorItem(E('nfl-survivor'), { line: 'One team a week · no pick yet' }),
    eplWeekly5Item(E('epl-weekly-5'), { contest: { week: 7 }, filled: 1, size: 5, nextKickoff: at(H), kicked: false }, IN),
  ];
  for (const i of items) {
    assert.doesNotMatch(`${i.status} ${i.title}`, /\d{1,2}:\d{2}|\b(AM|PM|PT|ET)\b/, `${i.key}: "${i.status}"`);
  }
});
