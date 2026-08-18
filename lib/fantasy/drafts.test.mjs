// lib/fantasy/drafts.test.mjs — sim persistence + entitlement + interactive flow,
// against DEV. node --test. Creates fake user rows and DELETES them (cascading to
// drafts + draft_picks) in an after() hook. Run: node --test lib/fantasy/drafts.test.mjs

import { test, before, after } from 'node:test';
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
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const { neon } = await import('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const d = await import('./drafts.js');
const engine = await import('./engine.js');

const MARK = 'simtest-%@example.invalid';
async function wipe() { await sql`DELETE FROM users WHERE email LIKE ${MARK}`; }
async function mkUser(tag) {
  return (await sql`INSERT INTO users (name, email) VALUES (${'SimTest ' + tag}, ${`simtest-${tag}-${Date.now()}@example.invalid`}) RETURNING id`)[0].id;
}
let U = {}, PRESET;
before(async () => {
  await wipe();
  for (const tag of ['auto', 'int', 'b', 'ent', 'abn']) U[tag] = await mkUser(tag);
  PRESET = (await sql`SELECT id, teams_count FROM draft_configs WHERE is_preset AND scoring_format='ppr' AND teams_count=12 LIMIT 1`)[0];
});
after(wipe);

// ---- NO DRAFT WALL ----
//
// THIS TEST USED TO ASSERT THE OPPOSITE. It pinned a three-a-week limit: after
// three completed drafts canStartDraft returned ok:false, reason 'entitlement'.
// The wall is gone for the 2026 season, so the assertion is inverted rather
// than deleted - a test that merely disappeared would leave nothing saying the
// limit must NOT come back by accident.
test('NO LIMIT: a free user may start a fourth, tenth, hundredth draft', async () => {
  const u = U.ent;
  assert.equal(await d.getDraftsUsed(u), 0);
  assert.equal((await d.canStartDraft(u, false)).ok, true);
  for (let i = 0; i < 12; i++) {
    await sql`INSERT INTO drafts (user_id, status, pool_snapshot_date, pool_scoring_format, pool_teams_count, started_at)
              VALUES (${u}, 'completed', '2026-07-15', 'ppr', 12, now())`;
  }
  assert.equal(await d.getDraftsUsed(u), 12);
  const gate = await d.canStartDraft(u, false);
  assert.equal(gate.ok, true, 'twelve drafts in and still no wall');
  assert.equal(gate.reason, undefined, 'no refusal reason to report');
  assert.equal(d.FREE_DRAFT_LIMIT, 0, '0 means unlimited - see the constant');
});

test('the COUNT is still reported, because the account page shows it', async () => {
  // Unlimited is not the same as uncounted. "14 run" is worth showing; "14 of
  // 3" was the thing that had to go.
  const u = U.ent;
  const gate = await d.canStartDraft(u, false);
  assert.equal(typeof gate.used, 'number');
  assert.ok(gate.used >= 12);
});

test('abandoned drafts still do not count toward the tally', async () => {
  const u = U.ent;
  const before = await d.getDraftsUsed(u);
  await sql`INSERT INTO drafts (user_id, status, pool_snapshot_date, pool_scoring_format, pool_teams_count, started_at)
            VALUES (${u}, 'abandoned', '2026-07-15', 'ppr', 12, now())`;
  assert.equal(await d.getDraftsUsed(u), before, 'abandoned must not count');
});

test('members are still ok, and still say so', async () => {
  assert.equal((await d.canStartDraft(U.ent, true)).ok, true);
  assert.equal((await d.canStartDraft(U.ent, true)).member, true);
});

// ---- full auto-draft persistence ----
let autoDraftId;
test('full auto-draft persists 180 picks with provenance + adp_at_pick', async () => {
  const res = await d.startDraftFor(U.auto, PRESET.id, 1, { auto: true });
  assert.equal(res.ok, true); assert.equal(res.status, 'completed');
  assert.equal(res.pickCount, PRESET.teams_count * 15, 'auto draft = teams*15 picks');
  autoDraftId = res.draftId;
  const draft = (await sql`SELECT * FROM drafts WHERE id=${res.draftId}`)[0];
  assert.equal(draft.status, 'completed');
  assert.equal(draft.is_auto, true);
  assert.ok(draft.pool_snapshot_date != null && draft.pool_scoring_format === 'ppr' && draft.pool_teams_count === 12, 'provenance frozen');
  const picks = await sql`SELECT count(*)::int n, count(*) FILTER (WHERE adp_at_pick IS NULL)::int null_adp,
                                 count(*) FILTER (WHERE picked_by='ai')::int ai FROM draft_picks WHERE draft_id=${res.draftId}`;
  assert.equal(picks[0].n, 180); assert.equal(picks[0].null_adp, 0, 'every pick has adp_at_pick'); assert.equal(picks[0].ai, 180);
  const uniq = (await sql`SELECT count(DISTINCT ffc_player_id)::int u, count(*)::int n FROM draft_picks WHERE draft_id=${res.draftId}`)[0];
  assert.equal(uniq.u, uniq.n, 'no duplicate players persisted');
});

// ---- interactive flow ----
test('interactive: startDraft persists AI picks to user turn; makePick advances snake', async () => {
  const start = await d.startDraftFor(U.int, PRESET.id, 5, { auto: false });
  assert.equal(start.ok, true); assert.equal(start.status, 'in_progress');
  assert.equal(start.aiPicksMade, 4, 'seat 5 => picks 1-4 are AI');
  assert.equal(start.overallPick, 5, 'paused at the user (overall 5)');
  const draftId = start.draftId;
  const persisted = await sql`SELECT count(*)::int n, count(*) FILTER (WHERE picked_by='ai')::int ai FROM draft_picks WHERE draft_id=${draftId}`;
  assert.equal(persisted[0].n, 4); assert.equal(persisted[0].ai, 4);

  // pick the best available real player (skip synthetic) for the user
  const drafted = new Set((await sql`SELECT ffc_player_id FROM draft_picks WHERE draft_id=${draftId}`).map((r) => r.ffc_player_id));
  const pool = await d.getPoolAt('ppr', 12, (await sql`SELECT pool_snapshot_date FROM drafts WHERE id=${draftId}`)[0].pool_snapshot_date);
  const pickable = pool.filter((p) => !drafted.has(p.ffcPlayerId) && !['PK', 'DEF'].includes(p.position))[0];
  const res = await d.makePickFor(U.int, draftId, pickable.ffcPlayerId);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.userPick.overallPick, 5);
  assert.equal(res.nextOverall, 20, 'seat 5 next turn is overall 20 (snake)');
  assert.equal(res.aiPicksMade, 14, 'AI fills 6-19 then pauses at 20');
  const total = (await sql`SELECT count(*)::int n, count(*) FILTER (WHERE picked_by='user')::int usr FROM draft_picks WHERE draft_id=${draftId}`)[0];
  assert.equal(total.n, 19); assert.equal(total.usr, 1, 'exactly one user pick recorded');

  // typed errors
  const dup = await d.makePickFor(U.int, draftId, [...drafted][0]);
  assert.equal(dup.reason, 'player_unavailable', 'already-drafted player rejected');
  // The K/DST round floor no longer refuses a HUMAN pick - see the dedicated
  // test below. It is asserted there rather than here because drafting a kicker
  // now SUCCEEDS, and a successful pick would advance this flow's snake and
  // invalidate the overall-pick assertions that follow.
  const notOwner = await d.makePickFor(U.b, draftId, pool.find((p) => !drafted.has(p.ffcPlayerId)).ffcPlayerId);
  assert.equal(notOwner.reason, 'not_found_or_not_owner', "user B cannot act on user int's draft");

  // timerAutoPick works (server-authoritative fallback) at overall 20
  const t = await d.timerAutoPickFor(U.int, draftId);
  assert.equal(t.ok, true, JSON.stringify(t));
  assert.equal(t.userPick.overallPick, 20);
});

