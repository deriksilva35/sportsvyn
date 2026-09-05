// lib/pickem/pickemNfl.test.mjs - the NFL board plan, against DEV's REAL
// 2026 NFL schedule (relay 2c item 5) - same convention lib/weekly/
// createLaw.test.mjs already established for this exact derivation: the
// week-derivation logic is the thing under test, so a fixture schedule
// would only test the fixture. The one INSERT this file makes is torn down
// by tracked id in `after()`, so a later manual DEV proof against the same
// (nfl, 2026, week 1) key still gets a genuinely fresh creation.

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
const { boardPlan, ensurePickemBoard } = await import('./create.js');

// Both instants land in the same NFL REG week (2026, week 1) as of this
// relay's own DEV/PROD recon: 16 games, first kick 2026-09-10T00:20Z.
const PRESEASON = new Date('2026-08-21T12:00:00Z');

let createdId = null;
after(async () => {
  if (createdId) await sql`DELETE FROM contests WHERE id = ${createdId}`;
});

test('nflBoardPlan derives (2026, week 1), all 16 games, no AP rule', async () => {
  const { plan, reason } = await boardPlan({ leagueSlug: 'nfl', now: PRESEASON });
  assert.equal(reason, null);
  assert.ok(plan);
  assert.equal(plan.sport, 'nfl');
  assert.equal(plan.seasonYear, 2026);
  assert.equal(plan.week, 1);
  assert.equal(plan.board.length, 16, 'the whole week, no AP-ranked-team filter');
  assert.equal(plan.locksAt.toISOString(), '2026-09-10T00:20:00.000Z', 'first kickoff of the week');
  // window is CFB's own concept - the NFL plan has no rolling window.
  assert.equal(plan.window, null);
});

test('settlesAt equals 12h after the LAST kickoff of the same week - the Weekly\'s own formula', async () => {
  const { plan } = await boardPlan({ leagueSlug: 'nfl', now: PRESEASON });
  const lastKo = new Date(Math.max(...plan.board.map((g) => new Date(g.kickoff_at).getTime())));
  assert.equal(plan.settlesAt.getTime(), lastKo.getTime() + 12 * 3_600_000);
});

test('opensAt is 9am ET the Tuesday on or before first kickoff - the same anchor both sports use', async () => {
  const { plan } = await boardPlan({ leagueSlug: 'nfl', now: PRESEASON });
  // 2026-09-08 is the Tuesday before the 2026-09-10 first kickoff; 9am EDT = 13:00Z.
  assert.equal(plan.opensAt.toISOString(), '2026-09-08T13:00:00.000Z');
});

test('ensurePickemBoard refuses before its own open, creates once open, idempotent after', async () => {
  const before = await ensurePickemBoard({ leagueSlug: 'nfl', now: new Date('2026-09-07T12:00:00Z') });
  assert.equal(before.created, false);
  assert.equal(before.reason, 'before-open');

  const created = await ensurePickemBoard({ leagueSlug: 'nfl', now: new Date('2026-09-08T13:00:01Z') });
  assert.equal(created.created, true);
  assert.equal(created.sport, 'nfl');
  assert.equal(created.week, 1);
  assert.equal(created.games, 16);
  createdId = created.id;

  const again = await ensurePickemBoard({ leagueSlug: 'nfl', now: new Date('2026-09-08T14:00:00Z') });
  assert.equal(again.created, false);
  assert.equal(again.reason, 'exists');
  assert.equal(again.id, createdId, 'the second pass finds the same row, creates nothing new');
});
