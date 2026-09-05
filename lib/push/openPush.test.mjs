// lib/push/openPush.test.mjs - the OPEN push is STATE-based, not creation-
// based (relay 1b). dueOpenContests() must select a contest already inside
// its announce window regardless of when the row was created, and must
// never select one whose opens_at has not arrived yet. Hermetic: synthetic
// contests, own sport slug, torn down by tracked id.

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
const { dueOpenContests } = await import('./notify.js');

const NOW = new Date('2097-06-08T14:00:00Z');
const contestIds = [];

async function mkContest({ week, opensAt }) {
  const [row] = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at, meta)
    VALUES ('weekly', 'openpushtest', 2097, ${week}, '[]'::jsonb, ${opensAt.toISOString()},
            ${new Date(opensAt.getTime() + 2 * 86_400_000).toISOString()},
            ${new Date(opensAt.getTime() + 7 * 86_400_000).toISOString()}, '{}'::jsonb)
    RETURNING id`;
  contestIds.push(row.id);
  return row.id;
}

// PRE-EXISTING: created long before this test runs, opens_at already 2 hours
// in the past relative to NOW - well inside the 24h window. Creation time is
// irrelevant to the ruling; only opens_at matters.
const preExistingId = await mkContest({ week: 1, opensAt: new Date(NOW.getTime() - 2 * 3_600_000) });
// CREATED EARLY: opens_at is 3 hours in the FUTURE relative to NOW - the row
// exists (ensureWeek ran ahead of the open gate, or a caller built it early),
// but the open has not arrived. Must never be selected.
const earlyId = await mkContest({ week: 2, opensAt: new Date(NOW.getTime() + 3 * 3_600_000) });
// TOO OLD: opens_at was 25 hours ago - past the 24h announce window. Must
// never be selected either (this is the same window the reminder's own
// [45,60]-minute rule protects against, on the other edge).
const staleId = await mkContest({ week: 3, opensAt: new Date(NOW.getTime() - 25 * 3_600_000) });

after(async () => {
  await sql`DELETE FROM contests WHERE id = ANY(${contestIds})`;
});

test('a pre-existing contest, opened within the last 24h, is due - creation time is irrelevant', async () => {
  const due = await dueOpenContests('weekly', { now: NOW });
  const ids = due.map((r) => r.id);
  assert.ok(ids.includes(preExistingId), 'the pre-existing, already-open contest must be selected');
});

test('a contest created early, opens_at still in the future, is NOT due', async () => {
  const due = await dueOpenContests('weekly', { now: NOW });
  const ids = due.map((r) => r.id);
  assert.ok(!ids.includes(earlyId), 'a contest that has not opened yet must never be selected');
});

test('a contest whose open passed more than 24h ago is NOT due - the announce window has closed', async () => {
  const due = await dueOpenContests('weekly', { now: NOW });
  const ids = due.map((r) => r.id);
  assert.ok(!ids.includes(staleId), 'a contest outside the 24h announce window must never be selected');
});
