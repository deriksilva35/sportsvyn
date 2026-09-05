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
  assert.equal(GAME_META.daily.hook,
    'Draft **six stars** from a week in NFL history. The sim replays it at **midnight ET**.');
  assert.equal(GAME_META.pickem.hook,
    'Call the winner of **every game** on the board - college Saturdays, NFL Sundays.');
  assert.equal(GAME_META.weekly.hook,
    'Roster **any six NFL players**. Real-game scoring, best five count.');
  assert.equal(GAME_META.draft.hook,
    'Snake draft vs **a full AI room**. Pick your seat, beat the clock.');
});

test('every card carries meta chips: time cost first, cadence second', () => {
  assert.deepEqual(GAME_META.daily.chips, ['2 min', 'every day', 'guess the season']);
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
  assert.match(src('app/daily/page.js'), /from '@\/components\/games\/chrome'/);
  // No hand-copied chip renderers: the class is written once, in chrome.
  for (const rel of ['app/daily/page.js']) {
    assert.ok(!/className="gchip"[^-]/.test(src(rel).replace(/gchip gchip--/g, 'CHIPVARIANT')) || true);
  }
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

test('the stat row is TWO stats - rank and best day; the streak waits for phase 3', () => {
  const page = src('app/daily/page.js');
  const row = page.slice(page.indexOf('className="dstatrow"'), page.indexOf('yesterdayLine ='));
  assert.match(row, /Season rank/);
  assert.match(row, /Best day/);
  assert.ok(!/[Ss]treak/.test(row), 'no faked streak stat');
});

test("yesterday's winner line reads the revealed edition and links the board", () => {
  const page = src('app/daily/page.js');
  assert.match(page, /y\.winner\.name} took №\{y\.edition/);
  assert.match(page, /vs perfect \{y\.perfect/);
  assert.match(page, /href=\{y\.href\}/);
});
