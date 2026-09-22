// lib/run/preview.test.mjs - four rounds on four days, keyed so they cannot
// collide with the real ones.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { previewBoardFor } from './preview.js';
import { refuseReason, SLOTS, MAX_PER_CLUB } from './rules.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const g = (id, iso, home, away) => ({
  match_id: id, slug: `g${id}`, kickoff_at: iso,
  home_team_id: home[0], home_abbr: home[1], home_name: home[1], home_c1: '#1', home_c2: '#2',
  away_team_id: away[0], away_abbr: away[1], away_name: away[1], away_c1: '#3', away_c2: '#4',
});
const DAY = [
  g(1, '2026-09-24T16:35:00Z', [10, 'NYY'], [11, 'BAL']),
  g(2, '2026-09-24T20:10:00Z', [12, 'LAD'], [13, 'SD']),
  // A DOUBLEHEADER: the same pair again, later.
  g(3, '2026-09-24T23:05:00Z', [10, 'NYY'], [11, 'BAL']),
];

test('THE BOARD IS CLUBS, and a doubleheader gives a club ONE tile', () => {
  const { clubs, meta } = previewBoardFor('2026-09-24', DAY, 1);
  assert.ok(Array.isArray(clubs), 'contests.board is an array for every game');
  assert.deepEqual(clubs.map((c) => c.abbr), ['BAL', 'LAD', 'NYY', 'SD']);
  // The grid is clubs. A club playing twice is still one club you may take
  // three players from - its players simply score both games.
  assert.equal(clubs.find((c) => c.abbr === 'NYY').games, 2);
  assert.equal(clubs.find((c) => c.abbr === 'LAD').games, 1);
  assert.deepEqual(meta.matchIds, [1, 2, 3]);
  // THE ROUND LOCKS AT THE DAY'S EARLIEST FIRST PITCH.
  assert.equal(meta.firstPitch, '2026-09-24T16:35:00.000Z');
});

test('THE PREVIEW SAYS SO IN ITS OWN META, not only on the card', () => {
  const { meta } = previewBoardFor('2026-09-24', DAY, 1);
  assert.equal(meta.preview, true);
  assert.equal(meta.season_label, 'PREVIEW · regular season');
  assert.equal(meta.roundIndex, 1);
  assert.equal(meta.label, 'Wild Card · preview');
  assert.equal(meta.day, '2026-09-24');
  // Round 4 is the World Series slot, labelled as a preview.
  assert.equal(previewBoardFor('2026-09-27', DAY, 4).meta.label, 'World Series · preview');
});

test('NO BYES IN THE PREVIEW - every club on the board is playing', () => {
  const { clubs } = previewBoardFor('2026-09-24', DAY, 1);
  assert.ok(clubs.every((c) => c.bye === false));
  // So the bye refusal is inert and the alive check is the only one that
  // fires - the same posture every non-wild-card round takes.
  const board = { round: 'wild_card', firstPitch: '2026-09-24T16:35:00Z', clubs };
  const now = new Date('2026-09-24T12:00:00Z');
  assert.equal(refuseReason({}, 'bat1', { playerId: 1, teamId: 10, kind: 'bat' }, { board, now }), null);
  assert.equal(refuseReason({}, 'bat1', { playerId: 1, teamId: 99, kind: 'bat' }, { board, now }), 'club_not_alive');
});

test('THE RULES ARE THE RULES: nine, three per club, one lock', () => {
  const { clubs, meta } = previewBoardFor('2026-09-24', DAY, 1);
  const board = { round: 'wild_card', firstPitch: meta.firstPitch, clubs };
  const before = new Date('2026-09-24T12:00:00Z');
  assert.equal(SLOTS.length, 9);
  const three = { bat1: { playerId: '1', teamId: 10 }, bat2: { playerId: '2', teamId: 10 }, bat3: { playerId: '3', teamId: 10 } };
  assert.equal(MAX_PER_CLUB, 3);
  assert.equal(refuseReason(three, 'bat4', { playerId: 4, teamId: 10, kind: 'bat' }, { board, now: before }), 'max_per_club');
  // ONE LOCK, at the day's first pitch, for all nine.
  const after = new Date(meta.firstPitch);
  assert.equal(refuseReason({}, 'bat1', { playerId: 1, teamId: 10, kind: 'bat' }, { board, now: after }), 'round_locked');
});

test('DATE-KEYED, so the preview cannot occupy the real rounds\' keys', () => {
  // A real round is keyed (game_type, sport, season_year, week) 1-4 through
  // idx_contests_week, which is UNIQUE and partial on puzzle_date IS NULL. If
  // the preview reused weeks 1-4 the October import would find "round 1
  // exists" and never open the real one.
  const s = src('lib/run/preview.js');
  assert.match(s, /week, puzzle_date/, 'the insert names both columns');
  assert.match(s, /\$\{season\}, NULL, \$\{day\}/, 'week NULL, puzzle_date set');
  assert.match(s, /WHERE game_type = 'run' AND sport = 'mlb' AND puzzle_date = \$\{day\}/);
  // And the real opener still keys on week, untouched by any of this.
  assert.match(src('lib/run/create.js'), /AND season_year = \$\{season\} AND week = \$\{week\}/);
});

test('THE PREVIEW SETTLES ON THE DAY\'S LAST FINAL, not on a series', () => {
  const s = src('lib/run/settle.js');
  // There are no series to decide, so "every match on this board final" is
  // the same gate in the vocabulary this round actually has.
  assert.match(s, /previewRoundComplete/);
  assert.match(s, /const preview = contest\.meta\?\.preview === true;/);
  // And the real path is unchanged - it still asks the series.
  assert.match(s, /const undecided = series\.filter\(\(s\) => s\.winner == null\);/);
});

test('THE BURN DOES NOT CROSS THE PREVIEW LINE', () => {
  // Preview and postseason are the same season. Without the scope a nine
  // spent in September would be gone from the real tournament.
  for (const f of ['lib/run/pool.js', 'lib/october/pool.js']) {
    assert.match(src(f), /COALESCE\(\(c\.meta->>'preview'\)::boolean, false\) = \$\{preview\}/, f);
  }
  // And the boards are separate for the same reason.
  assert.match(src('lib/run/board.js'), /COALESCE\(\(c\.meta->>'preview'\)::boolean, false\) = \$\{preview\}/);
});
