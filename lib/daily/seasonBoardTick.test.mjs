// lib/daily/seasonBoardTick.test.mjs - the tick against real DEV state.
// notifyEvent's own send-once claim IS what dedups a real call, but tick()'s
// own NOT EXISTS check is what keeps a claimed board from even reaching a
// second notify() CALL - that's the thing under test here, so the mock
// notify function below writes the SAME KIND of sync_runs claim row a real
// notifyEvent would (source='push', summary->>'eventId'), letting tick()'s
// own gate see it on the next call, exactly as it would in production.
//
// TWO SEPARATE DATES for the two halves of this file: the mock-driven
// schedule tests use 2026-09-08/09 (the real epoch, matching the task's own
// "epoch date" / "next day" language); the real-notifyEvent proof (F2) uses
// 2026-09-10, so its own real sync_runs claim can never collide with the
// mock claims above it. DEV's device_tokens is empty (confirmed separately)
// - the real notifyEvent call here reaches zero real devices.

import test, { after } from 'node:test';
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
const { tick } = await import('./seasonBoardTick.js');
const { notifyEvent } = await import('../push/notify.js');

const EPOCH_DATE = '2026-09-08';
const NEXT_DATE = '2026-09-09';
const PROOF_DATE = '2026-09-10';

const createdBoardIds = [];
const mockClaimIds = [];

async function mockNotify(eventId) {
  const r = await sql`
    INSERT INTO sync_runs (source, kind, started_at, ok, summary)
    SELECT 'push', 'event', now(), true, ${JSON.stringify({ eventId, outcome: 'sent', mock: true })}::jsonb
     WHERE NOT EXISTS (SELECT 1 FROM sync_runs WHERE source = 'push' AND summary->>'eventId' = ${eventId})
    RETURNING id`;
  if (r.length) mockClaimIds.push(r[0].id);
  return { mocked: true, claimed: r.length > 0 };
}

test('the amended schedule: daily-live fires once at 10am ET (live_notify_at), never at open', async () => {
  const calls = [];
  const spy = async (eventId) => { calls.push(eventId); return mockNotify(eventId); };

  const r1 = await tick(sql, `${EPOCH_DATE}T04:00:00Z`, { notify: spy });
  assert.ok(r1.ensured, 'the tick creates the epoch board itself');
  createdBoardIds.push(r1.ensured.id);
  assert.deepEqual(calls, [], 'opens_at (04:00Z) is no longer the live trigger - nothing fires');

  const r2 = await tick(sql, `${EPOCH_DATE}T13:59:00Z`, { notify: spy });
  assert.deepEqual(r2.live, [], 'one minute before 10am ET, still nothing');
  assert.deepEqual(calls, []);

  const r3 = await tick(sql, `${EPOCH_DATE}T14:00:00Z`, { notify: spy });
  assert.deepEqual(calls, [`daily-live:${EPOCH_DATE}`], 'daily-live fires exactly once, at live_notify_at');
  assert.equal(r3.live.length, 1);

  await tick(sql, `${EPOCH_DATE}T14:00:00Z`, { notify: spy });
  await tick(sql, `${EPOCH_DATE}T15:00:00Z`, { notify: spy });
  await tick(sql, `${EPOCH_DATE}T20:00:00Z`, { notify: spy });
  assert.deepEqual(calls, [`daily-live:${EPOCH_DATE}`], 'three more ticks - no repeat, tick\'s own NOT EXISTS gate holds');
});

test('next-day 04:00Z: daily-revealed fires for the first board; the second board is not live-due yet', async () => {
  const calls = [];
  const spy = async (eventId) => { calls.push(eventId); return mockNotify(eventId); };

  const r = await tick(sql, `${NEXT_DATE}T04:00:00Z`, { notify: spy });
  assert.ok(r.ensured, 'the second board is created (today >= epoch)');
  createdBoardIds.push(r.ensured.id);

  assert.deepEqual(calls, [`daily-revealed:${EPOCH_DATE}`],
    'closes_at for the FIRST board (2026-09-08) is exactly this instant - revealed fires for it, ' +
    'and ONLY it: the second board\'s live_notify_at is 14:00Z that same day, still hours away');
});

test('F2 proof: the real notifyEvent, called through tick(), writes a real sync_runs claim in DEV', async () => {
  const r = await tick(sql, `${PROOF_DATE}T14:00:00Z`); // default notify = the real notifyEvent
  if (r.ensured) createdBoardIds.push(r.ensured.id);

  // TRACK-THEN-ASSERT: every real claim this tick could possibly have
  // written (live AND revealed) is captured for teardown BEFORE any
  // assertion runs, so a failing assertion here can never leave a real
  // sync_runs row orphaned in DEV the way an earlier draft of this test did.
  const allEventIds = [
    `daily-live:${NEXT_DATE}`, `daily-live:${PROOF_DATE}`,
    `daily-revealed:${NEXT_DATE}`, `daily-revealed:${PROOF_DATE}`,
  ];
  const claims = await sql`
    SELECT id, source, kind, started_at, finished_at, ok, summary
      FROM sync_runs WHERE source = 'push' AND summary->>'eventId' = ANY(${allEventIds}) ORDER BY id`;
  for (const c of claims) mockClaimIds.push(c.id);
  console.log('\n--- F2: real sync_runs claim rows written by tick() -> notifyEvent (DEV) ---');
  console.log(JSON.stringify(claims, null, 2));

  assert.ok(r.ensured);
  // TWO fire in `live`, correctly: this board's own live_notify_at
  // (2026-09-10 14:00Z) AND the prior test's board (2026-09-09), whose
  // live_notify_at (2026-09-09 14:00Z) was never reached by that test's own
  // last tick (2026-09-09T04:00Z) - the tick catches up a missed daily-live
  // rather than silently dropping it, the same "the row decides, not the
  // clock" doctrine notify.js's own lookback-bounded hooks already follow.
  const liveEventIds = r.live.map((x) => `daily-live:${x.edition}`).sort();
  assert.deepEqual(liveEventIds, [`daily-live:${NEXT_DATE}`, `daily-live:${PROOF_DATE}`].sort());
  assert.equal(claims.filter((c) => c.summary.eventId.startsWith('daily-live:')).length, 2);
});

after(async () => {
  if (mockClaimIds.length) await sql`DELETE FROM sync_runs WHERE id = ANY(${mockClaimIds})`;
  if (createdBoardIds.length) {
    await sql`DELETE FROM daily_board_runs WHERE board_id = ANY(${createdBoardIds})`;
    await sql`DELETE FROM daily_boards WHERE id = ANY(${createdBoardIds})`;
  }
});
