// lib/push/openPush.test.mjs - the OPEN push is STATE-based, not creation-
// based (relay 1b/GO). dueOpenContests() must select a contest currently
// inside its own open window - opened, not yet locked - regardless of when
// the row was created and regardless of how long ago it opened. There is
// NO FIXED HOURS CUTOFF (the 24h constant from relay 1b was dropped in the
// GO relay): the contest's own locks_at is the right edge, because that is
// the moment the contest stops being announceable at all. Hermetic:
// synthetic contests, own sport slug, torn down by tracked id.

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

async function mkContest({ week, opensAt, locksAt }) {
  const locks = locksAt ?? new Date(opensAt.getTime() + 2 * 86_400_000);
  const [row] = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at, meta)
    VALUES ('weekly', 'openpushtest', 2097, ${week}, '[]'::jsonb, ${opensAt.toISOString()},
            ${locks.toISOString()},
            ${new Date(locks.getTime() + 5 * 86_400_000).toISOString()}, '{}'::jsonb)
    RETURNING id`;
  contestIds.push(row.id);
  return row.id;
}

// PRE-EXISTING: created long before this test runs, opens_at already 2 hours
// in the past relative to NOW, locks_at still ~46h out. Creation time is
// irrelevant to the ruling; only opens_at/locks_at matter.
const preExistingId = await mkContest({ week: 1, opensAt: new Date(NOW.getTime() - 2 * 3_600_000) });
// CREATED EARLY: opens_at is 3 hours in the FUTURE relative to NOW - the row
// exists (ensureWeek ran ahead of the open gate, or a caller built it early),
// but the open has not arrived. Must never be selected.
const earlyId = await mkContest({ week: 2, opensAt: new Date(NOW.getTime() + 3 * 3_600_000) });
// PAST THE OLD 24H CUTOFF, STILL OPEN: opens_at was 25 hours ago - past the
// fixed announce window relay 1b shipped - but locks_at is still 36 hours
// OUT. The GO relay's exact case: there is no fixed hours cutoff any more,
// only the contest's own lock. Must be selected.
const pastCutoffStillOpenId = await mkContest({
  week: 3, opensAt: new Date(NOW.getTime() - 25 * 3_600_000), locksAt: new Date(NOW.getTime() + 36 * 3_600_000),
});
// ALREADY LOCKED: opens_at long past AND locks_at already past too - the
// real right edge under the new rule. Must never be selected.
const lockedId = await mkContest({
  week: 4, opensAt: new Date(NOW.getTime() - 100 * 3_600_000), locksAt: new Date(NOW.getTime() - 1 * 3_600_000),
});

after(async () => {
  await sql`DELETE FROM contests WHERE id = ANY(${contestIds})`;
});

test('a pre-existing contest, opened and not yet locked, is due - creation time is irrelevant', async () => {
  const due = await dueOpenContests('weekly', { now: NOW });
  const ids = due.map((r) => r.id);
  assert.ok(ids.includes(preExistingId), 'the pre-existing, already-open, not-yet-locked contest must be selected');
});

test('a contest created early, opens_at still in the future, is NOT due', async () => {
  const due = await dueOpenContests('weekly', { now: NOW });
  const ids = due.map((r) => r.id);
  assert.ok(!ids.includes(earlyId), 'a contest that has not opened yet must never be selected');
});

test('opened 25h ago, locks 36h out - due. There is no fixed hours cutoff any more', async () => {
  const due = await dueOpenContests('weekly', { now: NOW });
  const ids = due.map((r) => r.id);
  assert.ok(ids.includes(pastCutoffStillOpenId),
    'a contest still inside its own open window must be selected no matter how long ago it opened');
});

test('a contest already past its own lock is NOT due - locks_at is the right edge, not a fixed constant', async () => {
  const due = await dueOpenContests('weekly', { now: NOW });
  const ids = due.map((r) => r.id);
  assert.ok(!ids.includes(lockedId), 'a locked contest must never be selected, regardless of how it got that way');
});
