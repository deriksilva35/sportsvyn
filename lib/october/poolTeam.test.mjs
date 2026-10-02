// lib/october/poolTeam.test.mjs - a saved slot's club comes from the contest's
// cached pool, not the client (thu-32 / fri-1). The card's server action
// dropped `team`, so every reader-saved slot landed with team null.
// DEV fixture: season 2099, slugs carrying "test", torn down and asserted.
// Run: node --test lib/october/poolTeam.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { poolPlayer } from './entry.js';

test('poolPlayer: by match and player id, string or number; null when absent', () => {
  const c = { meta: { pool: { byGame: { 42149: [{ playerId: '373', team: 'PHI', short: 'A. Nola' }] } } } };
  assert.equal(poolPlayer(c, 42149, 373)?.team, 'PHI');
  assert.equal(poolPlayer(c, '42149', '373')?.short, 'A. Nola');
  assert.equal(poolPlayer(c, 42149, 999), null);
  assert.equal(poolPlayer({}, 1, 1), null);
});

const { sql } = await import('../db.js');
const { saveOctoberPick } = await import('./entry.js');
const TAG = `octteam-test-${process.pid}`;
const made = { match: null, contest: null, user: null };
after(async () => {
  if (made.contest) { await sql`DELETE FROM contest_entries WHERE contest_id = ${made.contest}`; await sql`DELETE FROM contests WHERE id = ${made.contest}`; }
  if (made.match) await sql`DELETE FROM matches WHERE id = ${made.match}`;
  if (made.user) await sql`DELETE FROM users WHERE id = ${made.user}`;
  const [{ n }] = await sql`SELECT count(*)::int n FROM matches WHERE slug LIKE ${`${TAG}-%`}`;
  assert.equal(n, 0, 'the fixture tears itself down');
});

test('SAVE: a pick sent without a club is stored with the pool\'s club and short name', async () => {
  const [{ id: league }] = await sql`SELECT id FROM leagues WHERE slug = 'mlb' LIMIT 1`;
  const [home, away] = (await sql`SELECT id FROM teams WHERE league_id = ${league} ORDER BY id LIMIT 2`).map((t) => t.id);
  const ko = new Date(Date.now() + 6 * 3600_000).toISOString();
  [{ id: made.match }] = await sql`
    INSERT INTO matches (league_id, slug, home_team_id, away_team_id, kickoff_at, status, season_year, season_phase, stage)
    VALUES (${league}, ${`${TAG}-g`}, ${home}, ${away}, ${ko}, 'scheduled', 2099, 'POST', 'wild_card') RETURNING id`;
  const board = [{ match_id: made.match, slug: `${TAG}-g`, kickoff_at: ko }];
  const meta = { games: 1, pool: { byGame: { [made.match]: [{ playerId: '373', kind: 'arm', team: 'PHI', short: 'A. Nola', name: 'Aaron Nola' }] } } };
  const day = `2099-${String(1 + (process.pid % 12)).padStart(2, '0')}-${String(1 + ((process.pid >> 4) % 28)).padStart(2, '0')}`;
  [{ id: made.contest }] = await sql`
    INSERT INTO contests (game_type, sport, season_year, puzzle_date, board, opens_at, locks_at, settles_at, meta)
    VALUES ('october', 'mlb', 2099, ${day}, ${JSON.stringify(board)}::jsonb, now() - interval '1 hour', ${ko}, ${ko}, ${JSON.stringify(meta)}::jsonb)
    RETURNING id`;
  [{ id: made.user }] = await sql`INSERT INTO users (name, email) VALUES ('OctTeamTest', ${`${TAG}@sportsvyn.test`}) RETURNING id`;
  const r = await saveOctoberPick(made.user, made.contest, 'arm', { playerId: '373', matchId: made.match, kind: 'arm' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const [e] = await sql`SELECT lineup FROM contest_entries WHERE contest_id = ${made.contest} AND user_id = ${made.user}`;
  assert.equal(e.lineup.arm.team, 'PHI');
  assert.equal(e.lineup.arm.name, 'A. Nola', 'no name sent: the pool\'s short name');
});