// ---- ownership on reads ----
test('ownership: user B cannot read user A/int drafts', async () => {
  assert.equal(await d.getDraft(autoDraftId, U.b), null, 'B cannot read A draft');
  const own = await d.getDraft(autoDraftId, U.auto);
  assert.ok(own && own.picks.length === 180, 'owner reads their own draft + picks');
});

// ---- abandon frees the gate ----
test('abandonDraft frees the entitlement gate; only own in_progress', async () => {
  const start = await d.startDraftFor(U.abn, PRESET.id, 3, { auto: false });
  assert.equal(start.ok, true);
  assert.equal(await d.getDraftsUsed(U.abn), 1, 'in_progress counts');
  const notOwner = await d.abandonDraftFor(U.b, start.draftId);
  assert.equal(notOwner.ok, false, 'B cannot abandon');
  const ab = await d.abandonDraftFor(U.abn, start.draftId);
  assert.equal(ab.ok, true); assert.equal(ab.status, 'abandoned');
  assert.equal(await d.getDraftsUsed(U.abn), 0, 'abandon frees the gate');
});

// ---- custom config: member gate + validation (server-authoritative) ----
const VALID_CUSTOM = {
  teamsCount: 14, scoringFormat: 'ppr', clockSeconds: 90,
  rosterSlots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, SUPERFLEX: 1, DST: 1, K: 1, BN: 5 },
};

