// lib/games/relabelOnClaim.test.mjs - an account that entered BEFORE
// claiming a handle renders Anonymous, and claiming later relabels the rows
// it already has (relay item 4).
//
// THIS IS A PROPERTY OF THE SCHEMA, AND THE TEST SAYS SO. Every leaderboard
// in the app resolves its names through a live JOIN to users.handle and
// lib/daily/handles.js's displayName() - no entry row anywhere carries a
// denormalised name. So a claim needs no backfill: the next render of an
// old row picks up the new handle for free. The risk this pins is somebody
// later "optimising" a board by storing the name on the entry, at which
// point every pre-claim row would be frozen as Anonymous forever.

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
const { scoreLeaderboard } = await import('./leaderboard.js');

const STAMP = Date.now();
const EMAIL = `relabel-${STAMP}@example.invalid`;
const HANDLE = `relabel_${String(STAMP).slice(-8)}`;
let userId; let contestId; let entryId;

await (async () => {
  userId = (await sql`INSERT INTO users (email) VALUES (${EMAIL}) RETURNING id`)[0].id;
  contestId = (await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settled)
    VALUES ('weekly', 'relabel-test', 2094, 1, '[]'::jsonb, now(), now(), true)
    RETURNING id`)[0].id;
  // An entry made BEFORE any handle exists - the exact case item 4 names.
  entryId = (await sql`
    INSERT INTO contest_entries (contest_id, user_id, lineup, score, base_score, meta)
    VALUES (${contestId}, ${userId}, '{}'::jsonb, 120.5, 120.5, '{}'::jsonb)
    RETURNING id`)[0].id;
})();

after(async () => {
  await sql`DELETE FROM contest_entries WHERE contest_id = ${contestId}`;
  await sql`DELETE FROM contests WHERE id = ${contestId}`;
  await sql`DELETE FROM handle_history WHERE user_id = ${userId}`;
  await sql`DELETE FROM users WHERE id = ${userId}`;
});

test('no entry table denormalises a display name - the reason this works at all', async () => {
  const cols = (await sql`
    SELECT column_name FROM information_schema.columns
     WHERE table_name = 'contest_entries'`).map((r) => r.column_name);
  for (const bad of ['handle', 'display_name', 'name', 'user_name']) {
    assert.equal(cols.includes(bad), false,
      `contest_entries.${bad} would freeze pre-claim rows as Anonymous forever`);
  }
});

test('BEFORE the claim: the existing entry renders Anonymous', async () => {
  const lb = await scoreLeaderboard(contestId, userId, { limit: 10 });
  const row = lb.top.find((r) => r.userId === userId);
  assert.ok(row, 'the entry is on the board - an unclaimed account is never hidden');
  assert.equal(row.name, 'Anonymous');
  assert.equal(row.score, 120.5, 'and it carries its real score, not a placeholder');
});

test('AFTER the claim: the SAME row relabels, with no backfill', async () => {
  // The exact write app/actions/handle.js:76 performs. Not the server action
  // itself - that needs an auth() session a plain node test has no way to
  // produce - but the statement it runs, so what is proved here is the
  // schema property the action depends on.
  await sql`UPDATE users SET handle = ${HANDLE}, handle_changed_at = now() WHERE id = ${userId}`;

  const lb = await scoreLeaderboard(contestId, userId, { limit: 10 });
  const row = lb.top.find((r) => r.userId === userId);
  assert.equal(row.name, `@${HANDLE}`, 'the pre-claim row now carries the handle');
  assert.equal(row.score, 120.5, 'unchanged - relabelling is not rescoring');

  // AND IT IS THE SAME ROW, not a new one. If a claim ever started creating
  // a second entry the board would double-count the week.
  const rows = await sql`SELECT id FROM contest_entries WHERE contest_id = ${contestId}`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, entryId);
});
