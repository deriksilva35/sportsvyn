// lib/games/playRegistryDb.test.mjs - THE REGISTRY'S READERS RETURN REAL ROWS,
// against DEV (thu-38 + fri-1).
//
// TWO HALVES.
//   1. TODAY, AS IT IS: every entry's read runs against DEV at the real now, for
//      a signed-out reader and a sentinel - nothing throws, every item is in
//      the one shape, and the chip read names only real sports.
//   2. A SEEDED NIGHT IN 2097, where four of the readers that key on a real
//      sport (October, Series Pick'em, NBA Pick'em, Tonight's Six) are each
//      handed a contest and a sentinel's PARTIAL entry, and must come back with
//      that entry's own progress and the next lock the board's games set.
//
// WHY 2097 AND A REAL SPORT. The readers ask for 'mlb' and 'nba' by name, so
// the contests must carry those sports; opening them in 2097 keeps them out of
// every real-now read another builder's suite makes. Their boards name the
// sentinel league's matches, so scripts/dev-orphan-sweep.mjs lists them if a
// killed run leaves them behind. The cost: 1 league, 2 teams, 2 matches, 4
// contests, 4 entries and 1 user, all removed in after(), which asserts it.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../db.js';
import { PLAY_REGISTRY, readPlayItems, nextGameBySport } from './playRegistry.js';
import { lobbyV2 } from './lobbyV2.js';
import { phaseOf, SPORT_ORDER } from './playLobby.js';

const LG = 'playlobbytest';
const EMAIL = 'play-lobby-sentinel@sportsvyn.test';
const NOW = new Date('2097-06-10T16:00:00.000Z'); // noon ET, 10 June 2097
const DAY = '2097-06-10';
const H = 3_600_000;
const KO1 = new Date(NOW.getTime() + 2 * H).toISOString();
const KO2 = new Date(NOW.getTime() + 5 * H).toISOString();
let leagueId; let uid; const m = {}; const teams = {};

async function teardown() {
  const old = await sql`SELECT id FROM leagues WHERE slug = ${LG}`;
  const lids = old.map((l) => l.id);
  const mids = lids.length ? (await sql`SELECT id FROM matches WHERE league_id = ANY(${lids})`).map((r) => r.id) : [];
  // THE CONTESTS ARE FOUND BY THE MATCHES THEIR BOARDS NAME - the same rule
  // the orphan sweep uses - and by season 2097, never by sport alone.
  const cids = mids.length ? (await sql`
    SELECT c.id FROM contests c
     WHERE c.season_year = 2097
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.board) = 'array' THEN c.board ELSE '[]'::jsonb END) g
                    WHERE (g->>'match_id') ~ '^[0-9]+$' AND (g->>'match_id')::int = ANY(${mids}))`).map((r) => r.id) : [];
  if (cids.length) {
    await sql`DELETE FROM contest_entries WHERE contest_id = ANY(${cids})`;
    await sql`DELETE FROM contests WHERE id = ANY(${cids})`;
  }
  for (const l of lids) {
    await sql`DELETE FROM matches WHERE league_id = ${l}`;
    await sql`DELETE FROM teams WHERE league_id = ${l}`;
    await sql`DELETE FROM leagues WHERE id = ${l}`;
  }
  await sql`DELETE FROM users WHERE email = ${EMAIL}`;
}

