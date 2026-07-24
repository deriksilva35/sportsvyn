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

// ---- entitlement ----
test('entitlement: derived count, abandoned excluded, member bypass', async () => {
  const u = U.ent;
  assert.equal(await d.getDraftsUsed(u), 0);
  assert.equal((await d.canStartDraft(u, false)).ok, true);
  for (let i = 0; i < 3; i++) {
    await sql`INSERT INTO drafts (user_id, status, pool_snapshot_date, pool_scoring_format, pool_teams_count, started_at)
              VALUES (${u}, 'completed', '2026-07-15', 'ppr', 12, now())`;
  }
  assert.equal(await d.getDraftsUsed(u), 3);
  const gate = await d.canStartDraft(u, false);
  assert.equal(gate.ok, false); assert.equal(gate.reason, 'entitlement'); assert.equal(gate.limit, 3);
  // abandoned does NOT count
  await sql`INSERT INTO drafts (user_id, status, pool_snapshot_date, pool_scoring_format, pool_teams_count, started_at)
            VALUES (${u}, 'abandoned', '2026-07-15', 'ppr', 12, now())`;
  assert.equal(await d.getDraftsUsed(u), 3, 'abandoned must not count');
  // member bypass (flag would come from isMember; test the gate math directly)
  assert.equal((await d.canStartDraft(u, true)).ok, true, 'member bypasses the limit');
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
  const k = pool.find((p) => p.position === 'PK' && !drafted.has(p.ffcPlayerId));
  const illegal = await d.makePickFor(U.int, draftId, k.ffcPlayerId);
  assert.equal(illegal.reason, 'illegal_pick', 'kicker before round 13 rejected');
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
