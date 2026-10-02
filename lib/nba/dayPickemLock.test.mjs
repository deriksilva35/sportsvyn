// lib/nba/dayPickemLock.test.mjs - THE NBA DAY BOARD LOCKS ON THE ROW, NOT THE
// SNAPSHOT. A source pin, the way lib/contests/rollingLock*.test.mjs pins the
// football rolling lock: the DB replay (dayPickemDb.test.mjs) proves the
// behaviour once; this keeps a later edit from quietly routing a day board back
// through the frozen board.kickoff_at.
//
// Derik's ruling (Phase B): each game locks at ITS OWN tip, and the lock reads
// the CURRENT matches.kickoff_at at decision time - save and settle - never a
// frozen copy. Tips move: the 20 Oct opener is filed at a placeholder 19:00Z.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
/** The text of one top-level function, from its declaration to the next one. */
function body(file, name) {
  const s = src(file);
  const at = s.search(new RegExp(`(export )?(async )?function ${name}\\(`));
  assert.ok(at >= 0, `${name} is declared in ${file}`);
  const rest = s.slice(at + 1);
  const next = rest.search(/\n(export )?(async )?function |\n\/\*\*/);
  return s.slice(at, next < 0 ? undefined : at + 1 + next);
}

test('SAVE: a day board leaves savePick before the snapshot lock is read', () => {
  const save = body('../pickem/entry.js', 'savePick');
  const dispatch = save.indexOf('if (isDayBoard(contest)) return saveDayPick(');
  const snapshot = save.indexOf('new Date(game.kickoff_at)');
  assert.ok(dispatch > 0, 'savePick dispatches a day board');
  assert.ok(snapshot > 0, 'football keeps its snapshot lock');
  assert.ok(dispatch < snapshot, 'the day-board branch returns BEFORE the frozen kickoff is consulted');
});

test('SAVE: saveDayPick reads kickoff_at and status from matches in the request, and locks on them', () => {
  const s = body('../pickem/entry.js', 'saveDayPick');
  assert.match(s, /SELECT id, kickoff_at, status FROM matches WHERE id = /);
  assert.match(s, /dayGameLocked\(m, now\)/, 'the lock is asked of the row just read');
  assert.doesNotMatch(s, /game\.kickoff_at/, 'the frozen board tip decides nothing here');
  assert.match(s, /isVoidStatus\(m\.status\)/, 'a void game cannot be picked');
  assert.match(s, /'picked_at'/, 'the pick is stamped for the settle-time lock');
});

test('SETTLE: settleDayBoard re-reads the tips and drops picks stamped at or after them', () => {
  const s = body('./dayPickem.js', 'settleDayBoard');
  assert.match(s, /currentGames\(board\)/, 'tips and statuses come from matches at settle');
  assert.match(s, /onTimePicks\(/, 'every entry is re-locked against the current tip');
  assert.match(s, /dayResults\(board, byId\)/, 'the gate is final OR void, from the same read');
  assert.doesNotMatch(s, /g\.kickoff_at|board\[\d\]\.kickoff_at/, 'no snapshot tip in the settle');
  const late = body('./dayPickem.js', 'onTimePicks');
  assert.match(late, />= new Date\(tip\)\.getTime\(\)/, 'at the tip is late: the boundary is the save lock`s <=');
});

test('SETTLE: the settle loop sends a day board to its own gate', () => {
  const s = body('../pickem/settle.js', 'settleDuePickem');
  assert.match(s, /if \(isDayBoard\(c\)\) \{ out\.push\(await settleDayBoard\(c\)\); continue; \}/);
  assert.match(s, /SELECT id, sport, board, season_year, meta FROM contests/, 'meta is selected, or isDayBoard sees nothing');
});

test('READ: the board view, the lobby counts and the confirm all draw the current tip for a day board', () => {
  assert.match(body('../pickem/entry.js', 'pickemBoardView'), /if \(dayBoard\) contest\.board = withCurrentTips\(contest\.board, liveById\)/);
  assert.match(body('../pickem/entry.js', 'pickemCardData'), /withCurrentTips\(contest\.board, byId\)/);
  assert.match(src('../../app/actions/confirm.js'), /isDayBoard\(c\)\) c\.board = withCurrentTips\(c\.board, await currentGames\(c\.board\)\)/);
  assert.match(src('../games/playRegistry.js'), /withCurrentTips\(c\.board, byId\)/, 'the Play lobby\'s registry read (thu-38 + fri-1)');
});

test('the lock rule itself compares the row tip with <= and refuses anything off scheduled', () => {
  const s = body('./dayPickem.js', 'dayGameLocked');
  assert.match(s, /t <= new Date\(now\)\.getTime\(\)/);
  assert.match(s, /!== 'scheduled'/);
});