before(async () => {
  await teardown();
  leagueId = (await sql`INSERT INTO leagues (slug, name, sport) VALUES (${LG}, 'Play Lobby Test', 'basketball') RETURNING id`)[0].id;
  for (const abbr of ['AAA', 'BBB', 'CCC', 'DDD']) {
    teams[abbr] = (await sql`INSERT INTO teams (league_id, slug, name, short_name, abbreviation, external_ids, metadata)
      VALUES (${leagueId}, ${`${LG}-${abbr.toLowerCase()}`}, ${abbr}, ${abbr}, ${abbr}, '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  }
  const mk = async (slug, away, home, ko) => (await sql`
    INSERT INTO matches (league_id, slug, kickoff_at, status, home_team_id, away_team_id, season_year, season_phase, external_ids, metadata)
    VALUES (${leagueId}, ${`${LG}-${slug}`}, ${ko}, 'scheduled', ${teams[home]}, ${teams[away]}, 2097, 'REG', '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  m.g1 = await mk('aaa-bbb', 'AAA', 'BBB', KO1);
  m.g2 = await mk('ccc-ddd', 'CCC', 'DDD', KO2);
  uid = (await sql`INSERT INTO users (email) VALUES (${EMAIL}) RETURNING id`)[0].id;

  const opens = new Date(NOW.getTime() - H).toISOString();
  const game = (id, ko, home, away) => ({ match_id: id, kickoff_at: ko, home_team_id: teams[home], away_team_id: teams[away] });
  const board = [game(m.g1, KO1, 'BBB', 'AAA'), game(m.g2, KO2, 'DDD', 'CCC')];
  const ins = async (gameType, sport, extra, entry) => {
    const [c] = await sql`
      INSERT INTO contests (game_type, sport, season_year, week, puzzle_date, board, opens_at, locks_at, settles_at, meta)
      VALUES (${gameType}, ${sport}, 2097, ${extra.week ?? null}, ${extra.day ?? null}, ${JSON.stringify(extra.board ?? board)}::jsonb,
              ${opens}, ${extra.locks ?? KO2}, ${new Date(NOW.getTime() + 12 * H).toISOString()}, ${JSON.stringify(extra.meta ?? {})}::jsonb)
      RETURNING id`;
    await sql`INSERT INTO contest_entries (contest_id, user_id, lineup) VALUES (${c.id}, ${uid}, ${JSON.stringify(entry)}::jsonb)`;
    return c.id;
  };
  // October: two of five picked.
  await ins('october', 'mlb', { day: DAY, meta: { games: 2 } }, { arm: { playerId: 1 }, bat1: { playerId: 2 } });
  // Series Pick'em: one of two series called. The board names the sentinel
  // matches beside each series key so a leftover is visible to the sweep.
  await ins('pickem', 'mlb', {
    week: 1, locks: KO1, meta: { stage: 'wild_card' },
    board: [{ series_key: 'wild_card:AAA-BBB', match_id: m.g1, stage: 'wild_card', first_pitch: KO1, teams: [] },
      { series_key: 'wild_card:CCC-DDD', match_id: m.g2, stage: 'wild_card', first_pitch: KO2, teams: [] }],
  }, { 'wild_card:AAA-BBB': teams.AAA });
  // NBA Pick'em day board: one of two picked.
  await ins('pickem', 'nba', { week: 20970610, meta: { day_board: true } }, { [m.g1]: 'home' });
  // Tonight's Six: three of six set.
  await ins('six', 'nba', { day: DAY, locks: KO2, meta: { day_et: DAY, games: 2 } },
    { g1: { playerId: 11 }, f1: { playerId: 12 }, c: { playerId: 13 } });
});

after(async () => {
  await teardown();
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM leagues WHERE slug = ${LG}`;
  assert.equal(n, 0, 'the sentinel league is gone');
  const [{ c }] = await sql`SELECT count(*)::int AS c FROM contest_entries e JOIN users u ON u.id = e.user_id WHERE u.email = ${EMAIL}`;
  assert.equal(c, 0, 'the sentinel entries are gone');
});

const SHAPE = (i) => {
  assert.ok(PLAY_REGISTRY.some((e) => e.key === i.key), `${i.key} is a registry key`);
  assert.ok([...SPORT_ORDER, 'all'].includes(i.sport), `${i.key}: sport ${i.sport}`);
  for (const f of ['name', 'mark', 'href', 'cta', 'title']) assert.equal(typeof i[f], 'string', `${i.key}.${f}`);
  assert.equal(typeof i.status, 'string', `${i.key}.status`);
  for (const f of ['opensAt', 'locksAt']) assert.ok(i[f] == null || !Number.isNaN(Date.parse(i[f])), `${i.key}.${f} is an instant`);
  assert.ok(['open', 'upcoming', 'locked', 'done'].includes(phaseOf(i, new Date())));
  if (i.progress) assert.ok(Number.isInteger(i.progress.done) && Number.isInteger(i.progress.total), `${i.key}.progress`);
};

test('TODAY ON DEV: every reader runs, signed out and signed in, and every item has the one shape', async () => {
  const now = new Date();
  for (const who of [null, uid]) {
    const v2 = await lobbyV2(who, { now });
    const items = await readPlayItems({ uid: who, now, v2 });
    assert.ok(Array.isArray(items));
    for (const i of items) SHAPE(i);
    assert.ok(items.some((i) => i.key === 'daily'), 'The Daily is always an item (its card exists in every state)');
  }
  const games = await nextGameBySport({ now });
  for (const [sport, iso] of Object.entries(games)) {
    assert.ok(SPORT_ORDER.includes(sport), sport);
    assert.ok(!Number.isNaN(Date.parse(iso)));
  }
});

test('A SEEDED NIGHT: October, Series, NBA Pick\'em and Six each return the sentinel\'s own partial entry', async () => {
  const items = await readPlayItems({ uid, now: NOW, v2: null });
  const by = Object.fromEntries(items.map((i) => [i.key, i]));
  for (const i of items) SHAPE(i);

  assert.equal(by['mlb-october']?.status, '2 of 5 picked');
  assert.deepEqual(by['mlb-october'].progress, { done: 2, total: 5 });
  assert.equal(by['mlb-october'].locksAt, KO1, 'the next unstarted first pitch');
  assert.equal(by['mlb-october'].cta, 'FINISH CARD');

  assert.equal(by['mlb-series']?.status, '1 of 2 series picked');
  assert.equal(by['mlb-series'].locksAt, KO1);

  assert.equal(by['nba-pickem']?.status, '1 of 2 picked');
  assert.equal(by['nba-pickem'].locksAt, KO1, 'the current tip of the first open game');

  assert.equal(by['nba-six']?.status, '3 of 6');
  assert.equal(by['nba-six'].locksAt, KO1);

  for (const k of ['mlb-october', 'mlb-series', 'nba-pickem', 'nba-six']) {
    assert.equal(phaseOf(by[k], NOW), 'open', `${k} is open`);
    assert.equal(by[k].complete, false, `${k} is partial`);
  }
});

test('A SEEDED NIGHT, signed out: the same games, no progress, nothing complete', async () => {
  const items = await readPlayItems({ uid: null, now: NOW, v2: null });
  const by = Object.fromEntries(items.map((i) => [i.key, i]));
  for (const k of ['mlb-october', 'mlb-series', 'nba-pickem', 'nba-six']) {
    assert.ok(by[k], `${k} is drawn signed out`);
    assert.equal(by[k].progress, null);
    assert.notEqual(by[k].complete, true);
  }
});
