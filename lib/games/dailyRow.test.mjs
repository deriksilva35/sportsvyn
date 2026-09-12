// lib/games/dailyRow.test.mjs — the lobby's Daily row reads the v2 board and
// run (FRESH-USER FIXES, D9): four states from fixtures, plus the wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dailyRowFor, DAILY_CLOSES } from './dailyRow.js';

const src = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const board = { id: 5 };

test('Play: a board and no run', () => {
  assert.deepEqual(dailyRowFor({ board, run: null, uid: 7 }),
    { line1: 'eight slots, twelve teams', line2: 'not played · closes midnight ET', pill: { label: 'Play', tone: 'volt' }, tile: 'on' });
});
test('In progress: a run started and not graded', () => {
  const r = dailyRowFor({ board, run: { startedAt: '2026-09-11T20:00:00Z', completedAt: null, pct: null }, uid: 7 });
  assert.equal(r.line2, 'in progress · closes midnight ET'); assert.deepEqual(r.pill, { label: 'In progress', tone: 'volt' }); assert.equal(r.tile, 'on');
});
test('Done: a graded run, as a share of the ceiling', () => {
  const r = dailyRowFor({ board, run: { startedAt: '2026-09-11T20:00:00Z', completedAt: '2026-09-11T20:02:30Z', pct: 0.8125 }, uid: 7, edition: 5 });
  assert.equal(r.line1, 'No. 5 · eight slots, twelve teams');
  assert.equal(r.line2, 'played · 81% of best'); assert.deepEqual(r.pill, { label: 'Done', tone: 'jade' }); assert.equal(r.tile, 'done');
});
test('no board today, and the signed-out count', () => {
  assert.deepEqual(dailyRowFor({ board: null, uid: 7 }).pill, { label: 'Locked', tone: 'muted' });
  assert.equal(dailyRowFor({ board: null, uid: 7 }).line2, 'not available today');
  assert.equal(dailyRowFor({ board, uid: null, playingToday: 41 }).line2, '41 playing today');
  assert.equal(dailyRowFor({ board, uid: null, playingToday: 41 }).pill, null);
});
test('the close is ET, and no PT anywhere on the row', () => {
  assert.equal(DAILY_CLOSES, 'closes midnight ET');
  assert.doesNotMatch(src('lib/games/dailyRow.js'), /midnight PT/);
  assert.doesNotMatch(src('lib/games/read.js'), /midnight PT/);
});
test('the lobby wires the row to the v2 reader, and the v2 reader reads daily_boards / daily_board_runs', () => {
  const read = src('lib/games/read.js');
  assert.match(read, /import \{ dailyV2Home \} from '\.\.\/daily\/seasonBoardHome\.js'/);
  assert.match(read, /dailyV2Home\(uid\)\.catch\(\(\) => null\)/);
  assert.match(read, /const daily = dailyRowFor\(\{\s*board: dailyV2\?\.board \?\? null, run: dailyV2\?\.run \?\? null, uid,/);
  assert.doesNotMatch(read, /dailyHome\.state === 'receipt'\)\s*\{\s*const pct/, 'the v1 receipt branch is gone from the row');
  const home = src('lib/daily/seasonBoardHome.js');
  assert.match(home, /FROM daily_boards WHERE edition_date = \$\{date\}::date/);
  assert.match(home, /FROM daily_board_runs\s+WHERE board_id = \$\{board\.id\} AND user_id = \$\{uid\}/);
  assert.doesNotMatch(home, /puzzle_days|puzzle_entries/);
});
test('the landing-page Daily CTA and the v1 empty state both point at /daily/board', () => {
  assert.match(src('components/today/GamesBand.js'), /ctaClass="play" href="\/daily\/board" \/>/);
  const v1 = src('app/daily/page.js');
  assert.match(v1, /Not up yet\. It lands at midnight ET\.<\/p>\s*<p className="mod-lede"><Link href="\/daily\/board">/);
});
