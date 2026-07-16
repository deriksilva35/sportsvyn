// lib/fantasy/drafts.js — sim readers, entitlement gate, and the draft-flow core.
//
// The flow-core functions (*For(userId, ...)) take the user id EXPLICITLY and do
// all the engine + DB work; app/actions/sim.js wraps each in a thin 'use server'
// action that resolves the session and never trusts a client-supplied id. This
// split keeps the flow unit-testable (fake user rows) without a Next runtime.
//
// Entitlement is DERIVED from the drafts count — there is NO counter column.
// adp_at_pick is frozen on EVERY persisted pick from the draft's provenance pool
// (the value ledger's raw material); a draft never regrades on later ADP.

import { sql } from '../db.js';
import * as engine from './engine.js';

export const FREE_DRAFT_LIMIT = 3;

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------
export async function getPresets() {
  return sql`SELECT id, name, teams_count, scoring_format, roster_slots, pick_timer_seconds
               FROM draft_configs WHERE is_preset = true ORDER BY id`;
}

function mapPoolRow(r) {
  return {
    ffcPlayerId: r.ffc_player_id, name: r.name, position: r.position, team: r.team,
    adp: Number(r.adp), adpHigh: r.adp_high == null ? null : Number(r.adp_high),
    adpLow: r.adp_low == null ? null : Number(r.adp_low), timesDrafted: r.times_drafted,
    stdev: r.stdev == null ? null : Number(r.stdev), bye: r.bye,
  };
}

export async function getLatestPool(scoringFormat, teamsCount) {
  const snap = (await sql`SELECT max(snapshot_date) d FROM sim_player_pool
                           WHERE scoring_format = ${scoringFormat} AND teams_count = ${teamsCount}`)[0];
  if (!snap?.d) return { snapshotDate: null, rows: [] };
  return { snapshotDate: snap.d, rows: await getPoolAt(scoringFormat, teamsCount, snap.d) };
}

export async function getPoolAt(scoringFormat, teamsCount, snapshotDate) {
  const rows = await sql`SELECT ffc_player_id, name, position, team, adp, adp_high, adp_low, times_drafted, stdev, bye
                           FROM sim_player_pool
                          WHERE scoring_format = ${scoringFormat} AND teams_count = ${teamsCount}
                            AND snapshot_date = ${snapshotDate}
                          ORDER BY adp ASC`;
  return rows.map(mapPoolRow);
}

// ---------------------------------------------------------------------------
// Entitlement (derived — never a counter column)
// ---------------------------------------------------------------------------
// Abandoned drafts do NOT count against the gate: starting a draft then bailing
// should not burn a credit (only completed + still-in-progress consume one).
// I agree with this — otherwise a curiosity click permanently costs a credit.
export async function getDraftsUsed(userId) {
  const r = await sql`SELECT count(*)::int n FROM drafts
                       WHERE user_id = ${userId} AND status IN ('completed', 'in_progress')`;
  return r[0]?.n ?? 0;
}

// Membership. RECON: the users table today is {id, name, email, emailVerified,
// image} — there is NO member/founding/stripe column. Everyone is FREE for now.
export async function isMember(/* userId */) {
  // ┌──────────────────────────────────────────────────────────────────────┐
  // │ TODO(membership integration point): no member flag exists on `users`  │
  // │ yet. When Founding Member / Stripe status lands, resolve it HERE (e.g. │
  // │ a users.membership_tier column or a subscriptions table) and return    │
  // │ true for paid tiers. This function is the SINGLE place the sim gate     │
  // │ reads membership. Do NOT build Stripe plumbing in the sim sessions.    │
  // └──────────────────────────────────────────────────────────────────────┘
  return false;
}

export async function canStartDraft(userId, member) {
  if (member) return { ok: true, member: true };
  const used = await getDraftsUsed(userId);
  return used < FREE_DRAFT_LIMIT
    ? { ok: true, used, limit: FREE_DRAFT_LIMIT }
    : { ok: false, reason: 'entitlement', used, limit: FREE_DRAFT_LIMIT };
}

// ---------------------------------------------------------------------------
// Ownership-scoped draft reads
// ---------------------------------------------------------------------------
export async function getDraft(draftId, userId) {
  const draft = (await sql`SELECT * FROM drafts WHERE id = ${draftId} AND user_id = ${userId} LIMIT 1`)[0];
  if (!draft) return null; // never returns another user's draft
  const picks = await sql`SELECT * FROM draft_picks WHERE draft_id = ${draftId} ORDER BY overall_pick ASC`;
  return { draft, picks };
}

