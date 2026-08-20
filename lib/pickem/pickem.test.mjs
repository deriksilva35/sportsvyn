// lib/pickem/pickem.test.mjs - the builder's laws against the database.
//
// THE FIXTURE IS HERMETIC: its own league slug, its own teams, a 2031 season
// nobody uses, torn down whole. It does not touch the real cfb league, so a
// DEV mirror carrying real slates cannot bend a verdict (the weeklyDb lesson:
// adopting a real board cost half an hour and nearly a board).
//
// CALENDAR FACTS PINNED BELOW: Mon 2031-08-25 starts a Mon-to-Mon ET window;
// Sat 2031-08-30 and Sun 2031-08-31 22:00 ET (Mon 02:00 UTC!) are inside it;
// Thu 2031-09-04 is the next window. ISO week of that Monday is 35.

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
const { windowFor, boardPlan, ensurePickemBoard } = await import('./create.js');
const { lockLabel, FIRST_LOCK_FALLBACK } = await import('./read.js');

const LG = 'pickemtest-cfb';
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

// ---- fixture ---------------------------------------------------------------
let leagueId, tA, tB;
const G = {
  early:   '2031-08-30T16:00:00Z', // Sat noon ET - the window's first kickoff
  late:    '2031-08-30T23:30:00Z', // Sat 7:30 PM ET
  sunday:  '2031-09-01T02:00:00Z', // Sun 10 PM ET - MONDAY in UTC, in-window by ET
  nextWk:  '2031-09-04T23:00:00Z', // Thu of the NEXT window - must be cut
  prevWk:  '2031-08-23T17:00:00Z', // the window before - must be cut
};

async function seed() {
  leagueId = (await sql`
    INSERT INTO leagues (slug, name, sport, external_ids, metadata)
    VALUES (${LG}, 'Pickem Test CFB', 'cfb', '{}'::jsonb, '{}'::jsonb)
    RETURNING id`)[0].id;
  const mk = async (slug, name) => (await sql`
    INSERT INTO teams (league_id, slug, name, short_name, external_ids, metadata)
    VALUES (${leagueId}, ${slug}, ${name}, ${name}, '{}'::jsonb, '{}'::jsonb)
    RETURNING id`)[0].id;
  tA = await mk('pickemtest-a', 'Alpha');
  tB = await mk('pickemtest-b', 'Beta');
  for (const [key, ko] of Object.entries(G)) {
    await sql`
      INSERT INTO matches (league_id, slug, kickoff_at, status, home_team_id, away_team_id,
                           season_year, season_phase, week, external_ids, metadata)
      VALUES (${leagueId}, ${'pickemtest-' + key}, ${ko}, 'scheduled', ${tA}, ${tB},
              2031, 'REG', 99, '{}'::jsonb, '{}'::jsonb)`;
  }
}
await seed();

after(async () => {
  await sql`DELETE FROM contests WHERE game_type = 'pickem' AND sport = ${LG}`;
  await sql`DELETE FROM matches WHERE league_id = ${leagueId}`;
  await sql`DELETE FROM teams WHERE league_id = ${leagueId}`;
  await sql`DELETE FROM leagues WHERE id = ${leagueId}`;
});

// ---- the window law --------------------------------------------------------

test('windowFor: Mon-to-Mon ET, and the UTC-Monday Sunday game stays inside', async () => {
  const w = await windowFor(G.early);
  assert.equal(w.mondayEt, '2031-08-25');
  assert.equal(w.week, 35);
  // The Sunday 10 PM ET game is Monday in UTC; the ET window must hold it.
  assert.ok(new Date(G.sunday) < w.endUtc, 'ET boundary, not naive UTC');
});

test('the plan cuts by window: three in, next-Thursday and last-week out', async () => {
  const { plan } = await boardPlan({ leagueSlug: LG, now: new Date('2031-08-27T15:00:00Z') });
  assert.ok(plan);
  assert.deepEqual(plan.board.map((g) => g.slug),
    ['pickemtest-early', 'pickemtest-late', 'pickemtest-sunday']);
  assert.equal(plan.seasonYear, 2031);
  assert.equal(plan.week, 35, 'our week key, a pure function of the Monday');
});