test('custom draft is member-gated: a non-member is rejected before any write', async () => {
  // isMember() is a return-false stub today, so everyone is a non-member. A valid
  // custom config must still be refused with the custom entitlement reason, and
  // must NOT create a draft_configs row or a draft.
  const before = await sql`SELECT count(*)::int n FROM draft_configs WHERE user_id = ${U.b}`;
  const res = await d.startCustomDraftFor(U.b, VALID_CUSTOM, 'random', {});
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'entitlement_custom');
  assert.equal(await d.getDraftsUsed(U.b), 0, 'no draft consumed');
  const after = await sql`SELECT count(*)::int n FROM draft_configs WHERE user_id = ${U.b}`;
  assert.equal(after[0].n, before[0].n, 'no custom config row written on rejection');
});

test('custom draft rejects a malformed config with a field detail', async () => {
  const bad = { ...VALID_CUSTOM, teamsCount: 20 }; // out of 8..16
  const res = await d.startCustomDraftFor(U.b, bad, 'random', {});
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'invalid_config');
  assert.equal(res.detail, 'teamsCount');
});

// ---- weekly free-gate window: ET Monday 00:00 boundary (Part 2) ----
test('etWeekStartUtc: Sun 23:59 ET and Mon 00:00 ET land in different weeks', async () => {
  // Jul 2026 is EDT (UTC-4). Jul 13 + Jul 20 are Mondays; Jul 19 is a Sunday.
  const sun = await d.etWeekStartUtc('2026-07-19T23:59:00-04:00'); // Sun 23:59 EDT
  const mon = await d.etWeekStartUtc('2026-07-20T00:00:00-04:00'); // Mon 00:00 EDT
  assert.equal(new Date(sun).toISOString(), '2026-07-13T04:00:00.000Z'); // Mon Jul 13 00:00 EDT
  assert.equal(new Date(mon).toISOString(), '2026-07-20T04:00:00.000Z'); // Mon Jul 20 00:00 EDT
  assert.notEqual(new Date(sun).toISOString(), new Date(mon).toISOString());
});

// ===========================================================================
// TRACKER MODE — live in-person draft companion (migration 055)
// ===========================================================================
// A tracker draft is small on purpose: 8 teams x 3 rounds = 24 picks, so a test
// can log a whole draft to completion and exercise undo across the boundary.
const TRACKER_CFG = {
  teamsCount: 8, scoringFormat: 'ppr', clockSeconds: null,
  rosterSlots: { QB: 1, RB: 1, BN: 1 },
};
const LABELS8 = ['Dave', 'Sam', 'Kim', 'Ana', 'Joe', 'Ravi', 'Tess', 'Wes'];

// Grant the `sim` entitlement the way a Draft Pass does (kind='pass', unexpired).
async function grantPass(userId) {
  await sql`INSERT INTO memberships (user_id, status, kind, tier, expires_at, updated_at)
            VALUES (${userId}, 'active', 'pass', 'pass', now() + interval '30 days', now())
            ON CONFLICT (user_id) DO UPDATE SET
              status='active', kind='pass', tier='pass', expires_at=now() + interval '30 days'`;
}
const onClockOf = async (draftId, userId) => (await d.getDraftForRoom(draftId, userId)).onClockTeamIndex;

