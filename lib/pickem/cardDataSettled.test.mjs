// lib/pickem/cardDataSettled.test.mjs - pickemCardData()'s SETTLED shape
// (relay 2b item 6): the lobby row must not fall through to "no board yet"
// once a board settles and nothing newer has opened. Hermetic: its own
// league/teams/matches, its own sentinel sport, torn down whole.

import { test, after } from 'node:test';
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
const { pickemCardData } = await import('./entry.js');

const SPORT = 'pickemtest-settledcard';
let leagueId; let tA; let tB; let userId; let contestId;

const EMAIL = 'pickemtest-settledcard@example.invalid';

async function seed() {
  leagueId = (await sql`
    INSERT INTO leagues (slug, name, sport, external_ids, metadata)
    VALUES (${SPORT}, 'Settled Card Test', ${SPORT}, '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  const mk = async (slug, name) => (await sql`
    INSERT INTO teams (league_id, slug, name, short_name, external_ids, metadata)
    VALUES (${leagueId}, ${slug}, ${name}, ${name}, '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  tA = await mk('settledcard-a', 'Alpha');
  tB = await mk('settledcard-b', 'Beta');
  const match = (await sql`
    INSERT INTO matches (league_id, slug, kickoff_at, status, home_team_id, away_team_id,
                         season_year, season_phase, week, external_ids, metadata)
    VALUES (${leagueId}, 'settledcard-g1', '2031-09-06T16:00:00Z', 'final', ${tA}, ${tB},
            2031, 'REG', 1, '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;

  const board = [{ match_id: match, slug: 'settledcard-g1', kickoff_at: '2031-09-06T16:00:00Z', home: 'Alpha', away: 'Beta', home_team_id: tA, away_team_id: tB }];
  contestId = (await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settled, settled_at, perfect)
    VALUES ('pickem', ${SPORT}, 2031, 1, ${JSON.stringify(board)}::jsonb,
            '2031-09-02T13:00:00Z', '2031-09-06T16:00:00Z', true, now(),
            ${JSON.stringify({ results: { [String(match)]: 'home' }, max: 1 })}::jsonb)
    RETURNING id`)[0].id;

  userId = (await sql`INSERT INTO users (email) VALUES (${EMAIL})
    ON CONFLICT DO NOTHING RETURNING id`)[0]?.id
    ?? (await sql`SELECT id FROM users WHERE email = ${EMAIL}`)[0].id;

  await sql`INSERT INTO contest_entries (contest_id, user_id, lineup, score, base_score)
    VALUES (${contestId}, ${userId}, ${JSON.stringify({ [String(match)]: 'home' })}::jsonb, 1, 1)`;
}
await seed();

after(async () => {
  await sql`DELETE FROM contest_entries WHERE contest_id = ${contestId}`;
  await sql`DELETE FROM contests WHERE id = ${contestId}`;
  await sql`DELETE FROM matches WHERE league_id = ${leagueId}`;
  await sql`DELETE FROM teams WHERE league_id = ${leagueId}`;
  await sql`DELETE FROM leagues WHERE id = ${leagueId}`;
  await sql`DELETE FROM users WHERE email = ${EMAIL}`;
});

test('a settled board with nothing newer open reports a settled card, never null', async () => {
  const card = await pickemCardData(userId, { sport: SPORT, now: new Date('2031-09-10T00:00:00Z') });
  assert.ok(card, 'the row must not fall through to "no board yet"');
  assert.equal(card.settled, true);
  assert.equal(card.entered, true);
  assert.deepEqual(card.record, { correct: 1, played: 1 });
  assert.equal(typeof card.boardNumber, 'number');
});

test('a stranger sees the settled board with no personal record', async () => {
  const card = await pickemCardData(null, { sport: SPORT, now: new Date('2031-09-10T00:00:00Z') });
  assert.ok(card);
  assert.equal(card.settled, true);
  assert.equal(card.entered, false);
  assert.equal(card.record, null);
});
