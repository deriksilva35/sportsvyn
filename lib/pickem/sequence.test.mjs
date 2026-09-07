// lib/pickem/sequence.test.mjs - relay 4. The fixture is the PROD shape that
// broke: TWO boards of one sport sharing ONE opens_at, with different first
// kickoffs, the earlier one settled and the later one open.
//
// That is not a contrived collision. tuesdayBefore() is "the 9am ET Tuesday
// ON OR BEFORE a kickoff", so any two consecutive boards whose first games
// fall in one Tue-to-Mon span legitimately get the same opens_at - which is
// every week with a Monday night game. The fixture is a normal week.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(REPO, '.env.local'));

const { sql } = await import('../db.js');
const { boardSequence, boardNumberFor, plannedBoardNumberFor, currentPickemBoard, boardCovering, firstKickoffOf } =
  await import('./sequence.js');

// A sport nothing else uses, so the fixture cannot collide with real boards
// or with another test's rows.
const SPORT = `seqtest-${String(Date.now()).slice(-8)}`;
const OPENS = '2094-09-01T13:00:00.000Z';     // ONE opens_at, shared by all three
const KO1   = '2094-08-29T16:00:00.000Z';     // board 1, first kickoff Sat
const KO2   = '2094-09-03T21:00:00.000Z';     // board 2, first kickoff Thu
const KO3   = '2094-09-07T23:30:00.000Z';     // board 3, first kickoff Mon
const ids = {};

before(async () => {
  const mk = async (week, locksAt, settled, ko) => {
    const board = JSON.stringify([{ match_id: 1, kickoff_at: ko }, { match_id: 2, kickoff_at: new Date(new Date(ko).getTime() + 3600000).toISOString() }]);
    const [r] = await sql`
      INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settled)
      VALUES ('pickem', ${SPORT}, 2094, ${week}, ${board}::jsonb, ${OPENS}, ${locksAt}, ${settled})
      RETURNING id`;
    return r.id;
  };
  ids.b1 = await mk(35, KO1, true, KO1);
  ids.b2 = await mk(36, KO2, true, KO2);
  ids.b3 = await mk(37, KO3, false, KO3);
});

after(async () => {
  // BY TRACKED ID, never a sport-wide sweep.
  for (const id of Object.values(ids)) await sql`DELETE FROM contests WHERE id = ${id}`;
});

test('the fixture really is the collision - one opens_at, three boards', async () => {
  const rows = await sql`SELECT opens_at FROM contests WHERE sport = ${SPORT}`;
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map((r) => new Date(r.opens_at).getTime())).size, 1,
    'all three share one opens_at - if they did not, this test proves nothing');
});

test('BOARD NUMBERS ARE 1, 2, 3 - not 1, 2, 2', async () => {
  const seq = await boardSequence({ sport: SPORT });
  assert.deepEqual(seq.map((r) => r.id), [ids.b1, ids.b2, ids.b3], 'ordered by first kickoff');
  assert.deepEqual(seq.map((r) => r.board_number), [1, 2, 3]);

  // And the standalone count agrees with the sequence, which is the whole
  // point of having one key: four hand-written counts is how this broke.
  for (const row of seq) {
    const n = await boardNumberFor({ sport: SPORT, locksAt: row.locks_at, id: row.id });
    assert.equal(n, row.board_number, `boardNumberFor disagrees with boardSequence for ${row.id}`);
  }
});

test('THE OPEN BOARD WINS, even though a settled board shares its opens_at', async () => {
  const now = new Date('2094-09-07T14:00:00.000Z');   // after all three opened
  const c = await currentPickemBoard({ sport: SPORT, now });
  assert.equal(c.id, ids.b3, 'the unsettled later board, not the settled earlier one');
  assert.equal(c.settled, false);
  assert.equal(c.board_number, 3);
});

