// lib/pollers/preseasonBudget.test.mjs - every scheduled slate must fit the cap.
//
// THIS REPLACES A NUMBER IN A COMMENT. The old assertion hardcoded a replayed
// sweep count for one Saturday and then, when that Saturday did not fit, pinned
// the DEBT rather than the requirement - `assert.ok(total > DAILY_REQUEST_CAP)`,
// with a note to flip it when a fix landed. That is a test asserting the
// product is broken, which passes forever whether or not anyone fixes it.
//
// So this prices THE REAL SCHEDULE, read from matches, for every day the
// poller will actually run this week, and fails if any of them exceeds the cap.
// A ten-game Saturday appearing on the calendar now breaks the build instead of
// breaking the night.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const { sql } = await import('../db.js');
const {
  providerDatesForGames, isGameHot, DAILY_REQUEST_CAP, HOT_INTERVAL_SEC,
  DETAIL_INTERVAL_MIN, PRE_KICKOFF_MIN, POST_FINAL_MIN, MAX_GAME_HOURS,
} = await import('./preseasonWindow.js');

/**
 * Price one day's slate by REPLAYING it minute by minute.
 *
 * The score line is the honest part: at each sweep the poller asks for exactly
 * the UTC dates that carry a game in window, so the cost of a sweep is
 * providerDatesForGames().length - ONE most of the evening, TWO only while a
 * slate straddles midnight UTC. Summing the real per-sweep cost is the only way
 * to price a slate whose cost is not constant.
 */
function priceSlate(games) {
  if (!games.length) return { sweeps: 0, score: 0, detail: 0, final: 0, total: 0 };
  const times = games.map((g) => new Date(g.kickoffAt).getTime());
  const from = Math.min(...times) - PRE_KICKOFF_MIN * 60_000;
  const to = Math.max(...times) + MAX_GAME_HOURS * 3_600_000 + POST_FINAL_MIN * 60_000;

  let sweeps = 0;
  let score = 0;
  for (let t = from; t <= to; t += HOT_INTERVAL_SEC * 1000) {
    const now = new Date(t);
    if (!games.some((g) => isGameHot(g, now))) continue;
    sweeps += 1;
    score += providerDatesForGames({ games, now }).length;
  }
  // Detail: two calls (events + player stats) per game per detail round, for a
  // generous 3.5-hour game, plus one final flip each.
  const roundsPerGame = Math.floor((3.5 * 60) / DETAIL_INTERVAL_MIN);
  const detail = roundsPerGame * games.length * 2;
  const final = games.length * 2;
  return { sweeps, score, detail, final, total: score + detail + final };
}

const slates = await sql`
  SELECT to_char(m.kickoff_at AT TIME ZONE 'America/New_York','YYYY-MM-DD') AS et,
         m.kickoff_at AS "kickoffAt", m.status
    FROM matches m JOIN leagues l ON l.id = m.league_id
   WHERE l.slug = 'nfl' AND m.season_phase = 'PRE'
     AND m.kickoff_at > now() - interval '2 days'
     AND m.kickoff_at < now() + interval '9 days'
   ORDER BY m.kickoff_at`;

const byDay = new Map();
for (const g of slates) {
  if (!byDay.has(g.et)) byDay.set(g.et, []);
  byDay.get(g.et).push({ kickoffAt: g.kickoffAt, status: 'scheduled' });
}

test('EVERY SCHEDULED SLATE THIS WEEK FITS THE DAILY CAP', () => {
  assert.ok(byDay.size > 0, 'no upcoming preseason slate to price - has the schedule been ingested?');
  const over = [];
  for (const [day, games] of [...byDay].sort()) {
    const p = priceSlate(games);
    // Printed for every day, not just failures: the budget is the kind of thing
    // somebody should be able to read off a test run.
    console.log(`    ${day}  ${String(games.length).padStart(2)} games  `
      + `sweeps ${String(p.sweeps).padStart(4)}  score ${String(p.score).padStart(4)}  `
      + `detail ${p.detail}  final ${p.final}  TOTAL ${String(p.total).padStart(4)}  `
      + `cap ${DAILY_REQUEST_CAP}${p.total > DAILY_REQUEST_CAP ? '  <-- OVER' : ''}`);
    if (p.total > DAILY_REQUEST_CAP) over.push(`${day}: ${p.total} > ${DAILY_REQUEST_CAP}`);
  }
  assert.deepEqual(over, [],
    `slates priced over the cap:\n${over.join('\n')}\n`
    + 'Either the unit cost has regressed or the cap needs a deliberate raise.');
});

test('THE SATURDAY SLATE IS THE ONE THAT MATTERS, and it is priced from real rows', () => {
  // The debt this file was written for: 22 Aug, ten games, which priced at
  // 2,212 under the blind two-date sweep against a 2,000 cap. It is the widest
  // slate on the calendar, so if any day is going to break it is this one.
  const biggest = [...byDay].sort((a, b) => b[1].length - a[1].length)[0];
  assert.ok(biggest, 'expected at least one slate');
  const [day, games] = biggest;
  const p = priceSlate(games);
  console.log(`    widest slate: ${day}, ${games.length} games, ${p.total} requests`);
  assert.ok(games.length >= 8, `expected the wide Saturday in range, got ${games.length} games on ${day}`);
  assert.ok(p.total < DAILY_REQUEST_CAP,
    `${day} prices at ${p.total} against a ${DAILY_REQUEST_CAP} cap`);
});

test('and the cap is still a cap - a runaway must be able to reach it', () => {
  // At one request a sweep a minute-by-minute runaway tops out at 1,440. The
  // cap has to sit under the worst case or it never fires.
  assert.ok(DAILY_REQUEST_CAP < 1440 * 2, 'a cap a runaway cannot reach is not a cap');
  assert.ok(DAILY_REQUEST_CAP < 7500 / 2, 'and it stays a fraction of the plan');
});
