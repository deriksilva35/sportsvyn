// lib/daily/seasonBoardTick.test.mjs - the tick against real DEV state.
// notifyEvent's own send-once claim IS what dedups a real call, but tick()'s
// own NOT EXISTS check is what keeps a claimed board from even reaching a
// second notify() CALL - that's the thing under test here, so the mock
// notify function below writes the SAME KIND of sync_runs claim row a real
// notifyEvent would (source='push', summary->>'eventId'), letting tick()'s
// own gate see it on the next call, exactly as it would in production.
//
// SYNTHETIC FAR-FUTURE DATES, NOT THE REAL EPOCH - a 2099 date is trivially
// >= DAILY_V2_EPOCH (2026-09-08), so isEditionLive() still treats it as
// live, without ever risking a collision with a REAL edition once real
// rehearsal/launch rows start accumulating in DEV at the actual epoch date
// (this file originally used 2026-09-08/09/10 directly - a real "run the
// tick by hand against DEV" rehearsal at that exact date, elsewhere in this
// same relay chain, is exactly the collision this now avoids). Two separate
// synthetic dates for the two halves: the mock-driven schedule tests use
// 2099-06-08/09; the real-notifyEvent proof (F2) uses 2099-06-10, so its
// own real sync_runs claim can never collide with the mock claims above
// it. DEV's device_tokens is empty (confirmed separately) - the real
// notifyEvent call here reaches zero real devices.

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

const EPOCH_DATE = '2099-06-08';
const NEXT_DATE = '2099-06-09';
const PROOF_DATE = '2099-06-10';

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

// EVERY ASSERTION BELOW CHECKS PRESENCE/ABSENCE/COUNT OF THIS TEST'S OWN
// EVENTID, NEVER EXACT ARRAY EQUALITY - a real DEV database can (and, once
// real rehearsals or a live launch have happened, WILL) hold other real
// boards with their own still-unclaimed daily-live/revealed, and a tick at
// any `now` far enough in the future correctly catches those up too (the
// same "the row decides, not the clock" property the F2 test below already
// exercises deliberately). Exact-equality on `calls` would make this file
// fail the moment any other real row existed in DEV - not a property of
// the tick worth testing, just an artifact of a shared database.
const countOf = (calls, id) => calls.filter((c) => c === id).length;

test('the amended schedule: daily-live fires once at 10am ET (live_notify_at), never at open', async () => {
  const calls = [];
  const spy = async (eventId) => { calls.push(eventId); return mockNotify(eventId); };
  const myLive = `daily-live:${EPOCH_DATE}`;

  const r1 = await tick(sql, `${EPOCH_DATE}T04:00:00Z`, { notify: spy });
  assert.ok(r1.ensured, 'the tick creates the epoch board itself');
  createdBoardIds.push(r1.ensured.id);
  assert.equal(countOf(calls, myLive), 0, 'opens_at (04:00Z) is no longer the live trigger - nothing fires for THIS board');

  const r2 = await tick(sql, `${EPOCH_DATE}T13:59:00Z`, { notify: spy });
  assert.ok(!r2.live.some((x) => x.edition === EPOCH_DATE), 'one minute before 10am ET, still nothing for THIS board');
  assert.equal(countOf(calls, myLive), 0);

  const r3 = await tick(sql, `${EPOCH_DATE}T14:00:00Z`, { notify: spy });
  assert.equal(countOf(calls, myLive), 1, 'daily-live fires exactly once, at live_notify_at');
  assert.ok(r3.live.some((x) => x.edition === EPOCH_DATE));

  await tick(sql, `${EPOCH_DATE}T14:00:00Z`, { notify: spy });
  await tick(sql, `${EPOCH_DATE}T15:00:00Z`, { notify: spy });
  await tick(sql, `${EPOCH_DATE}T20:00:00Z`, { notify: spy });
  assert.equal(countOf(calls, myLive), 1, 'three more ticks - no repeat, tick\'s own NOT EXISTS gate holds');
});

test('next-day 04:00Z: daily-revealed fires for the first board; the second board is not live-due yet', async () => {
  const calls = [];
  const spy = async (eventId) => { calls.push(eventId); return mockNotify(eventId); };

  const r = await tick(sql, `${NEXT_DATE}T04:00:00Z`, { notify: spy });
  assert.ok(r.ensured, 'the second board is created (today >= epoch)');
  createdBoardIds.push(r.ensured.id);

  assert.equal(countOf(calls, `daily-revealed:${EPOCH_DATE}`), 1,
    'closes_at for the FIRST board (the epoch one) is exactly this instant - revealed fires for it');
  assert.equal(countOf(calls, `daily-live:${NEXT_DATE}`), 0,
    'the second board\'s own live_notify_at is 14:00Z that same day, still hours away - not due yet');
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
  // (2099-06-10 14:00Z) AND the prior test's board (2099-06-09), whose
  // live_notify_at (2099-06-09 14:00Z) was never reached by that test's own
  // last tick (2099-06-09T04:00Z) - the tick catches up a missed daily-live
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