// Log the best AVAILABLE AND LEGAL player for whoever is on the clock. The tiny
// test roster ({QB:1,RB:1,BN:1}) makes most of the ADP board illegal for a given
// seat (no WR/TE slot once the bench is full; K/DST barred before round 13), so
// walking down to the first accepted player is what a real logger does too — and
// it asserts that `illegal_pick` is the ONLY refusal the flow ever produces here.
async function logBest(draftId, userId) {
  const room = await d.getDraftForRoom(draftId, userId);
  for (const p of room.available) {
    const res = await d.logPickFor(userId, draftId, p.ffcPlayerId);
    if (res.ok) return res;
    assert.equal(res.reason, 'illegal_pick', `unexpected refusal: ${res.reason}`);
  }
  throw new Error(`no legal player at overall ${room.currentOverall}`);
}

test('tracker: Pass-gated with no free trial', async () => {
  const u = await mkUser('trk-gate');
  // No membership row at all -> refused before any write.
  const denied = await d.startTrackerDraftFor(u, TRACKER_CFG, 1, null);
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, 'entitlement_tracker');
  const wrote = await sql`SELECT count(*)::int n FROM drafts WHERE user_id = ${u}`;
  assert.equal(wrote[0].n, 0, 'no draft row written on a refused gate');

  // A Draft Pass grants `sim`, which is the tracker gate.
  await grantPass(u);
  const ok = await d.startTrackerDraftFor(u, TRACKER_CFG, 1, null);
  assert.equal(ok.ok, true);
  assert.equal(ok.mode, 'tracker');
});

test('tracker: seat labels stored, wrong length refused', async () => {
  const u = await mkUser('trk-lab'); await grantPass(u);
  const bad = await d.startTrackerDraftFor(u, TRACKER_CFG, 1, ['Dave', 'Sam']); // 2 for 8
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'labels_length');

  const res = await d.startTrackerDraftFor(u, TRACKER_CFG, 3, LABELS8);
  assert.equal(res.ok, true);
  const room = await d.getDraftForRoom(res.draftId, u);
  assert.equal(room.mode, 'tracker');
  assert.deepEqual(room.teamLabels, LABELS8);
  // Seat 3 is the user's (pick_position 3 -> index 2), so it reads "You (Kim)".
  assert.equal(room.seatLabels[2], 'You (Kim)');
  assert.equal(room.seatLabels[0], 'Dave');
  assert.equal(room.onClockLabel, 'Dave', 'pick 1 is seat 1');
});

test('tracker: starts EMPTY (no AI finalize) and advances one pick per log', async () => {
  const u = await mkUser('trk-log'); await grantPass(u);
  const { draftId } = await d.startTrackerDraftFor(u, TRACKER_CFG, 1, LABELS8);

  let room = await d.getDraftForRoom(draftId, u);
  assert.equal(room.picks.length, 0, 'a tracker draft has NO pre-logged picks');
  assert.equal(room.currentOverall, 1);

  const r1 = await logBest(draftId, u);
  assert.equal(r1.nextOverall, 2, 'exactly one pick advanced — no AI ran');

  room = await d.getDraftForRoom(draftId, u);
  assert.equal(room.picks.length, 1);
  assert.equal(room.currentOverall, 2);
});

test('tracker: attribution is user for my seat, logged for everyone else, never ai', async () => {
  const u = await mkUser('trk-attr'); await grantPass(u);
  // Seat 4 -> team index 3, which picks 4th in round 1.
  const { draftId } = await d.startTrackerDraftFor(u, TRACKER_CFG, 4, LABELS8);

  for (let i = 0; i < 6; i++) {
    const idx = await onClockOf(draftId, u);
    const res = await logBest(draftId, u);
    assert.equal(res.isOwnSeat, idx === 3, `overall ${i + 1}: own-seat flag`);
  }

  const rows = await sql`SELECT overall_pick, picked_by FROM draft_picks WHERE draft_id = ${draftId} ORDER BY overall_pick`;
  assert.equal(rows.length, 6);
  // Pick 4 is the user's seat; the rest are other managers.
  assert.equal(rows.find((r) => r.overall_pick === 4).picked_by, 'user');
  for (const r of rows.filter((x) => x.overall_pick !== 4)) {
    assert.equal(r.picked_by, 'logged', `overall ${r.overall_pick} must be logged`);
  }
  assert.equal(rows.filter((r) => r.picked_by === 'ai').length, 0, 'no engine picked anything');
});