test('locks_at is the earliest kickoff of the window - the first-kickoff law', async () => {
  const { plan } = await boardPlan({ leagueSlug: LG, now: new Date('2031-08-27T15:00:00Z') });
  assert.equal(plan.locksAt.toISOString(), '2031-08-30T16:00:00.000Z');
  // opens the Tuesday morning ET before it, the Weekly's ratified anchor
  assert.equal(plan.opensAt.toISOString(), '2031-08-26T13:00:00.000Z');
});

// ---- creation gates --------------------------------------------------------

test('the builder refuses to create before the board opens', async () => {
  const r = await ensurePickemBoard({ leagueSlug: LG, now: new Date('2031-08-25T12:00:00Z') });
  assert.equal(r.created, false);
  assert.equal(r.reason, 'before-open');
});

test('create once, then a double fire is a no-op that says exists', async () => {
  const first = await ensurePickemBoard({ leagueSlug: LG, now: new Date('2031-08-27T15:00:00Z') });
  assert.equal(first.created, true);
  assert.equal(first.games, 3);
  const again = await ensurePickemBoard({ leagueSlug: LG, now: new Date('2031-08-27T16:00:00Z') });
  assert.equal(again.created, false);
  assert.equal(again.reason, 'exists');
  assert.equal(again.id, first.id);
  const rows = await sql`
    SELECT locks_at, board FROM contests WHERE game_type = 'pickem' AND sport = ${LG}`;
  assert.equal(rows.length, 1, 'one board, however many fires');
  assert.equal(new Date(rows[0].locks_at).toISOString(), '2031-08-30T16:00:00.000Z');
  assert.equal(rows[0].board.length, 3, 'the slate snapshot rode the row');
});

test('past the last kickoff, the plan rolls to the NEXT window on its own', async () => {
  const { plan } = await boardPlan({ leagueSlug: LG, now: new Date('2031-09-02T12:00:00Z') });
  assert.deepEqual(plan.board.map((g) => g.slug), ['pickemtest-nextWk']);
  assert.equal(plan.week, 36);
});

// ---- the cron is wired, and Monday cannot pass silently --------------------

test('the cron route exists, records every run, and alerts on failure', () => {
  const route = src('app/api/cron/pickem-board/route.js');
  assert.match(route, /recordRun\(sql, \{/, 'every fire lands a sync_runs row');
  assert.match(route, /await maybeAlert\(sql, \{/, 'a failed run alerts');
  assert.match(route, /ensurePickemBoard\(\)/, 'the route runs the one builder');
  const crons = JSON.parse(src('vercel.json')).crons;
  const mine = crons.find((c) => c.path === '/api/cron/pickem-board');
  assert.ok(mine, 'vercel.json carries the schedule');
  assert.equal(mine.schedule, '23 13 * * *');
});

// ---- the copy law: no hardcoded lock weekday survives ----------------------

test('lockLabel derives the exact ghost grammar, noon included', () => {
  assert.equal(lockLabel('2026-08-29T16:00:00Z'), FIRST_LOCK_FALLBACK,
    'the static fallback IS the derivation of the real first lock');
  assert.equal(lockLabel('2026-08-27T00:00:00Z'), 'Wed Aug 26, 8:00 PM ET');
});

test('the shipped surfaces dropped the phantom Thursday', async () => {
  const { LEAGUE_TABS } = await import('../leagues/nav.js');
  assert.equal(LEAGUE_TABS.find((t) => t.key === 'pickem').date, 'Aug 29');
  const page = src('app/leagues/[id]/page.js');
  assert.ok(!page.includes('Thu Aug 27'), 'the hardcoded lock line is gone');
  assert.match(page, /firstLockLabel\(\)/, 'the ghost panel derives from the contest');
});
