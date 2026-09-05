// lib/weekly/createLaw.test.mjs - the rebuilt builder's laws (rehearsal
// F1/F2/F3/F5), against DEV's REAL 2026 schedule - the derivation is the
// thing under test, so a fixture schedule would test the fixture.
//
// WRITES: the created-path test builds the real (2026, wk2) weekly board -
// and now, since ensureWeek() creates both rows together (B3, "both rows or
// neither"), a (2026, wk2) DRAFT contest alongside it. The teardown deletes
// BOTH game_types for that (season, week) - deleting only 'weekly' here once
// orphaned a real draft row after this test ran (found live: a stray
// game_type='draft' row survived a full suite pass with no weekly sibling,
// the exact invariant this feature exists to guarantee, broken by this
// file's own teardown not yet knowing draft rows existed). Week 1's
// pre-seeded row is read, never touched.

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
const { weeklyBoardPlan, ensureWeek } = await import('./create.js');
const { DRAFT_CONFIG } = await import('../draft/contest.js');

const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const PRESEASON = new Date('2026-08-21T12:00:00Z');

after(async () => {
  await sql`DELETE FROM contests
    WHERE game_type IN ('weekly', 'draft') AND sport = 'nfl' AND season_year = 2026 AND week = 2
      AND created_at > now() - interval '1 hour'`;
});

test('the window derives from the calendar: preseason now -> REG week 1', async () => {
  const { plan } = await weeklyBoardPlan({ now: PRESEASON });
  assert.equal(plan.season, 2026);
  assert.equal(plan.week, 1);
  assert.equal(new Date(plan.ko).toISOString(), '2026-09-10T00:20:00.000Z',
    'lock = week 1 first kickoff, Wed Sep 9 8:20 PM ET');
  assert.equal(plan.opens.toISOString(), '2026-09-08T13:00:00.000Z',
    'opens the Tuesday-9AM-ET before');
});

test("F1'S EXACT SCENARIO: the preseason 'week 2' ask refuses, builds nothing", async () => {
  const r = await ensureWeek(2026, 2, { now: PRESEASON });
  assert.equal(r.created, false);
  assert.equal(r.reason, 'week_mismatch');
  assert.deepEqual(r.derived, { season: 2026, week: 1 }, 'the refusal names the derived week');
  const rows = await sql`SELECT id FROM contests
    WHERE game_type='weekly' AND sport='nfl' AND season_year=2026 AND week=2`;
  assert.equal(rows.length, 0, 'no September landmine row');
});

test('a matching assertion passes through to the ordinary path', async () => {
  // Week 1 exists on DEV already - the correct ask lands on exists, not on
  // a mismatch and not on a duplicate.
  const r = await ensureWeek(2026, 1, { now: PRESEASON });
  assert.equal(r.created, false);
  assert.equal(r.reason, 'exists');
  assert.ok(r.id != null);
});

test('the open gate refuses before Tuesday morning', async () => {
  // The window rolls to week 2 only after week 1's LAST kickoff (Monday
  // night) - Tuesday 7 AM UTC sits after MNF and before the 13:00Z open.
  const r = await ensureWeek(null, null, { now: new Date('2026-09-15T07:00:00Z') });
  assert.equal(r.created, false);
  assert.equal(r.reason, 'before-open');
  assert.equal(r.opensAt, '2026-09-15T13:00:00.000Z');
});

test('past the open it creates - derived week, derived lock - then says exists', async () => {
  const tue = new Date('2026-09-15T14:00:00Z');
  const made = await ensureWeek(null, null, { now: tue });
  assert.equal(made.created, true);
  assert.equal(made.week, 2);
  const row = (await sql`SELECT opens_at, locks_at FROM contests WHERE id = ${made.id}`)[0];
  assert.equal(new Date(row.opens_at).toISOString(), '2026-09-15T13:00:00.000Z');
  assert.equal(new Date(row.locks_at).toISOString(), '2026-09-18T00:15:00.000Z',
    'week 2 first kickoff - the derivation, not a caller number');

  // BOTH ROWS OR NEITHER (B3): the draft contest for the same (season, week)
  // is created in the same call, same board, same opens/locks/settles.
  assert.ok(made.draft?.created);
  assert.ok(made.draft?.id != null);
  const [weeklyRow, draftRow] = await Promise.all([
    sql`SELECT octet_length(board::text) AS bytes, opens_at, locks_at, settles_at FROM contests WHERE id = ${made.id}`.then((r) => r[0]),
    sql`SELECT octet_length(board::text) AS bytes, opens_at, locks_at, settles_at, meta FROM contests WHERE id = ${made.draft.id}`.then((r) => r[0]),
  ]);
  assert.equal(weeklyRow.bytes, draftRow.bytes, 'identical board - two games scoring the same rows');
  assert.equal(weeklyRow.opens_at.getTime(), draftRow.opens_at.getTime());
  assert.equal(weeklyRow.locks_at.getTime(), draftRow.locks_at.getTime());
  assert.equal(weeklyRow.settles_at.getTime(), draftRow.settles_at.getTime());
  assert.deepEqual(draftRow.meta.config, DRAFT_CONFIG);

  const again = await ensureWeek(null, null, { now: tue });
  assert.equal(again.reason, 'exists');
  assert.equal(again.id, made.id);
});

test('the cron is wired and Sep 8 cannot pass silently', () => {
  const route = src('app/api/cron/weekly-board/route.js');
  assert.match(route, /recordRun\(sql, \{/);
  assert.match(route, /await maybeAlert\(sql, \{/);
  assert.match(route, /ensureWeek\(\)/, 'no-arg: derivation only, no caller week');
  const crons = JSON.parse(src('vercel.json')).crons;
  const mine = crons.find((c) => c.path === '/api/cron/weekly-board');
  assert.equal(mine?.schedule, '24 13 * * *', 'one minute after pickem-board');
});

test('F3: lockEntries runs in the settle path, ahead of the gate', () => {
  const t = src('lib/weekly/settle.js');
  const loop = t.slice(t.indexOf('export async function settleDue'));
  const lockAt = loop.indexOf('await lockEntries(c.id, { now })');
  const settleAt = loop.indexOf('await settleContest(c.id, { now })');
  assert.ok(lockAt > -1, 'settleDue stamps the lock');
  assert.ok(lockAt < settleAt, 'the stamp lands before the gate can refuse');
});

test('F5: the weekly card lock label derives, never hardcodes', () => {
  const t = src('lib/games/read.js');
  assert.match(t, /`locks \$\{lockLabel\(c\.locks_at\)\}`/);
  assert.ok(!/closesLabel: null \} : null,\s*mine: null,\s*opensLabel: 'Opens Sep 8'/.test(t),
    'the null closesLabel is gone from the weekly card');
});
