// lib/six/lockSource.test.mjs - TONIGHT'S SIX LOCKS ON THE ROW, NOT THE SNAPSHOT.
// A source pin, the way lib/nba/dayPickemLock.test.mjs pins the day board: the
// DEV replay (replay.test.mjs) proves the behaviour once - a tip moved earlier
// on the row seals a slot the frozen board still called open - and this keeps a
// later edit from routing a door back through the board's frozen kickoff_at.
//
// The ruling (Phase B, every NBA lock): each slot locks at its game's CURRENT
// tip, read from matches.kickoff_at at the moment of the decision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
function body(file, name) {
  const s = src(file);
  const at = s.search(new RegExp(`(export )?(async )?function ${name}\\(`));
  assert.ok(at >= 0, `${name} is declared in ${file}`);
  const rest = s.slice(at + 1);
  const next = rest.search(/\n(export )?(async )?function |\n\/\*\*/);
  return s.slice(at, next < 0 ? undefined : at + 1 + next);
}

test('the row read: liveRows selects status AND kickoff_at from matches; lockMaps hands both on', () => {
  const live = body('./night.js', 'liveRows');
  assert.match(live, /SELECT id, status, kickoff_at, .* FROM matches WHERE id = ANY/s);
  const maps = body('./night.js', 'lockMaps');
  assert.match(maps, /statusBy:/); assert.match(maps, /kickoffBy:/); assert.match(maps, /m\?\.kickoff_at/);
});

test('every door reads the rows in the request and passes both maps to the rules', () => {
  const save = body('./entry.js', 'saveSixPick');
  assert.match(save, /lockMaps\(await liveRows\(board\)\)/, 'save reads the rows now');
  assert.match(save, /refuseReason\(lineup, slot, row, \{\s*board, now, statusBy, kickoffBy,/);
  assert.doesNotMatch(save, /kickoff_at/, 'no tip is read off the board here');
  const clear = body('./entry.js', 'clearSixPick');
  assert.match(clear, /lockMaps\(await liveRows\(/);
  assert.match(clear, /clearReason\(.*statusBy, kickoffBy/s);
  const view = body('./entry.js', 'sixView');
  assert.match(view, /lockMaps\(byId\)/);
  const settle = body('./settle.js', 'settleSixNight');
  assert.match(settle, /await liveRows\(board\)/);
  assert.match(settle, /nightState\(e\.lineup \?\? \{\}, board, now, \{ statusBy, kickoffBy \}\)/);
});

test('the rules prefer the row: tipOf reads kickoffBy first, the snapshot only when no row was read', () => {
  const tip = body('./rules.js', 'tipOf');
  assert.match(tip, /lookup\(kickoffBy, g\?\.match_id\)/);
  assert.match(tip, /live \?\? g\?\.kickoff_at/);
  const locked = body('./rules.js', 'gameLocked');
  assert.match(locked, /tipOf\(g, kickoffBy\)/);
  assert.match(locked, /<= new Date\(now\)\.getTime\(\)/, '`<=` at the boundary');
  assert.match(locked, /!== 'scheduled'/, 'a game that left scheduled early is locked');
  // NOT October's effectiveKickoff max(): that law freezes a tip moved earlier,
  // and an NBA tip moves.
  assert.doesNotMatch(src('./rules.js'), /effectiveKickoff|Math\.max\(a, b\)/);
});

test('the lobby row reads the rows too', () => {
  // The Play lobby's registry reads the night now (thu-38 + fri-1).
  const s = src('../games/playRegistry.js');
  const at = s.indexOf('export async function sixStateFor(');
  assert.ok(at > 0);
  const fn = s.slice(at, s.indexOf('\n}\n', at));
  assert.match(fn, /lockMaps\(byId\)/);
  assert.match(fn, /await liveRows\(c\.board\)/);
});