test('tracker: undo is repeatable, un-completes, and clears the stale Read', async () => {
  const u = await mkUser('trk-undo'); await grantPass(u);
  const { draftId } = await d.startTrackerDraftFor(u, TRACKER_CFG, 1, LABELS8);
  const total = 8 * 3;
  for (let i = 0; i < total; i++) await logBest(draftId, u);

  let draft = (await sql`SELECT status, completed_at FROM drafts WHERE id = ${draftId}`)[0];
  assert.equal(draft.status, 'completed', 'logging the last pick completes the draft');

  // A Read exists (write one directly — getOrCreateRead would call the AI).
  await sql`INSERT INTO draft_reads (draft_id, grade, grade_score, prose, prose_source)
            VALUES (${draftId}, 'B', 70, 'stale prose', 'fallback')`;

  const u1 = await d.undoLastPickFor(u, draftId);
  assert.equal(u1.ok, true);
  assert.equal(u1.undone.overallPick, total);
  draft = (await sql`SELECT status, completed_at FROM drafts WHERE id = ${draftId}`)[0];
  assert.equal(draft.status, 'in_progress', 'undo un-completes');
  assert.equal(draft.completed_at, null, 'completed_at cleared');
  const reads = await sql`SELECT count(*)::int n FROM draft_reads WHERE draft_id = ${draftId}`;
  assert.equal(reads[0].n, 0, 'the stale Read must die with the pick that produced it');

  // Repeatable: four more undos walk back four more picks.
  for (let i = 1; i <= 4; i++) {
    const r = await d.undoLastPickFor(u, draftId);
    assert.equal(r.ok, true);
    assert.equal(r.undone.overallPick, total - i);
  }
  const left = await sql`SELECT count(*)::int n FROM draft_picks WHERE draft_id = ${draftId}`;
  assert.equal(left[0].n, total - 5);
  // And the room agrees about whose turn it now is.
  const room = await d.getDraftForRoom(draftId, u);
  assert.equal(room.currentOverall, total - 4);
  assert.equal(room.canUndo, true);
});

test('tracker: undo down to empty, then refuses', async () => {
  const u = await mkUser('trk-undo2'); await grantPass(u);
  const { draftId } = await d.startTrackerDraftFor(u, TRACKER_CFG, 1, null);
  await logBest(draftId, u);
  assert.equal((await d.undoLastPickFor(u, draftId)).ok, true);
  const empty = await d.undoLastPickFor(u, draftId);
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, 'no_picks');
  assert.equal((await d.getDraftForRoom(draftId, u)).canUndo, false);
});

test('tracker and sim flows refuse each other', async () => {
  const u = await mkUser('trk-x'); await grantPass(u);
  // A sim draft cannot be logged or undone.
  const sim = await d.startDraftFor(u, PRESET.id, 1, {});
  assert.equal(sim.ok, true);
  const logged = await d.logPickFor(u, sim.draftId, 'anything');
  assert.equal(logged.ok, false); assert.equal(logged.reason, 'not_tracker');
  const undone = await d.undoLastPickFor(u, sim.draftId);
  assert.equal(undone.ok, false); assert.equal(undone.reason, 'not_tracker');

  // Ownership still holds on every tracker path.
  const trk = await d.startTrackerDraftFor(u, TRACKER_CFG, 1, null);
  const other = await mkUser('trk-x2');
  assert.equal((await d.logPickFor(other, trk.draftId, 'x')).reason, 'not_found_or_not_owner');
  assert.equal((await d.undoLastPickFor(other, trk.draftId)).reason, 'not_found_or_not_owner');
  assert.equal(await d.getDraftForRoom(trk.draftId, other), null);
});

test('tracker drafts never consume a free-draft credit', async () => {
  const u = await mkUser('trk-gate2'); await grantPass(u);
  const before = await d.getDraftsUsed(u);
  const t = await d.startTrackerDraftFor(u, TRACKER_CFG, 1, null);
  assert.equal(t.ok, true);
  assert.equal(await d.getDraftsUsed(u), before, 'a tracker draft is not a mock-draft credit');
  // ...while a sim draft still does.
  await d.startDraftFor(u, PRESET.id, 1, {});
  assert.equal(await d.getDraftsUsed(u), before + 1, 'sim drafts still count');
});