export async function getDraftHistory(userId) {
  // Server returns EVERYTHING the user owns; the 3-visible view gate is a later
  // UI decision.
  return sql`SELECT d.*, (SELECT count(*)::int FROM draft_picks p WHERE p.draft_id = d.id) AS pick_count
               FROM drafts d WHERE d.user_id = ${userId}
              ORDER BY d.started_at DESC NULLS LAST, d.id DESC`;
}

// ---------------------------------------------------------------------------
// Flow core (userId explicit; the actions add auth)
// ---------------------------------------------------------------------------
const ymd = (d) => (typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10));

async function loadConfig(configId) {
  return (await sql`SELECT id, name, teams_count, scoring_format, roster_slots, pick_timer_seconds, is_preset
                      FROM draft_configs WHERE id = ${configId} LIMIT 1`)[0] ?? null;
}

function pickInsert(draftId, rec) {
  return sql`INSERT INTO draft_picks
    (draft_id, round, overall_pick, roster_slot, ffc_player_id, player_name, position, picked_by, adp_at_pick, picked_at)
    VALUES (${draftId}, ${rec.round}, ${rec.overallPick}, ${rec.rosterSlot}, ${rec.ffcPlayerId},
            ${rec.playerName}, ${rec.position}, ${rec.pickedBy}, ${rec.adpAtPick}, now())`;
}

// Rebuild engine state by replaying persisted picks (deterministic — synthetic
// K/DST fillers regenerate with identical ids, so every persisted pick resolves).
function rebuildState(config, pool, userPos, pickRows) {
  const state = engine.createDraftState(config, pool, userPos);
  const byId = new Map(state.available.map((p) => [p.ffcPlayerId, p]));
  for (const pk of [...pickRows].sort((a, b) => a.overall_pick - b.overall_pick)) {
    const player = byId.get(pk.ffc_player_id);
    if (!player) throw new Error(`rebuildState: persisted player ${pk.ffc_player_id} not in pool`);
    const teamIndex = state.order[pk.overall_pick - 1];
    engine.applyPick(state, teamIndex, player, pk.picked_by);
  }
  return state;
}

// Advance AI seats until it is the user's turn or the draft is complete. Mutates
// state; returns the pick records made (to persist).
function advanceAi(state, userTeamIndex, draftId) {
  const made = [];
  const total = state.rounds * state.teamsCount;
  while (state.overallPick <= total && state.order[state.overallPick - 1] !== userTeamIndex) {
    const rng = engine.makeRng(draftId * 7919 + state.overallPick);
    const rec = engine.aiPick(state, state.order[state.overallPick - 1], rng);
    if (!rec) throw new Error(`advanceAi: no legal pick at overall ${state.overallPick}`);
    made.push(rec);
  }
  return made;
}

export async function startDraftFor(userId, presetId, pickPosition, opts = {}) {
  const config = await loadConfig(presetId);
  if (!config || !config.is_preset) return { ok: false, reason: 'preset_not_found' };

  const member = await isMember(userId);
  const gate = await canStartDraft(userId, member);
  if (!gate.ok) return { ok: false, reason: 'entitlement', used: gate.used, limit: gate.limit };

  const { snapshotDate, rows: pool } = await getLatestPool(config.scoring_format, config.teams_count);
  if (!pool.length) return { ok: false, reason: 'no_pool' };

  const N = config.teams_count;
  const pos = pickPosition === 'random' ? (Math.floor(Math.random() * N) + 1) : Number(pickPosition);
  if (!Number.isInteger(pos) || pos < 1 || pos > N) return { ok: false, reason: 'bad_position' };
  const isAuto = opts.auto === true;

  const draftRow = (await sql`
    INSERT INTO drafts (user_id, config_id, status, pick_position, is_auto,
                        pool_snapshot_date, pool_scoring_format, pool_teams_count, started_at)
    VALUES (${userId}, ${config.id}, 'in_progress', ${pos}, ${isAuto},
            ${ymd(snapshotDate)}, ${config.scoring_format}, ${config.teams_count}, now())
    RETURNING id`)[0];
  const draftId = draftRow.id;
  const userTeamIndex = pos - 1;

  if (isAuto) {
    const { picks } = engine.runFullDraft(config, pool, pos, { auto: true }, engine.makeRng(draftId * 7919 + 1));
    await sql.transaction([
      ...picks.map((rec) => pickInsert(draftId, rec)),
      sql`UPDATE drafts SET status = 'completed', completed_at = now() WHERE id = ${draftId}`,
    ]);
    return { ok: true, draftId, status: 'completed', pickCount: picks.length, pickPosition: pos, snapshotDate: ymd(snapshotDate) };
  }

  // interactive: persist AI picks up to the user's first turn
  const state = engine.createDraftState(config, pool, pos);
  const made = advanceAi(state, userTeamIndex, draftId);
  if (made.length) await sql.transaction(made.map((rec) => pickInsert(draftId, rec)));
  return { ok: true, draftId, status: 'in_progress', pickPosition: pos, overallPick: state.overallPick, onTheClock: 'user', aiPicksMade: made.length };
}

