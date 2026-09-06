// lib/games/seasonFieldFloor.test.mjs - a week with no field does not feed
// the season tables (relay 2b-fix-2 item 5), for the Weekly AND the Draft.
//
// THE FIXTURE IS TWO WEEKS PER GAME: one with a single scored entrant, one
// with two. The season table must see only the second, and the by-seat
// season table must likewise ignore the seat the sole entrant sat in.
//
// Its own sentinel season and sport so a real board (or another test file's)
// can never bend the verdict - the weeklyDb lesson.

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
const { gamesLobby } = await import('./read.js');
const { draftSeatSeasonTable } = await import('./leaderboard.js');
const { SEASON_TABLE_MIN_FIELD } = await import('./lobby.js');

const SEASON = 2093;
const STAMP = Date.now();
const EMAILS = [0, 1].map((i) => `seasonfloor-${STAMP}-${i}@example.invalid`);
const users = [];
const contestIds = [];
const draftIds = [];
const cfgIds = [];

// Seat the SOLE-entrant draft week sits in vs the two-entrant one, so the
// by-seat assertion can tell "excluded" from "never drafted".
const SOLO_SEAT = 4;
const FIELD_SEAT = 9;

async function mkContest(gameType, week) {
  const id = (await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settled)
    VALUES (${gameType}, 'seasonfloor-test', ${SEASON}, ${week}, '[]'::jsonb, now(), now(), true)
    RETURNING id`)[0].id;
  contestIds.push(id);
  return id;
}

async function mkDraft(userId, seat) {
  const cfg = (await sql`
    INSERT INTO draft_configs (user_id, name, teams_count, scoring_format, roster_slots,
                               pick_timer_seconds, is_preset, source)
    VALUES (${userId}, 'season floor test', 12, 'ppr', '{}'::jsonb, 30, false, 'manual')
    RETURNING id`)[0].id;
  cfgIds.push(cfg);
  const snap = (await sql`SELECT max(snapshot_date) d FROM sim_player_pool WHERE source = 'ffc'`)[0].d;
  const id = (await sql`
    INSERT INTO drafts (user_id, config_id, status, pick_position, is_auto,
                        pool_snapshot_date, pool_scoring_format, pool_teams_count, started_at, mode)
    VALUES (${userId}, ${cfg}, 'completed', ${seat}, false, ${snap}, 'ppr', 12, now(), 'sim')
    RETURNING id`)[0].id;
  draftIds.push(id);
  return id;
}

const entry = (contestId, userId, pct, score, meta = {}) => sql`
  INSERT INTO contest_entries (contest_id, user_id, lineup, score, base_score, meta)
  VALUES (${contestId}, ${userId}, '{}'::jsonb, ${score}, ${score},
          ${JSON.stringify({ pct, ...meta })}::jsonb)`;

await (async () => {
  for (const e of EMAILS) {
    users.push((await sql`INSERT INTO users (email) VALUES (${e}) RETURNING id`)[0].id);
  }
  // ---- WEEKLY: week 1 has ONE entrant, week 2 has TWO -----------------------
  const wSolo = await mkContest('weekly', 1);
  await entry(wSolo, users[0], 100, 111.1);           // excluded: no field
  const wField = await mkContest('weekly', 2);
  await entry(wField, users[0], 50, 50.0);            // counted
  await entry(wField, users[1], 100, 100.0);          // counted

  // ---- DRAFT: same shape, and each entry carries a real draft/seat ----------
  const dSolo = await mkContest('draft', 3);
  await entry(dSolo, users[0], 100, 222.2, { draftId: await mkDraft(users[0], SOLO_SEAT) });
  const dField = await mkContest('draft', 4);
  await entry(dField, users[0], 40, 40.0, { draftId: await mkDraft(users[0], FIELD_SEAT) });
  await entry(dField, users[1], 100, 100.0, { draftId: await mkDraft(users[1], FIELD_SEAT) });
})();

after(async () => {
  await sql`DELETE FROM contest_entries WHERE contest_id = ANY(${contestIds})`;
  await sql`DELETE FROM contests WHERE id = ANY(${contestIds})`;
  await sql`DELETE FROM drafts WHERE id = ANY(${draftIds})`;
  await sql`DELETE FROM draft_configs WHERE id = ANY(${cfgIds})`;
  await sql`DELETE FROM users WHERE id = ANY(${users})`;
});

const seasonRowFor = async (key, uid) => {
  const g = await gamesLobby(uid, {});
  const board = g.boards.find((b) => b.key === key);
  const rows = [...(board?.table?.top ?? []), ...(board?.table?.self ? [board.table.self] : [])];
  return rows.find((r) => r.userId === uid) ?? null;
};

test('the floor is two - stated, not implied', () => {
  assert.equal(SEASON_TABLE_MIN_FIELD, 2);
});

test('WEEKLY: a one-entrant week is not in the season average', async () => {
  const row = await seasonRowFor('weekly', users[0]);
  assert.ok(row, 'the player is still on the table from the week that DID have a field');
  // Counted: only week 2's 50. Excluded: week 1's 100. A mean of both is 75.
  assert.equal(row.weeksPlayed, 1, 'one qualifying week, not two');
  assert.equal(row.avgPct, 50, 'the sole-entrant 100 never entered the average');
});

test('DRAFT: a one-entrant week is not in the season average', async () => {
  const row = await seasonRowFor('draft', users[0]);
  assert.ok(row);
  assert.equal(row.weeksPlayed, 1, 'one qualifying week, not two');
  assert.equal(row.avgPct, 40, 'the sole-entrant 100 never entered the average');
});

test("DRAFT: the by-seat season table ignores the sole entrant's seat too", async () => {
  const table = await draftSeatSeasonTable(12);
  const solo = table.find((s) => s.seat === SOLO_SEAT);
  const field = table.find((s) => s.seat === FIELD_SEAT);
  assert.equal(solo.drafters, 0, 'the excluded week contributed no drafter to its seat');
  assert.equal(field.drafters, 2, 'the two-entrant week contributed both of its drafters');
});

test('the excluded week is NOT erased - the entry still carries its score and pct', async () => {
  // The other half of the ruling: the result stands on the player's own
  // page, it simply does not feed the season. If this ever starts failing,
  // something has begun deleting real results rather than filtering them.
  const [row] = await sql`
    SELECT e.score, e.meta FROM contest_entries e
      JOIN contests c ON c.id = e.contest_id
     WHERE c.season_year = ${SEASON} AND c.game_type = 'weekly' AND c.week = 1`;
  assert.equal(Number(row.score), 111.1);
  assert.equal(Number(row.meta.pct), 100);
});