test('tracker picks never reach the public most-drafted board', async () => {
  const { getGlobalMostDrafted } = await import('../sim/fantasyBoard.js');
  const u = await mkUser('trk-board'); await grantPass(u);
  const beforeBoard = await getGlobalMostDrafted(10);

  // Complete a whole tracker draft — including the user's OWN picks, which are
  // stored picked_by='user' and would otherwise match the board's filter.
  const { draftId } = await d.startTrackerDraftFor(u, TRACKER_CFG, 1, null);
  for (let i = 0; i < 24; i++) await logBest(draftId, u);
  assert.equal((await sql`SELECT status FROM drafts WHERE id=${draftId}`)[0].status, 'completed');
  const own = await sql`SELECT count(*)::int n FROM draft_picks WHERE draft_id=${draftId} AND picked_by='user'`;
  assert.ok(own[0].n > 0, 'the draft really does contain user-attributed picks');

  const afterBoard = await getGlobalMostDrafted(10);
  assert.equal(afterBoard.draftCount, beforeBoard.draftCount,
    'a completed tracker draft must not move the board denominator');
});

test('getDraftForRoom supplies exactly the props TrackerRoom consumes', async () => {
  // TrackerRoom is a client component and cannot be imported under node --test
  // (the @/ alias is a Next build concern — same reason roster.js exists as a pure
  // module). So the server/client BOUNDARY is what gets pinned here: if a rename
  // drops one of these, the room renders undefined instead of failing a build.
  const u = await mkUser('trk-props'); await grantPass(u);
  const { draftId } = await d.startTrackerDraftFor(u, TRACKER_CFG, 2, LABELS8);
  await logBest(draftId, u);
  const room = await d.getDraftForRoom(draftId, u);

  for (const k of ['config', 'order', 'rounds', 'userTeamIndex', 'teamLabels', 'picks', 'available']) {
    assert.ok(room[k] !== undefined, `missing prop: ${k}`);
  }
  assert.equal(room.rounds, 3);
  assert.equal(room.order.length, 24);
  assert.equal(room.userTeamIndex, 1);
  assert.ok(room.config.roster_slots, 'roster_slots drives buildRoster');
  assert.ok(room.config.teams_count, 'teams_count drives the slot label');

  // Every field the board + list actually read off a pick / an available row.
  const p = room.picks[0];
  for (const k of ['overallPick', 'round', 'playerName', 'position', 'slotPos', 'adpAtPick', 'isUser', 'synthetic']) {
    assert.ok(p[k] !== undefined, `pick missing: ${k}`);
  }
  const a = room.available[0];
  for (const k of ['ffcPlayerId', 'name', 'position', 'adp']) {
    assert.ok(a[k] !== undefined, `available row missing: ${k}`);
  }
});

test('tracker results are a VALUE LEDGER with no grade anywhere', async () => {
  const u = await mkUser('trk-res'); await grantPass(u);
  const { draftId } = await d.startTrackerDraftFor(u, TRACKER_CFG, 3, LABELS8);
  for (let i = 0; i < 24; i++) await logBest(draftId, u);

  const r = await d.getTrackerResults(draftId, u);
  assert.ok(r, 'results resolve for a completed tracker draft');
  // The ledger facts.
  assert.ok(Number.isFinite(r.rosterValueTotal));
  assert.equal(r.userPicks.length, 3, 'seat 3 made one pick per round');
  assert.ok(r.positionalBalance && typeof r.positionalBalance === 'object');
  assert.deepEqual(r.teamLabels, LABELS8);
  for (const pk of r.userPicks) {
    assert.ok(Number.isFinite(pk.adpAtPick), 'every ledger row carries its frozen ADP');
    assert.ok(Number.isFinite(pk.overallPick));
  }
  // NO GRADE — not the letter, not the score, not the components.
  for (const k of ['grade', 'gradeScore', 'components']) {
    assert.equal(r[k], undefined, `tracker results must not expose ${k}`);
  }
});

test('getTrackerResults refuses a sim draft (and getResults keeps working)', async () => {
  const u = await mkUser('trk-res2'); await grantPass(u);
  const sim = await d.startDraftFor(u, PRESET.id, 1, { auto: true });
  assert.equal(sim.status, 'completed');
  assert.equal(await d.getTrackerResults(sim.draftId, u), null, 'a sim draft is not tracker results');
  const graded = await d.getResults(sim.draftId, u);
  assert.ok(graded.grade, 'the sim still grades, unchanged');
});