test('UNSETTLED WINS EVEN WHEN THE SETTLED BOARD KICKS OFF LATER', async () => {
  // ISOLATES THE `settled ASC` TERM. In the main fixture the open board is
  // also the latest, so locks_at DESC alone would pick it and the
  // preference would be untested - mutation-checking caught exactly that.
  // Here a LATER board is settled and an earlier one is still open, which
  // is a postponed game: only the unsettled-first rule picks the playable
  // board, and picking the settled one is the live PROD defect.
  const board = JSON.stringify([{ match_id: 9, kickoff_at: '2094-09-12T18:00:00.000Z' }]);
  const [late] = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settled)
    VALUES ('pickem', ${SPORT}, 2094, 38, ${board}::jsonb, ${OPENS}, ${'2094-09-12T18:00:00.000Z'}, true)
    RETURNING id`;
  try {
    const c = await currentPickemBoard({ sport: SPORT, now: new Date('2094-09-13T00:00:00.000Z') });
    assert.equal(c.id, ids.b3,
      'the OPEN board wins over a settled board with a later first kickoff');
    assert.equal(c.settled, false);
  } finally {
    await sql`DELETE FROM contests WHERE id = ${late.id}`;
  }
});

test('a settled board is still reachable once nothing newer is open', async () => {
  // Before board 3 exists in the window, board 2's receipt is what current
  // returns - the settled board must not become unreachable.
  await sql`UPDATE contests SET opens_at = ${'2094-09-20T13:00:00.000Z'} WHERE id = ${ids.b3}`;
  const c = await currentPickemBoard({ sport: SPORT, now: new Date('2094-09-07T14:00:00.000Z') });
  assert.equal(c.id, ids.b2, 'the settled board is the current one when nothing newer has opened');
  await sql`UPDATE contests SET opens_at = ${OPENS} WHERE id = ${ids.b3}`;
});

test('the ordering is TOTAL - no untied ORDER BY anywhere in the key', async () => {
  // COMMENTS STRIPPED FIRST: this file's own header quotes the OLD untied
  // `ORDER BY opens_at DESC LIMIT 1` as the thing it replaced, and scanning
  // raw source flagged that quotation as a live query. The header has to be
  // able to name what it fixed.
  const src = readFileSync(path.join(REPO, 'lib/pickem/sequence.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const found = [...src.matchAll(/ORDER BY ([^`]+)`/g)];
  assert.ok(found.length >= 3, `expected every ordering in the key, found ${found.length}`);
  for (const m of found) {
    const terms = m[1].split(',').map((t) => t.trim());
    assert.ok(/\bid\b/.test(terms[terms.length - 1]),
      `ORDER BY "${m[1].trim()}" has no id tiebreak - Postgres may return either row`);
  }
});

test('locks_at IS the first kickoff - the premise the key rests on', async () => {
  const rows = await sql`SELECT id, locks_at, board FROM contests WHERE sport = ${SPORT}`;
  for (const r of rows) {
    assert.equal(new Date(r.locks_at).toISOString(), new Date(firstKickoffOf(r.board)).toISOString(),
      `contest ${r.id}: locks_at must equal the board's earliest kickoff`);
  }
});

test('boardCovering finds the board that already owns a first kickoff', async () => {
  const hit = await boardCovering({ sport: SPORT, locksAt: KO3 });
  assert.equal(hit?.id, ids.b3, 'the open board is found, so boardPlan cannot re-plan it');
  const miss = await boardCovering({ sport: SPORT, locksAt: '2094-12-25T18:00:00.000Z' });
  assert.equal(miss, null, 'and a kickoff nothing covers is genuinely free to plan');
});

test('a planned board numbers AFTER every board that already exists', async () => {
  const n = await plannedBoardNumberFor({ sport: SPORT, locksAt: '2094-09-14T18:00:00.000Z' });
  assert.equal(n, 4, 'the next board is 4, not a second 3');
});

// ---------------------------------------------- the surfaces, as source

test('NEITHER SURFACE CAN RENDER AN "opens" LINE WHILE A BOARD EXISTS', () => {
  // boardPlan() is the single input both "opens" lines read, and relay 4
  // item 2 makes it return {plan:null, existing} when a board already
  // covers the next kickoff. Both call sites must therefore be null-guarded
  // on `plan`, which is what stops the PROD line from coming back.
  const create = readFileSync(path.join(REPO, 'lib/pickem/create.js'), 'utf8');
  assert.match(create, /async function withExistingGuard/, 'the guard exists');
  assert.match(create, /boardCovering\(\{ sport, locksAt: result\.plan\.locksAt \}\)/);
  assert.match(create, /return \{ plan: null, existing, reason: 'exists' \}/);

  const read = readFileSync(path.join(REPO, 'lib/games/read.js'), 'utf8');
  assert.match(read, /if \(!plan\) return \{ line1: 'no board yet'/,
    '/games guards its opens line on a real plan');

  const page = readFileSync(path.join(REPO, 'app/pickem/[sport]/page.js'), 'utf8');
  assert.match(page, /const next = nextPlan \? \{ opensAt: nextPlan\.opensAt \} : null/,
    "/pickem drops its next-board line when there is no plan");
});

test('no surface still counts boards by opens_at', () => {
  // The four hand-written `count(opens_at < ...)` copies are what disagreed.
  for (const rel of ['lib/pickem/entry.js', 'lib/pickem/create.js', 'lib/games/read.js', 'app/pickem/[sport]/page.js']) {
    const src = readFileSync(path.join(REPO, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(src, /opens_at\s*<\s*\$\{/,
      `${rel} must take its board number from sequence.js, not count opens_at`);
  }
});
