// lib/pickem/firstLockLabel.test.mjs - firstLockLabel() derives from the
// schedule when no contest exists yet (relay 2c-fix item 1 deleted the
// static FIRST_LOCK_FALLBACK). Hermetic: its own league slug, one match, a
// 2097 season nobody uses, torn down whole.

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
const { firstLockLabel, lockLabel } = await import('./read.js');

const LG = 'firstlocktest-cfb';
const KICKOFF = '2097-08-30T16:00:00Z'; // Fri noon ET
const NOW = new Date('2097-08-27T15:00:00Z'); // inside the same Mon-Mon window

let leagueId, tA, tB, contestId;

leagueId = (await sql`
  INSERT INTO leagues (slug, name, sport, external_ids, metadata)
  VALUES (${LG}, 'First Lock Test', 'cfb', '{}'::jsonb, '{}'::jsonb)
  RETURNING id`)[0].id;
const mk = async (slug, name) => (await sql`
  INSERT INTO teams (league_id, slug, name, short_name, external_ids, metadata)
  VALUES (${leagueId}, ${slug}, ${name}, ${name}, '{}'::jsonb, '{}'::jsonb)
  RETURNING id`)[0].id;
tA = await mk('firstlocktest-a', 'Alpha');
tB = await mk('firstlocktest-b', 'Beta');
await sql`
  INSERT INTO matches (league_id, slug, kickoff_at, status, home_team_id, away_team_id,
                       season_year, season_phase, week, external_ids, metadata)
  VALUES (${leagueId}, 'firstlocktest-g1', ${KICKOFF}, 'scheduled', ${tA}, ${tB},
          2097, 'REG', 99, '{}'::jsonb, '{}'::jsonb)`;

after(async () => {
  if (contestId) await sql`DELETE FROM contests WHERE id = ${contestId}`;
  await sql`DELETE FROM matches WHERE league_id = ${leagueId}`;
  await sql`DELETE FROM teams WHERE league_id = ${leagueId}`;
  await sql`DELETE FROM leagues WHERE id = ${leagueId}`;
});

test('no contest exists yet: firstLockLabel derives the real first kickoff via boardPlan()', async () => {
  const label = await firstLockLabel({ sport: LG, now: NOW });
  assert.equal(label, lockLabel(KICKOFF));
  assert.equal(label, 'Fri Aug 30, noon ET');
});

test('a real contest exists: its own locks_at wins over the schedule derivation', async () => {
  const REAL_LOCK = '2097-08-30T18:00:00Z'; // deliberately different from the match's kickoff above
  contestId = (await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at)
    VALUES ('pickem', ${LG}, 2097, 99, '[]'::jsonb, ${NOW.toISOString()}, ${REAL_LOCK}, ${REAL_LOCK})
    RETURNING id`)[0].id;
  const label = await firstLockLabel({ sport: LG, now: NOW });
  assert.equal(label, lockLabel(REAL_LOCK));
  assert.notEqual(label, lockLabel(KICKOFF), 'must not fall through to the schedule once a real row exists');
});

test('genuinely nothing scheduled for a sport: firstLockLabel resolves null, never a stale string', async () => {
  const label = await firstLockLabel({ sport: 'firstlocktest-empty-sport', now: NOW });
  assert.equal(label, null);
});