// ---------------------------------------------------------------------------
// THE RESUME PATH — the product's core promise, and the thing a reload must not
// break.
//
// ShellPersist reloads the document on a BFCache restore inside the native
// container. A reload is a COLD RE-ENTRY: the client keeps nothing, and every
// piece of room state is rebuilt server-side from the draft row by
// getDraftForRoom. That is the same path a full app relaunch takes - the one
// already proven on device - so these tests exist to make it a DECISION rather
// than an assumption, and to fail loudly if a future change makes the room
// depend on client state that a reload would discard.
// ---------------------------------------------------------------------------

test('resume: cold re-entry mid-tracker-draft rebuilds full room state', async () => {
  const u = await mkUser('trk-resume'); await grantPass(u);
  const started = await d.startTrackerDraftFor(u, TRACKER_CFG, 3, LABELS8);
  assert.equal(started.ok, true);
  const id = started.draftId;

  // Get genuinely mid-draft: log 5 of the 24 picks, one of them the user's.
  for (let i = 0; i < 5; i += 1) await logBest(id, u);
  const before = await d.getDraftForRoom(id, u);
  assert.equal(before.picks.length, 5);
  assert.equal(before.complete, false);

  // COLD RE-ENTRY. A second independent read is exactly what the reloaded page
  // performs: no client state carries across, so this call must reconstruct
  // everything the room renders.
  const after = await d.getDraftForRoom(id, u);

  assert.equal(after.mode, 'tracker', 'still a tracker draft');
  assert.equal(after.draft.status, 'in_progress', 'reload must not complete or abandon it');
  assert.equal(after.picks.length, 5, 'every logged pick survives');
  assert.deepEqual(after.picks.map((p) => p.overallPick), [1, 2, 3, 4, 5]);
  assert.deepEqual(after.picks.map((p) => p.playerName), before.picks.map((p) => p.playerName));

  // The clock, the seat, and the wait - what the room reads on open.
  assert.equal(after.currentOverall, 6, 'the clock resumes at the next pick');
  assert.equal(after.onClockTeamIndex, before.onClockTeamIndex);
  assert.equal(after.onClockLabel, before.onClockLabel);
  assert.equal(after.userTeamIndex, 2, 'pick position 3 -> seat index 2');
  assert.deepEqual(after.seatLabels, before.seatLabels);
  assert.equal(after.myNextOverall, before.myNextOverall);
  assert.equal(after.picksUntilMyTurn, before.picksUntilMyTurn);

  // The board: drafted players are gone from available, and nothing was lost.
  assert.equal(after.available.length, before.available.length);
  const takenIds = new Set(after.picks.map((p) => p.ffcPlayerId));
  assert.equal(after.available.some((p) => takenIds.has(p.ffcPlayerId)), false,
    'a drafted player must never reappear on the board after a reload');

  // The user's own roster rebuilds, which is what MY TEAM renders.
  assert.deepEqual(after.userPicks.map((p) => p.overallPick), before.userPicks.map((p) => p.overallPick));
  assert.ok(after.userPicks.length > 0, 'seat 3 has picked by overall 5');

  // Undo is still offered, so a reload does not strand a mislogged pick.
  assert.equal(after.canUndo, true);
});

test('resume: cold re-entry mid-SIM-draft rebuilds full room state', async () => {
  // Same promise on the sim side, where the AI has also picked. The engine
  // rebuilds from the persisted picks, so a reload must not re-run or duplicate
  // any of them.
  const u = await mkUser('sim-resume');
  const started = await d.startDraftFor(u, PRESET.id, 5);
  assert.equal(started.ok, true);
  const id = started.draftId;

  const before = await d.getDraftForRoom(id, u);
  const n = before.picks.length;
  assert.ok(n > 0, 'the AI seats ahead of pick 5 have already picked');

  const after = await d.getDraftForRoom(id, u);
  assert.equal(after.picks.length, n, 'a reload must not re-run the AI or duplicate picks');
  assert.deepEqual(after.picks.map((p) => p.ffcPlayerId), before.picks.map((p) => p.ffcPlayerId));
  assert.equal(after.draft.status, 'in_progress');
  assert.equal(after.isMyTurn, before.isMyTurn);
  assert.equal(after.currentOverall, before.currentOverall);
  assert.equal(after.available.length, before.available.length);
});