// Shared setup for makePick / timerAutoPick: load + ownership + rebuild + turn.
async function loadPlayable(userId, draftId) {
  const draft = (await sql`SELECT * FROM drafts WHERE id = ${draftId} AND user_id = ${userId} LIMIT 1`)[0];
  if (!draft) return { err: { ok: false, reason: 'not_found_or_not_owner' } };
  if (draft.status !== 'in_progress') return { err: { ok: false, reason: 'not_in_progress' } };
  const config = await loadConfig(draft.config_id);
  const pool = await getPoolAt(draft.pool_scoring_format, draft.pool_teams_count, draft.pool_snapshot_date);
  const pickRows = await sql`SELECT * FROM draft_picks WHERE draft_id = ${draftId} ORDER BY overall_pick ASC`;
  const state = rebuildState(config, pool, draft.pick_position, pickRows);
  const userTeamIndex = draft.pick_position - 1;
  if (state.order[state.overallPick - 1] !== userTeamIndex) return { err: { ok: false, reason: 'not_your_turn' } };
  return { draft, config, state, userTeamIndex };
}

async function persistTurn(draftId, state, userRec, aiMade) {
  const total = state.rounds * state.teamsCount;
  const done = state.overallPick > total;
  const batch = [pickInsert(draftId, userRec), ...aiMade.map((r) => pickInsert(draftId, r))];
  if (done) batch.push(sql`UPDATE drafts SET status = 'completed', completed_at = now() WHERE id = ${draftId}`);
  await sql.transaction(batch);
  return {
    ok: true, draftId, status: done ? 'completed' : 'in_progress',
    userPick: { overallPick: userRec.overallPick, rosterSlot: userRec.rosterSlot, playerName: userRec.playerName },
    aiPicksMade: aiMade.length, nextOverall: done ? null : state.overallPick,
  };
}

export async function makePickFor(userId, draftId, ffcPlayerId) {
  const l = await loadPlayable(userId, draftId);
  if (l.err) return l.err;
  const { state, userTeamIndex } = l;
  const round = Math.ceil(state.overallPick / state.teamsCount);
  const player = state.available.find((p) => p.ffcPlayerId === String(ffcPlayerId));
  if (!player) return { ok: false, reason: 'player_unavailable' };
  // Same hard legality the engine enforces for AI (roster slot fillable, K/DST
  // timing, position caps) — no scarcity ctx (that is an AI-only heuristic).
  if (!engine.canRoster(state, state.teams[userTeamIndex], player, round)) return { ok: false, reason: 'illegal_pick' };
  const nw = engine.needWeight(state, state.teams[userTeamIndex], player);
  const userRec = engine.applyPick(state, userTeamIndex, player, 'user', { needWeight: nw });
  const aiMade = advanceAi(state, userTeamIndex, draftId);
  return persistTurn(draftId, state, userRec, aiMade);
}

export async function timerAutoPickFor(userId, draftId) {
  // Server-authoritative timer fallback. The UI timer is ADVISORY; the server
  // never trusts client clocks. PERMISSIVE v1: callable by the owning user
  // whenever it is their turn — it just deterministically picks best-available
  // for them. No early-timeout enforcement (that policy can tighten later).
  const l = await loadPlayable(userId, draftId);
  if (l.err) return l.err;
  const { state, userTeamIndex } = l;
  const userRec = engine.autoPick(state, userTeamIndex);
  if (!userRec) return { ok: false, reason: 'no_legal_pick' };
  const aiMade = advanceAi(state, userTeamIndex, draftId);
  return persistTurn(draftId, state, userRec, aiMade);
}

export async function abandonDraftFor(userId, draftId) {
  const r = await sql`UPDATE drafts SET status = 'abandoned'
                       WHERE id = ${draftId} AND user_id = ${userId} AND status = 'in_progress'
                      RETURNING id`;
  if (!r.length) return { ok: false, reason: 'not_found_or_not_abandonable' };
  return { ok: true, draftId, status: 'abandoned' };
}
