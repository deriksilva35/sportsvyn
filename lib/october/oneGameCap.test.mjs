// lib/october/oneGameCap.test.mjs - the per-game cap counts only games that can
// still be picked from (thu-30, 1 Oct 2026).
//
// THE RECEIPT. Contest 29 held four games; three were game 3s of series that had
// ended 2-0 and went not_needed. The cap was still ceil(5/4) = 2, so a card
// stopped at two picks from the one game left: "That is the most this slate
// allows from one game." Pure rules first, then the server's own door on DEV
// (season 2099, slugs carrying "test", torn down and asserted).
// Run: node --test lib/october/oneGameCap.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { maxPerGame, refuseReason, lockedSlots, SLOTS } from './rules.js';

const BOARD = [
  { match_id: 1, kickoff_at: '2099-10-01T00:00:00Z' },
  { match_id: 2, kickoff_at: '2099-10-01T03:00:00Z' },
  { match_id: 3, kickoff_at: '2099-10-01T04:00:00Z' },
  { match_id: 4, kickoff_at: '2099-10-01T05:00:00Z' },
];
const ONE_LEFT = new Map([['1', 'scheduled'], ['2', 'not_needed'], ['3', 'not_needed'], ['4', 'cancelled']]);
const NOW = new Date('2099-09-30T20:00:00Z');

test('THE CAP COUNTS PLAYABLE GAMES: four on the board, one left, cap five', () => {
  assert.equal(maxPerGame(BOARD), 2, 'four playable: two');
  assert.equal(maxPerGame(BOARD, { statusBy: ONE_LEFT }), 5);
  assert.equal(maxPerGame(BOARD, { statusBy: new Map([['2', 'not_needed']]) }), 2, 'three playable: two');
  assert.equal(maxPerGame(BOARD, { statusBy: new Map([['2', 'not_needed'], ['3', 'postponed']]) }), 3, 'a postponed game is no source either');
});

test('THE SERVER RULE: five from the one game, no max_from_game', () => {
  const lineup = {};
  const kinds = { arm: 'arm', bat1: 'bat', bat2: 'bat', bat3: 'bat', bat4: 'bat' };
  SLOTS.forEach((slot, i) => {
    const p = { playerId: String(100 + i), matchId: 1, kind: kinds[slot] };
    assert.equal(refuseReason(lineup, slot, p, { board: BOARD, now: NOW, statusBy: ONE_LEFT }), null, slot);
    lineup[slot] = p;
  });
  // and the old reading still refuses on a genuine four-game day
  const two = { arm: { playerId: 'a', matchId: 1 }, bat1: { playerId: 'b', matchId: 1 } };
  assert.equal(refuseReason(two, 'bat2', { playerId: 'c', matchId: 1, kind: 'bat' }, { board: BOARD, now: NOW }), 'max_from_game');
});

test('A SLOT ON A NOT-NEEDED GAME NEVER SEALS, so it can be re-picked after that game\'s old time', () => {
  const lineup = { bat1: { playerId: 'x', matchId: 2 } };
  const after2 = new Date('2099-10-01T03:30:00Z');
  assert.deepEqual([...lockedSlots(lineup, BOARD, after2)], ['bat1'], 'without statuses it seals, as before');
  assert.deepEqual([...lockedSlots(lineup, BOARD, after2, { statusBy: ONE_LEFT })], []);
});

// ---- the door, on DEV ----
const { sql } = await import('../db.js');
const { saveOctoberPick } = await import('./entry.js');
const TAG = `octcap-test-${process.pid}`;
const made = { matches: [], contest: null, user: null };
let league; let home; let away;
before(async () => {
  [{ id: league }] = await sql`SELECT id FROM leagues WHERE slug = 'mlb' LIMIT 1`;
  [home, away] = (await sql`SELECT id FROM teams WHERE league_id = ${league} ORDER BY id LIMIT 2`).map((t) => t.id);
});
after(async () => {
  if (made.contest) await sql`DELETE FROM contest_entries WHERE contest_id = ${made.contest}`;
  if (made.contest) await sql`DELETE FROM contests WHERE id = ${made.contest}`;
  if (made.matches.length) await sql`DELETE FROM matches WHERE id = ANY(${made.matches}::int[])`;
  if (made.user) await sql`DELETE FROM users WHERE id = ${made.user}`;
  const [{ n }] = await sql`SELECT count(*)::int n FROM matches WHERE slug LIKE ${`${TAG}-%`}`;
  assert.equal(n, 0, 'the fixture tears itself down');
});

test('THE SERVER ACCEPTS FIVE FROM THE ONE GAME LEFT (4-game card, 3 not_needed)', async () => {
  const future = Date.now() + 6 * 3600_000;
  const board = [];
  for (let i = 0; i < 4; i += 1) {
    const ko = new Date(future + i * 3600_000).toISOString();
    const [m] = await sql`
      INSERT INTO matches (league_id, slug, home_team_id, away_team_id, kickoff_at, status, season_year, season_phase, stage)
      VALUES (${league}, ${`${TAG}-g${i}`}, ${home}, ${away}, ${ko}, ${i === 0 ? 'scheduled' : 'not_needed'}, 2099, 'POST', 'wild_card')
      RETURNING id`;
    made.matches.push(m.id);
    board.push({ match_id: m.id, slug: `${TAG}-g${i}`, kickoff_at: ko });
  }
  const day = `2099-${String(1 + (process.pid % 12)).padStart(2, '0')}-${String(1 + (process.pid % 28)).padStart(2, '0')}`;
  const [c] = await sql`
    INSERT INTO contests (game_type, sport, season_year, puzzle_date, board, opens_at, locks_at, settles_at, meta)
    VALUES ('october', 'mlb', 2099, ${day}, ${JSON.stringify(board)}::jsonb, now() - interval '1 hour',
            ${board[3].kickoff_at}, ${board[3].kickoff_at}, '{"games":4}'::jsonb)
    RETURNING id`;
  made.contest = c.id;
  [{ id: made.user }] = await sql`INSERT INTO users (name, email) VALUES ('OctCapTest', ${`${TAG}@sportsvyn.test`}) RETURNING id`;

  const kinds = { arm: 'arm', bat1: 'bat', bat2: 'bat', bat3: 'bat', bat4: 'bat' };
  for (const [i, slot] of SLOTS.entries()) {
    const r = await saveOctoberPick(made.user, c.id, slot,
      { playerId: String(9000 + i), matchId: made.matches[0], kind: kinds[slot], name: `P${i}`, team: 'TST' });
    assert.equal(r.ok, true, `${slot}: ${JSON.stringify(r)}`);
  }
  const [e] = await sql`SELECT lineup FROM contest_entries WHERE contest_id = ${c.id} AND user_id = ${made.user}`;
  assert.equal(Object.keys(e.lineup).length, 5, 'a full card from one game');
});