test('a person may draft a SECOND K/DST onto the bench; an AI seat may not', () => {
  // Bench slots are positionless - they hold anything. Refusing a second defense
  // while bench spots stand empty was the engine deciding a roster question that
  // belongs to the person filling the roster. Two kickers can never both start,
  // which makes it a poor pick rather than an illegal one; the sort demotes it
  // to its own tier below skill depth instead of the rulebook forbidding it.
  const pool = Array.from({ length: 300 }, (_, i) => ({
    ffcPlayerId: `q${i}`, name: `Q${i}`,
    position: ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'][i % 6],
    adp: i + 1, stdev: 10, team: 'CIN', bye: 7,
  }));
  const config = {
    teams_count: 12, scoring_format: 'ppr',
    roster_slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6 },
  };
  const st = engine.createDraftState(config, pool, 3);
  const [d1, d2] = pool.filter((p) => p.position === 'DEF');
  const [k1, k2] = pool.filter((p) => p.position === 'PK');
  engine.applyPick(st, 2, d1, 'user');
  engine.applyPick(st, 2, k1, 'user');
  const team = st.teams[2];
  assert.ok(team.slots.BN.cap - team.slots.BN.filled > 0, 'precondition: bench has room');

  for (const [label, second] of [['defense', d2], ['kicker', k2]]) {
    assert.equal(engine.canRoster(st, team, second, 14, null, { humanPick: true }), true,
      `a person must be able to bench a second ${label}`);
    assert.equal(engine.canRoster(st, team, second, 14, null), false,
      `an AI seat must still be refused a second ${label}`);
  }

  // ...and it really does land on the bench rather than anywhere else.
  const before = team.slots.BN.filled;
  const rec = engine.applyPick(st, 2, d2, 'user');
  assert.equal(rec.rosterSlot, 'BN', 'the second defense occupies a bench slot');
  assert.equal(team.slots.BN.filled, before + 1);

  // The exemption lifts rules (a) and (b) and NOTHING else: with every slot
  // taken, rule (d) still refuses - there is nowhere to put him.
  const tiny = engine.createDraftState(
    { teams_count: 12, scoring_format: 'ppr', roster_slots: { QB: 1, RB: 1, WR: 1, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 1 } },
    pool, 3);
  const take = (pos, n) => pool.filter((p) => p.position === pos).slice(0, n);
  for (const p of [...take('QB', 1), ...take('RB', 2), ...take('WR', 2), ...take('TE', 1), ...take('PK', 1), d1]) {
    engine.applyPick(tiny, 2, p, 'user');
  }
  assert.equal(engine.canRoster(tiny, tiny.teams[2], d2, 14, null, { humanPick: true }), false,
    'a full roster still has nowhere to put him - humanPick is not a licence');
});

test('the K/DST round floor binds AI seats only - a person may draft any legal player', () => {
  // Live incident: a user with an OPEN DST slot was refused in round 8 with
  // "Roster can't fit that pick" - over a slot that was visibly empty. The
  // floor is an engine sanity rule that keeps AI drafters realistic. Imposed on
  // a person it contradicts the product's promise, so the human seat is exempt
  // and the engine's own behaviour is untouched.
  const pool = Array.from({ length: 200 }, (_, i) => ({
    ffcPlayerId: `p${i}`, name: `P${i}`,
    position: ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'][i % 6],
    adp: i + 1, stdev: 10, team: 'CIN', bye: 7,
  }));
  const config = {
    teams_count: 12, scoring_format: 'ppr',
    roster_slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6 },
  };
  const st = engine.createDraftState(config, pool, 3);
  const team = st.teams[2];
  const kicker = pool.find((p) => p.position === 'PK');
  const dst = pool.find((p) => p.position === 'DEF');

  for (const [label, player] of [['kicker', kicker], ['defense', dst]]) {
    assert.equal(engine.canRoster(st, team, player, 8, null), false,
      `an AI seat must still be barred from a ${label} in round 8`);
    assert.equal(engine.canRoster(st, team, player, 8, null, { humanPick: true }), true,
      `a person must be able to draft a ${label} in round 8`);
  }
  // humanPick lifts rules (a) AND (b) - the two K/DST guardrails - and nothing
  // else. The second-K/DST half is pinned in its own test above, including that
  // rule (d) still refuses when the roster genuinely has nowhere to put him.
});
