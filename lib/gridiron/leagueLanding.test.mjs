// lib/gridiron/leagueLanding.test.mjs — the league landing's claims, tested
// without rendering anything. Run: node --test lib/gridiron/leagueLanding.test.mjs
//
// EVERY ASSERTION HERE IS ABOUT SOMETHING A READER WOULD BELIEVE: that a chip's
// rank came from the AP poll and not from row order, that an arrow means a team
// moved, that a volt button means an action is available. None of those can be
// checked by counting occurrences in served HTML, which is exactly how a broken
// header shipped last week.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  railRecord, railMovement, railChip, railChips, landingEyebrow, livePill,
  stripGamesFor, tileIsOpen, tileNumber, stripTiles, scoresSlice, leagueUnit,
} from './leagueLanding.js';
import { GAME_META, GAME_ORDER } from '../games/lobby.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (r) => readFileSync(path.join(REPO, r), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ------------------------------------------------------------------ the rail

test('THE RAIL DERIVES FROM A NAMED POLL, never from row order', () => {
  // The law that matters: CFBD's polls array changes membership by week, so an
  // index reads a different poll with an identical shape. The rail reads
  // ap_rankings, and rankings.js maps the poll NAME to that table - so there is
  // no array here to index into by accident.
  const rail = strip(src('lib/gridiron/leagueRail.js'));
  assert.match(rail, /FROM ap_rankings ap/);
  assert.doesNotMatch(rail, /polls\[\d\]|\[0\]/);
  assert.match(strip(src('lib/cfb/rankings.js')), /\[AP_POLL\]: 'ap_rankings'/);
  // and the rank rendered is the poll's own column, not an enumeration index.
  assert.match(strip(src('components/league/RankRail.js')), /\{c\.rank\}/);
  assert.doesNotMatch(strip(src('components/league/RankRail.js')), /map\(\(c, ?i\)/);
});

test('MOVEMENT IS NULL ON THE FIRST WEEK, and null when a team holds', () => {
  assert.equal(railMovement({ rank: 5, previous_rank: null }), null, 'no prior poll, no arrow');
  assert.equal(railMovement({ rank: 5, previous_rank: 5 }), null, 'held is not moved');
  assert.equal(railMovement({ rank: 3, previous_rank: 9 }), 'up');
  assert.equal(railMovement({ rank: 12, previous_rank: 4 }), 'down');
  assert.equal(railMovement({}), null);
  // The reader joins the PRIOR week and lets it be null rather than defaulting.
  assert.match(strip(src('lib/gridiron/leagueRail.js')), /LEFT JOIN ap_rankings prev/);
});

test('a chip may only claim knowledge - 0-0 and absent both render nothing', () => {
  assert.equal(railRecord({ wins: 1, losses: 0, ties: 0 }), '1-0');
  assert.equal(railRecord({ wins: 9, losses: 3, ties: 1 }), '9-3-1');
  assert.equal(railRecord({ wins: 0, losses: 0, ties: 0 }), null);
  assert.equal(railRecord({ wins: null, losses: null }), null);
  assert.equal(railRecord(null), null);
});

test('railChip falls back to the seeded label rather than rendering an empty chip', () => {
  const c = railChip({ rank: 1, team_id: null, abbreviation: null, name: 'Los Angeles Rams' });
  assert.equal(c.abbr, 'Los Angeles Rams');
  assert.equal(railChips([]).length, 0);
});

test('NO CHIPS, NO RAIL - an empty rail is furniture announcing an absence', () => {
  assert.match(strip(src('components/league/RankRail.js')), /if \(!chips\?\.length\) return null/);
});

// --------------------------------------------------------------- the header

test('THE EYEBROW OBEYS THE REG-ONLY LANDMARK LAW', () => {
  const d = '2026-08-29T16:00:00Z';
  assert.equal(landingEyebrow({ week: 1, phase: 'REG', date: d }), 'Week 1 · Sat Aug 29');
  // A preseason week 3 is not "Week 3" - it counts differently, so the week is
  // dropped and the date, which is always true, stands alone.
  assert.equal(landingEyebrow({ week: 3, phase: 'PRE', date: d }), 'Sat Aug 29');
  assert.equal(landingEyebrow({ week: null, phase: 'REG', date: d }), 'Sat Aug 29');
  // A failed derivation on both halves says nothing rather than something wrong.
  assert.equal(landingEyebrow({ week: null, phase: null, date: null }), null);
});

test('THE LIVE PILL IS HIDDEN AT ZERO', () => {
  assert.equal(livePill([]), null);
  assert.equal(livePill([{ status: 'final' }, { status: 'scheduled' }]), null);
  assert.equal(livePill([{ status: 'live' }, { status: 'final' }, { status: 'live' }]), 2);
  assert.equal(livePill(null), null);
  // and the component has no rule for an empty pill because it never draws one
  assert.match(strip(src('components/league/LeagueHeader.js')), /\{live \?/);
});

// ---------------------------------------------------------------- the strip

test('LEAGUE MEMBERSHIP IS DATA ON GAME_META, not a branch', () => {
  assert.deepEqual(stripGamesFor('cfb', GAME_META), ['pickem']);
  assert.deepEqual(stripGamesFor('nfl', GAME_META).sort(), ['daily', 'draft', 'pickem', 'weekly']);
  assert.deepEqual(stripGamesFor('epl', GAME_META), []);
  // The surface must not re-implement the answer.
  const s = strip(src('components/league/GamesStrip.js'));
  assert.doesNotMatch(s, /=== 'cfb'|=== 'nfl'/);
});

test('THE TILE COUNT IS THE LEAGUE\'S GAMES - one for CFB, four for NFL', () => {
  const cards = Object.fromEntries(GAME_ORDER.map((k) => [k, { key: k, state: 'open', playable: true }]));
  assert.equal(stripTiles({ leagueSlug: 'cfb', meta: GAME_META, order: GAME_ORDER, cards, signedIn: true }).length, 1);
  assert.equal(stripTiles({ leagueSlug: 'nfl', meta: GAME_META, order: GAME_ORDER, cards, signedIn: true }).length, 4);
  // and the order is GAME_ORDER's, not object-key order
  assert.deepEqual(
    stripTiles({ leagueSlug: 'nfl', meta: GAME_META, order: GAME_ORDER, cards, signedIn: true }).map((t) => t.key),
    GAME_ORDER,
  );
});

test('PRIMARY-BUTTON LAW: a volt button only where an action is open', () => {
  const open = { state: 'open', playable: true };
  assert.equal(tileIsOpen(open, { signedIn: true }), true);
  // SIGNED OUT IS NEVER OPEN - the tile still shows the game and its lock.
  assert.equal(tileIsOpen(open, { signedIn: false }), false);
  // cardState's own vocabulary, not a second one.
  assert.equal(tileIsOpen({ state: 'entered', playable: true }, { signedIn: true }), false);
  assert.equal(tileIsOpen({ state: 'settled', playable: false }, { signedIn: true }), false);
  assert.equal(tileIsOpen({ state: 'ghost', playable: false }, { signedIn: true }), false);
  assert.equal(tileIsOpen(null, { signedIn: true }), false);
});

test('the volt button count can never exceed the tile count', () => {
  const cards = {
    daily: { state: 'open', playable: true },
    pickem: { state: 'entered', playable: true },
    weekly: { state: 'ghost', playable: false },
    draft: { state: 'settled', playable: false },
  };
  const tiles = stripTiles({ leagueSlug: 'nfl', meta: GAME_META, order: GAME_ORDER, cards, signedIn: true });
  const volt = tiles.filter((t) => t.open).length;
  assert.equal(tiles.length, 4);
  assert.equal(volt, 1, 'only the open one');
  assert.ok(volt <= tiles.length);
  // Signed out: four tiles, zero primaries.
  const out = stripTiles({ leagueSlug: 'nfl', meta: GAME_META, order: GAME_ORDER, cards, signedIn: false });
  assert.equal(out.filter((t) => t.open).length, 0);
  // THE STRIP IS THE ONLY VOLT BUTTON ON THE SCREEN: no other league component
  // paints a volt background.
  for (const f of ['components/league/RankRail.js', 'components/league/LeagueScores.js',
                   'components/league/LeagueHeader.js']) {
    assert.doesNotMatch(strip(src(f)), /lgt-btn|background: var\(--volt\)/);
  }
});

test('the tile number comes from the card, never computed here', () => {
  assert.deepEqual(tileNumber({ you: { score: 42 } }), { value: '42', unit: 'pts' });
  assert.deepEqual(tileNumber({ you: { score: null, streak: 5 } }), { value: '5', unit: 'day streak' });
  assert.equal(tileNumber({ you: null }), null, 'a stranger has no number');
  assert.equal(tileNumber({}), null);
});

// --------------------------------------------------------------- the scores

test('SCORES ORDER IS THE READER\'S PRIORITY: live, upcoming, final', () => {
  const g = [
    { id: 'f', status: 'final', kickoffAt: '2026-08-29T16:00:00Z' },
    { id: 's', status: 'scheduled', kickoffAt: '2026-08-29T23:00:00Z' },
    { id: 'l', status: 'live', kickoffAt: '2026-08-29T20:00:00Z' },
    { id: 's2', status: 'scheduled', kickoffAt: '2026-08-29T19:00:00Z' },
  ];
  assert.deepEqual(scoresSlice(g).shown.map((x) => x.id), ['l', 's2', 's', 'f']);
});

test('the cap and the overflow count are the real numbers', () => {
  const g = Array.from({ length: 14 }, (_, i) => ({ id: i, status: 'final', kickoffAt: `2026-08-29T${10 + i}:00:00Z` }));
  const s = scoresSlice(g, 6);
  assert.equal(s.shown.length, 6);
  assert.equal(s.total, 14);
  assert.equal(s.overflow, 8);
  // No overflow, no link - the component gates on it.
  assert.equal(scoresSlice(g.slice(0, 5), 6).overflow, 0);
  assert.match(strip(src('components/league/LeagueScores.js')), /\{overflow \?/);
});

test('THE UNIT IS THE LEAGUE\'S: college counts a day, the NFL a week', () => {
  assert.equal(leagueUnit('cfb'), 'day');
  assert.equal(leagueUnit('nfl'), 'week');
  assert.equal(leagueUnit('epl'), 'week', 'an unknown code falls to the commoner unit');
  const s = strip(src('components/league/LeagueScores.js'));
  assert.match(s, /unit === 'day' \? 'Today' : 'This week'/);
});

test('THE SCORE CARD IS REUSED, NOT REBUILT', () => {
  // A second score card is a second grammar for the same fact.
  const s = strip(src('components/league/LeagueScores.js'));
  assert.match(s, /import Scoreboard from '@\/components\/gridiron\/Scoreboard'/);
  assert.doesNotMatch(s, /gi-card|TeamLine|LineScore/);
});

// ------------------------------------------------------- structural guards

test('THE LOGIC LIVES IN A PLAIN MODULE, not in JSX', () => {
  for (const f of ['components/league/LeagueHeader.js', 'components/league/RankRail.js',
                   'components/league/GamesStrip.js', 'components/league/LeagueScores.js']) {
    const code = strip(src(f));
    assert.doesNotMatch(code, /\bsql`|SELECT /i, `${f} must not query`);
    assert.doesNotMatch(code, /\.sort\(|\.filter\(\(g\) =>/, `${f} must not re-shape data`);
  }
});

test('ONE RECORDS LOADER, two callers', () => {
  const loader = strip(src('lib/gridiron/recordsLoader.js'));
  assert.match(loader, /recordChipMap/);
  assert.match(strip(src('app/scores/page.js')), /loadRecordChips\(\)/);
  assert.match(strip(src('components/gridiron/TodayPage.js')), /loadRecordChips\(\)/);
  // and neither caller resolves the season itself any more
  assert.doesNotMatch(strip(src('app/scores/page.js')), /recordChipMap\(/);
});
