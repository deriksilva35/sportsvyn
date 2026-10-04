// components/games/legibility.test.mjs - the games legibility pass, phase 1.
//
// The defect this pins against: 60 draft-cohort signups, 11 Daily players
// ever - cards that named their games without selling them. The cure is
// ratified copy and shared grammar, so the pins are copy-exact and
// one-definition.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME_META, GAME_ORDER } from '../../lib/games/lobby.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

test('the hook copy is the ratified copy, word for word', () => {
  // sat-5 Y3: the old Daily hook said opening a team commits you. It does not -
  // a placed pick can be cleared and the team given back.
  assert.equal(GAME_META.daily.hook,
    'Twelve team cards from one past season. Fill **eight slots**, one player per team, and **four teams** go unused.');
  assert.equal(GAME_META.daily.blurb, 'Twelve teams. Eight slots. Three minutes.');
  assert.equal(GAME_META.pickem.hook,
    'Call the winner of **every game** on the board - college Saturdays, NFL Sundays.');
  assert.equal(GAME_META.weekly.hook,
    'Roster **any six NFL players**. Real-game scoring, best five count.');
  assert.equal(GAME_META.draft.hook,
    'Snake draft vs **a full AI room**. Pick your seat, beat the clock.');
});

test('every card carries meta chips: time cost first, cadence second', () => {
  // sat-5: the clock is three minutes (DAILY_ROUND_SECONDS = 180), not two.
  assert.deepEqual(GAME_META.daily.chips, ['3 min', 'every day', 'four teams unused']);
  assert.deepEqual(GAME_META.pickem.chips, ['1 min', 'weekly', 'locks per game']);
  assert.deepEqual(GAME_META.weekly.chips, ['90 sec', 'every NFL week']);
  assert.deepEqual(GAME_META.draft.chips, ['10 min', 'weekly · ranked']);
  for (const k of GAME_ORDER) assert.ok(GAME_META[k].num, `${k} carries its ghost numeral`);
});

test('hyphens only, in hooks and in the hero copy', () => {
  for (const k of GAME_ORDER) {
    assert.doesNotMatch(GAME_META[k].hook, /[‐-―−]/, `${k} hook carries a non-hyphen dash`);
  }
  const room = src('components/daily/DailyRoom.js');
  const hero = room.slice(room.indexOf('className="dhero"'), room.indexOf('className="dsteps"'));
  assert.doesNotMatch(hero, /[‐-―−]/, 'hero copy carries a non-hyphen dash');
});

test('chrome still owns Hook/MetaChips/Pulse; Daily still renders through it', () => {
  // /games no longer does (relay 2a): the legibility pass's hook-and-chip
  // card grid is gone from the lobby, replaced by the remock's "Today's
  // boards" rows, which sell the game through the state line itself rather
  // than a bolded hook sentence. chrome.js is not dead - /daily's own hero
  // still uses Pulse - so the module and its exports stay, this assertion
  // just stops claiming /games is a second consumer.
  const chrome = src('components/games/chrome.js');
  for (const name of ['export function Hook', 'export function MetaChips', 'export function Pulse']) {
    assert.ok(chrome.includes(name), `chrome owns ${name.split(' ').pop()}`);
  }
  // /daily (v1) was the last page rendering through chrome; it 308s to the
  // season board since sat-5 Y1 (app/daily/v1Retired.test.mjs), so there is
  // no page left to pin here.
});

test('pulse facts come from the readers - the page writes no SQL', () => {
  assert.ok(!/sql`/.test(src('app/games/page.js')), 'no ad-hoc SQL on the lobby page');
  const read = src('lib/games/read.js');
  assert.match(read, /todayEntrantCount\(\)/, 'the playing count is a reader');
  assert.match(read, /cards\[0\]\.pulse = \{ playing: playingToday, perfect: yesterday\?\.perfect/);
});

test('the Daily hero carries the history angle - the amendment, not the mock', () => {
  const room = src('components/daily/DailyRoom.js');
  assert.match(room, /Six picks\.<br \/>One week of history\./);
  assert.match(room, /Every board is a real week pulled from NFL history\. Draft six, the sim\s+replays the week at <b>midnight ET<\/b>, and every score reveals\./);
  assert.match(room, /'DRAFT YOUR SIX'/);
  assert.match(room, /takes about 2 minutes/);
  assert.ok(!room.includes('One perfect board'), "the mock's pre-amendment hero is dead");
});

test('the steps row teaches the loop: draft, reveal, guess', () => {
  const room = src('components/daily/DailyRoom.js');
  const steps = room.slice(room.indexOf('className="dsteps"'), room.indexOf('{statRow}'));
  assert.match(steps, /Six players, any position mix/);
  assert.match(steps, /Sim replays the week at midnight ET/);
  assert.match(steps, /Name the season for a bonus/);
});

// The v1 page's stat-row and yesterday-line tests left with the page (sat-5
// Y1): /daily is a 308 now, pinned in app/daily/v1Retired.test.mjs.
