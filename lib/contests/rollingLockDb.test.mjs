// lib/contests/rollingLockDb.test.mjs - the rolling lock through the real
// server path (saveLineup) and the real readers (slateBounds, teamKickoffs),
// on a synthetic league that is created and torn down here. Plus the pool
// resolution law on this database's own Week 1 board.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../db.js';
import { slateBounds, teamKickoffs, rowKickoff } from './slateBounds.js';
import { saveLineup, getEntry } from '../weekly/entries.js';

const LG = 'rlocktest'; const EMAIL = 'rolling-lock-sentinel@sportsvyn.test';
const KO = { NE: '2097-09-10T00:20:00Z', SF: '2097-09-11T00:35:00Z', DAL: '2097-09-15T00:15:00Z' };
const BEFORE = new Date('2097-09-09T20:00:00Z'); const BETWEEN = new Date('2097-09-10T12:00:00Z'); const AFTER = new Date('2097-09-15T01:00:00Z');
let leagueId; let userId; let weeklyId; let pickemId; const teams = {}; const matches = {};

before(async () => {
  await sql`DELETE FROM contests WHERE sport = ${LG}`;
  const old = await sql`SELECT id FROM leagues WHERE slug = ${LG}`;
  for (const l of old) { await sql`DELETE FROM matches WHERE league_id = ${l.id}`; await sql`DELETE FROM teams WHERE league_id = ${l.id}`; await sql`DELETE FROM leagues WHERE id = ${l.id}`; }
  leagueId = (await sql`INSERT INTO leagues (slug, name, sport) VALUES (${LG}, 'Rolling Lock Test', 'football') RETURNING id`)[0].id;
  for (const [abbr, i] of [['NE', 1], ['SEA', 2], ['SF', 3], ['LAR', 4], ['DAL', 5], ['PHI', 6]]) {
    teams[abbr] = (await sql`INSERT INTO teams (league_id, slug, name, short_name, abbreviation, external_ids, metadata)
      VALUES (${leagueId}, ${`${LG}-${abbr.toLowerCase()}`}, ${abbr}, ${abbr}, ${abbr}, '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
    void i;
  }
  const mk = async (slug, home, away, ko) => (await sql`
    INSERT INTO matches (league_id, slug, kickoff_at, status, home_team_id, away_team_id, season_year, season_phase, week, external_ids, metadata)
    VALUES (${leagueId}, ${slug}, ${ko}, 'scheduled', ${teams[home]}, ${teams[away]}, 2097, 'REG', 1, '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  matches.neSea = await mk(`${LG}-ne-sea`, 'SEA', 'NE', KO.NE);
  matches.sfLar = await mk(`${LG}-sf-lar`, 'LAR', 'SF', KO.SF);
  matches.dalPhi = await mk(`${LG}-dal-phi`, 'DAL', 'PHI', KO.DAL);
  const board = [
    { id: 1, pos: 'QB', name: 'QB NE', team: 'NE' }, { id: 2, pos: 'RB', name: 'RB SEA', team: 'SEA' },
    { id: 3, pos: 'WR', name: 'WR SF', team: 'SF' }, { id: 4, pos: 'TE', name: 'TE LAR', team: 'LAR' },
    { id: 5, pos: 'RB', name: 'RB DAL', team: 'DAL' }, { id: 6, pos: 'WR', name: 'WR PHI', team: 'PHI' },
    { id: 7, pos: 'QB', name: 'QB SF', team: 'SF' }, { id: 8, pos: 'WR', name: 'WR BYE', team: 'BYE' },
    { id: 9, pos: 'WR', name: 'WR NE2', team: 'NE' },
  ];
  weeklyId = (await sql`INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at)
    VALUES ('weekly', ${LG}, 2097, 1, ${JSON.stringify(board)}::jsonb, '2097-09-08T13:00:00Z', ${KO.DAL}) RETURNING id`)[0].id;
  const pkBoard = [{ match_id: matches.neSea, kickoff_at: KO.NE }, { match_id: matches.sfLar, kickoff_at: KO.SF }];
  pickemId = (await sql`INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at)
    VALUES ('pickem', ${LG}, 2097, 1, ${JSON.stringify(pkBoard)}::jsonb, '2097-09-08T13:00:00Z', ${KO.SF}) RETURNING id`)[0].id;
  const u = await sql`INSERT INTO users (email) VALUES (${EMAIL}) ON CONFLICT DO NOTHING RETURNING id`;
  userId = u[0]?.id ?? (await sql`SELECT id FROM users WHERE email = ${EMAIL}`)[0].id;
});
after(async () => {
  await sql`DELETE FROM contest_entries WHERE contest_id IN (${weeklyId}, ${pickemId})`;
  await sql`DELETE FROM contests WHERE sport = ${LG}`;
  await sql`DELETE FROM matches WHERE league_id = ${leagueId}`;
  await sql`DELETE FROM teams WHERE league_id = ${leagueId}`;
  await sql`DELETE FROM leagues WHERE id = ${leagueId}`;
  await sql`DELETE FROM users WHERE email = ${EMAIL}`;
});

test('slateBounds: weekly from (league, season, week); pickem from its own board', async () => {
  const w = await slateBounds(weeklyId);
  assert.deepEqual([new Date(w.firstKickoff).toISOString(), new Date(w.lastKickoff).toISOString(), w.games], ['2097-09-10T00:20:00.000Z', '2097-09-15T00:15:00.000Z', 3]);
  const p = await slateBounds(pickemId);
  assert.deepEqual([new Date(p.firstKickoff).toISOString(), new Date(p.lastKickoff).toISOString(), p.games], ['2097-09-10T00:20:00.000Z', '2097-09-11T00:35:00.000Z', 2], 'the board, not the whole week');
  const ko = await teamKickoffs({ sport: LG, season_year: 2097, week: 1 });
  assert.equal(ko.size, 6); assert.equal(new Date(ko.get('NE')).toISOString(), '2097-09-10T00:20:00.000Z');
  assert.equal(rowKickoff({ team: 'BYE' }, ko, KO.DAL), KO.DAL, 'a bye locks at the window close');
});

test('saveLineup at three instants: all accepted before; NE/SEA refused between while the rest store; the window refuses after', async () => {
  const b = await saveLineup(weeklyId, userId, { QB: 1, RB: 2, WR: 3, TE: 4 }, { now: BEFORE });
  assert.equal(b.ok, true); assert.deepEqual(b.entry.lineup, { QB: 1, RB: 2, WR: 3, TE: 4 });
  const m = await saveLineup(weeklyId, userId, { QB: 7, RB: 5, WR: 6, TE: 4, FLEX: 8 }, { now: BETWEEN });
  assert.equal(m.ok, false); assert.equal(m.reason, 'slot_locked'); assert.equal(m.slot, 'QB'); assert.equal(new Date(m.kickoffAt).toISOString(), '2097-09-10T00:20:00.000Z');
  assert.deepEqual(m.rejected.map((r) => r.slot), ['QB', 'RB']); assert.equal(m.saved, true);
  const stored = await getEntry(weeklyId, userId);
  assert.deepEqual(stored.lineup, { QB: 1, RB: 2, WR: 6, TE: 4, FLEX: 8 }, 'the refused slots kept their players; WR and FLEX saved in the same call');
  const late = await saveLineup(weeklyId, userId, { QB: 1, RB: 2, WR: 6, TE: 4, FLEX: 8, FLEX2: 9 }, { now: BETWEEN });
  assert.equal(late.ok, false); assert.equal(late.rejected[0].why, 'kicked', 'a kicked player cannot be taken into an open slot');
  const a = await saveLineup(weeklyId, userId, { QB: 1 }, { now: AFTER });
  assert.deepEqual([a.ok, a.reason], [false, 'locked'], 'after the last kickoff the window is shut');
  assert.deepEqual((await getEntry(weeklyId, userId)).lineup, { QB: 1, RB: 2, WR: 6, TE: 4, FLEX: 8 }, 'nothing written after the close');
});

test('a join after the first kickoff succeeds: a fresh entry between games stores every unkicked slot', async () => {
  const joiner = (await sql`INSERT INTO users (email) VALUES ('rolling-lock-joiner@sportsvyn.test') ON CONFLICT DO NOTHING RETURNING id`)[0]?.id
    ?? (await sql`SELECT id FROM users WHERE email = 'rolling-lock-joiner@sportsvyn.test'`)[0].id;
  try {
    const j = await saveLineup(weeklyId, joiner, { QB: 7, WR: 3, RB: 5 }, { now: BETWEEN });
    assert.equal(j.ok, true); assert.deepEqual(j.entry.lineup, { QB: 7, RB: 5, WR: 3 });
    const k = await saveLineup(weeklyId, joiner, { QB: 1, RB: 5, WR: 3 }, { now: BETWEEN });
    assert.equal(k.reason, 'slot_locked'); assert.equal(k.rejected[0].why, 'kicked', 'the kicked QB is not on offer to a late joiner');
  } finally {
    await sql`DELETE FROM contest_entries WHERE contest_id = ${weeklyId} AND user_id = ${joiner}`;
    await sql`DELETE FROM users WHERE id = ${joiner}`;
  }
});

test("this database's own Week 1 pool: every row resolves to a kickoff through its team", async () => {
  const [c] = await sql`SELECT id, sport, season_year, week, board, locks_at FROM contests WHERE game_type = 'weekly' AND sport = 'nfl' AND season_year = 2026 AND week = 1 ORDER BY id DESC LIMIT 1`;
  if (!c) return; // no 2026 board here
  const ko = await teamKickoffs(c);
  const unresolved = c.board.filter((p) => !ko.has(p.team));
  assert.deepEqual([...new Set(unresolved.map((p) => p.team))], [], `pool teams with no match this week: ${[...new Set(unresolved.map((p) => p.team))].join(' ')}`);
  assert.equal(c.board.length - unresolved.length, c.board.length);
});
