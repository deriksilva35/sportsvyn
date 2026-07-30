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
import { membershipIsActive, getEntitlements } from '../membership.js';
import * as engine from './engine.js';
import { gradeDraft } from './grade.js';
import { validateConfig, deriveRounds, nearestPoolPair } from './config.js';
import { MODE_TRACKER, normalizeTeamLabels, seatLabel, nextUserOverall, picksUntilUserTurn } from './tracker.js';

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

// Distinct (scoring_format, teams_count) pairs that have a snapshot — the set a
// custom config maps its ADP pool onto (see nearestPoolPair). Only the launch
// presets are snapshotted today, so this is a small list.
export async function getPoolPairs() {
  const rows = await sql`SELECT DISTINCT scoring_format, teams_count FROM sim_player_pool`;
  return rows.map((r) => ({ scoringFormat: r.scoring_format, teamsCount: r.teams_count }));
}

// ---------------------------------------------------------------------------
// Entitlement (derived — never a counter column)
// ---------------------------------------------------------------------------
// The free gate is 3 drafts per ET WEEK (Monday 00:00 America/New_York boundary),
// DERIVED from a count in the current week window — never a counter column.
// Abandoned drafts do NOT count (starting then bailing should not burn a credit;
// only completed + still-in-progress consume one). The week start is computed
// DST-correctly in Postgres (date_trunc 'week' = Monday); this is a gate-window
// read, not a provider-time conversion, so it does not route through
// easternLocalToUtc (that helper is for the ingest boundary).
// TRACKER DRAFTS ARE EXCLUDED (mode = 'sim' only). A tracker draft is a record of
// a real draft the user attended, not a consumption of the mock-draft product, so
// it must never burn a free credit. It cannot reach a free user anyway (tracker is
// Pass-gated with no trial), but the gate is written to be correct on its own
// rather than to rely on a second gate upstream staying correct.
export async function getDraftsUsed(userId) {
  const r = await sql`SELECT count(*)::int n FROM drafts
                       WHERE user_id = ${userId} AND status IN ('completed', 'in_progress')
                         AND mode = 'sim'
                         AND started_at >= (date_trunc('week', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York')`;
  return r[0]?.n ?? 0;
}

// The Monday-00:00-ET start of the ET week containing `now` (or the current now()
// when null), as a UTC instant. Exported for the boundary unit test; getDraftsUsed
// inlines the same expression against now().
export async function etWeekStartUtc(now = null) {
  const r = now == null
    ? await sql`SELECT (date_trunc('week', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York') AS s`
    : await sql`SELECT (date_trunc('week', ${now}::timestamptz AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York') AS s`;
  return r[0].s;
}

// Membership. The SINGLE place the sim gate reads membership — every downstream
// gate (custom-config, unlimited drafts, account status line) flips off this.
// Backed by the memberships table, written only by the Stripe webhook.
export async function isMember(userId) {
  return membershipIsActive(userId);
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
  // UI decision. Joins the config (name/teams/scoring for the row label) and the
  // Read (grade, when the draft has been graded) so the history list is one query.
  return sql`SELECT d.id, d.status, d.started_at, d.completed_at, d.pick_position,
                    c.name AS config_name, c.teams_count, c.scoring_format,
                    r.grade,
                    (SELECT count(*)::int FROM draft_picks p WHERE p.draft_id = d.id) AS pick_count
               FROM drafts d
               LEFT JOIN draft_configs c ON c.id = d.config_id
               LEFT JOIN draft_reads r ON r.draft_id = d.id
              WHERE d.user_id = ${userId}
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

// Shared draft-creation tail for BOTH the preset and custom paths: resolve the
// seat, insert the drafts row (freezing the ACTUAL pool provenance, which may
// differ from the config for a nearest-pool-mapped custom draft), then run the
// draft (auto) or persist AI picks up to the user's first turn (interactive).
// `config` is a draft_configs row; `poolCtx` carries the resolved pool + the pool
// pair that was actually used.
async function finalizeStart(config, pickPosition, opts, poolCtx) {
  const { snapshotDate, pool, poolScoringFormat, poolTeamsCount } = poolCtx;
  const N = config.teams_count;
  const pos = pickPosition === 'random' ? (Math.floor(Math.random() * N) + 1) : Number(pickPosition);
  if (!Number.isInteger(pos) || pos < 1 || pos > N) return { ok: false, reason: 'bad_position' };
  const isAuto = opts.auto === true;

  const draftRow = (await sql`
    INSERT INTO drafts (user_id, config_id, status, pick_position, is_auto,
                        pool_snapshot_date, pool_scoring_format, pool_teams_count, started_at)
    VALUES (${config.user_id}, ${config.id}, 'in_progress', ${pos}, ${isAuto},
            ${ymd(snapshotDate)}, ${poolScoringFormat}, ${poolTeamsCount}, now())
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

  const state = engine.createDraftState(config, pool, pos);
  const made = advanceAi(state, userTeamIndex, draftId);
  if (made.length) await sql.transaction(made.map((rec) => pickInsert(draftId, rec)));
  return { ok: true, draftId, status: 'in_progress', pickPosition: pos, overallPick: state.overallPick, onTheClock: 'user', aiPicksMade: made.length };
}

export async function startDraftFor(userId, presetId, pickPosition, opts = {}) {
  const config = await loadConfig(presetId);
  if (!config || !config.is_preset) return { ok: false, reason: 'preset_not_found' };

  const member = await isMember(userId);
  const gate = await canStartDraft(userId, member);
  if (!gate.ok) return { ok: false, reason: 'entitlement', used: gate.used, limit: gate.limit };

  const { snapshotDate, rows: pool } = await getLatestPool(config.scoring_format, config.teams_count);
  if (!pool.length) return { ok: false, reason: 'no_pool' };

  // config.user_id is NULL for presets; the draft row must carry the drafting user.
  return finalizeStart({ ...config, user_id: userId }, pickPosition, opts, {
    snapshotDate, pool,
    poolScoringFormat: config.scoring_format, poolTeamsCount: config.teams_count,
  });
}

// Start a draft from a fully custom config (the setup console). Custom configs
// are a MEMBER feature — enforced here server-side no matter what the client
// shows (>12 teams and superflex are subsets of "custom"). The client-supplied
// config is untrusted: validateConfig enforces every bound/enum before we persist
// a draft_configs row. The chosen (scoring, teams) maps to the NEAREST snapshot
// pool (scoring exact first, then closest size); the drafts row freezes that pool
// pair as provenance while the config keeps the user's real team count / rounds.
// Resolve the ADP pool for a VALIDATED custom config: map (scoring, teams) onto
// the nearest snapshot pair, load it, and check the config's real demand fits.
// Shared by startCustomDraftFor and startTrackerDraftFor so the two cannot drift
// on pool mapping or the too-small guard.
async function resolveCustomPool(cfg) {
  const pairs = await getPoolPairs();
  const mapped = nearestPoolPair({ scoringFormat: cfg.scoringFormat, teamsCount: cfg.teamsCount }, pairs);
  if (!mapped) return { err: { ok: false, reason: 'no_pool' } };
  const { snapshotDate, rows: pool } = await getLatestPool(mapped.pair.scoringFormat, mapped.pair.teamsCount);
  if (!pool.length) return { err: { ok: false, reason: 'no_pool' } };

  // A custom size can outrun the pool. Only K/DST are synthetically backfillable,
  // so the real (skill + FLEX/SUPERFLEX + bench) demand must fit the pool.
  const rounds = deriveRounds(cfg.rosterSlots);
  const synthPerTeam = (cfg.rosterSlots.K || 0) + (cfg.rosterSlots.DST || 0);
  const realDemand = cfg.teamsCount * rounds - cfg.teamsCount * synthPerTeam;
  if (realDemand > pool.length) return { err: { ok: false, reason: 'pool_too_small' } };

  return { mapped, snapshotDate, pool };
}

export async function startCustomDraftFor(userId, configInput, pickPosition, opts = {}) {
  const v = validateConfig(configInput);
  if (!v.ok) return { ok: false, reason: v.reason, detail: v.detail };

  const member = await isMember(userId);
  if (!member) return { ok: false, reason: 'entitlement_custom' };
  const gate = await canStartDraft(userId, member); // members bypass the 3-free gate
  if (!gate.ok) return { ok: false, reason: 'entitlement', used: gate.used, limit: gate.limit };

  const cfg = v.config;
  const r = await resolveCustomPool(cfg);
  if (r.err) return r.err;
  const { mapped, snapshotDate, pool } = r;

  const configRow = (await sql`
    INSERT INTO draft_configs (user_id, name, teams_count, scoring_format, roster_slots, pick_timer_seconds, is_preset, source)
    VALUES (${userId}, ${'Custom'}, ${cfg.teamsCount}, ${cfg.scoringFormat},
            ${JSON.stringify(cfg.rosterSlots)}::jsonb, ${cfg.clockSeconds}, false, 'manual')
    RETURNING id, user_id, name, teams_count, scoring_format, roster_slots, pick_timer_seconds, is_preset`)[0];

  const res = await finalizeStart(configRow, pickPosition, opts, {
    snapshotDate, pool,
    poolScoringFormat: mapped.pair.scoringFormat, poolTeamsCount: mapped.pair.teamsCount,
  });
  return res.ok ? { ...res, poolMapping: { exact: mapped.exact, scoringExact: mapped.scoringExact } } : res;
}

// Shared setup for makePick / timerAutoPick / logPick: load + ownership + rebuild
// + turn. `requireUserTurn` is the ONE difference between sim and tracker:
//
//   sim     — the user may only commit their OWN seat. Every other seat belongs to
//             the engine, so a request for someone else's pick is a bug or an
//             attack; refuse it.
//   tracker — the user records EVERY seat, so the turn check is not "is this your
//             seat" but "is this draft yours", which the ownership predicate above
//             already answers. Inverting the guard here (rather than deleting it)
//             keeps sim's protection exactly as strong as it was.
//
// Ownership is enforced identically in both: the draft row is fetched
// `WHERE user_id = ${userId}`, so another user's draft is never loadable.
async function loadPlayable(userId, draftId, { requireUserTurn = true } = {}) {
  const draft = (await sql`SELECT * FROM drafts WHERE id = ${draftId} AND user_id = ${userId} LIMIT 1`)[0];
  if (!draft) return { err: { ok: false, reason: 'not_found_or_not_owner' } };
  if (draft.status !== 'in_progress') return { err: { ok: false, reason: 'not_in_progress' } };
  const config = await loadConfig(draft.config_id);
  const pool = await getPoolAt(draft.pool_scoring_format, draft.pool_teams_count, draft.pool_snapshot_date);
  const pickRows = await sql`SELECT * FROM draft_picks WHERE draft_id = ${draftId} ORDER BY overall_pick ASC`;
  const state = rebuildState(config, pool, draft.pick_position, pickRows);
  const userTeamIndex = draft.pick_position - 1;
  const onClockTeamIndex = state.order[state.overallPick - 1];
  if (requireUserTurn && onClockTeamIndex !== userTeamIndex) return { err: { ok: false, reason: 'not_your_turn' } };
  return { draft, config, state, userTeamIndex, onClockTeamIndex };
}

const SLOT_OF = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', PK: 'K', DEF: 'DST' };
// Client-facing pick shape. Used by makePick's return AND getDraftForRoom so the
// client appends new picks in the same shape it first rendered.
function pickDTO(rec) {
  return {
    overallPick: rec.overallPick, round: rec.round, rosterSlot: rec.rosterSlot,
    ffcPlayerId: rec.ffcPlayerId, playerName: rec.playerName, position: rec.position,
    slotPos: rec.slotPos ?? SLOT_OF[rec.position] ?? rec.position,
    team: rec.team ?? null, bye: rec.bye ?? null, adpAtPick: Number(rec.adpAtPick),
    pickedBy: rec.pickedBy, isUser: rec.isUser === true, synthetic: rec.synthetic === true,
  };
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
    // UI needs the actual new picks (user + AI) to render the staggered reveal.
    picksMade: [userRec, ...aiMade].map(pickDTO),
  };
}

// Snake order: overall pick (1-based) -> team index (0-based).
function snakeOrder(teamsCount, rounds) {
  const o = [];
  for (let r = 1; r <= rounds; r++) {
    const row = Array.from({ length: teamsCount }, (_, t) => t);
    if (r % 2 === 0) row.reverse();
    o.push(...row);
  }
  return o;
}

// One bundled reader for the draft room: ownership-scoped draft + config + the
// provenance pool + enriched picks (team/bye/slotPos/isUser) + real-player
// available set + whose-turn. Returns null if not the user's draft.
export async function getDraftForRoom(draftId, userId) {
  const dr = await getDraft(draftId, userId);
  if (!dr) return null;
  const { draft, picks } = dr;
  const config = await loadConfig(draft.config_id);
  const pool = await getPoolAt(draft.pool_scoring_format, draft.pool_teams_count, draft.pool_snapshot_date);
  const poolById = new Map(pool.map((p) => [p.ffcPlayerId, p]));
  const rounds = Object.values(config.roster_slots).reduce((a, b) => a + b, 0);
  const order = snakeOrder(config.teams_count, rounds);
  const userTeamIndex = draft.pick_position - 1;

  const enriched = picks.map((row) => {
    const pl = poolById.get(row.ffc_player_id);
    return {
      overallPick: row.overall_pick, round: row.round, rosterSlot: row.roster_slot,
      ffcPlayerId: row.ffc_player_id, playerName: row.player_name, position: row.position,
      slotPos: SLOT_OF[row.position] ?? row.position, team: pl?.team ?? null, bye: pl?.bye ?? null,
      adpAtPick: Number(row.adp_at_pick), pickedBy: row.picked_by,
      isUser: order[row.overall_pick - 1] === userTeamIndex,
      synthetic: String(row.ffc_player_id).startsWith('syn-'),
    };
  });
  const drafted = new Set(picks.map((p) => p.ffc_player_id));
  const available = pool.filter((p) => !drafted.has(p.ffcPlayerId));
  const currentOverall = picks.length + 1;
  const complete = currentOverall > order.length;
  // Pool provenance vs the config's own (scoring, teams). For a custom draft the
  // ADP pool is the NEAREST snapshot, which can differ from the real team count /
  // scoring — the room surfaces that honestly rather than implying exact ADP.
  const poolMapping = {
    configScoring: config.scoring_format, configTeams: config.teams_count,
    poolScoring: draft.pool_scoring_format, poolTeams: draft.pool_teams_count,
    exact: config.scoring_format === draft.pool_scoring_format
      && config.teams_count === draft.pool_teams_count,
  };
  // Tracker additions. `onClockTeamIndex` is the seat the room must name — in sim
  // it is only ever the user or an engine seat, but in tracker every seat is a
  // person the user has to identify at a table, so the LABEL is the primary cue
  // and "is it mine" is secondary.
  const teamLabels = draft.team_labels ?? null;
  const onClockTeamIndex = complete ? null : order[currentOverall - 1];
  const nextOverall = complete ? null : nextUserOverall(order, userTeamIndex, currentOverall - 1);

  return {
    draft, config, rounds, order, userTeamIndex,
    picks: enriched, userPicks: enriched.filter((p) => p.isUser), available,
    currentOverall: complete ? null : currentOverall,
    currentRound: complete ? null : Math.ceil(currentOverall / config.teams_count),
    isMyTurn: !complete && order[currentOverall - 1] === userTeamIndex,
    complete, timerSeconds: config.pick_timer_seconds, poolMapping,
    isAuto: draft.is_auto === true, // mid-draft AUTO toggle state (see setAutoDraftFor)
    mode: draft.mode ?? 'sim',
    teamLabels,
    onClockTeamIndex,
    onClockLabel: onClockTeamIndex == null ? null : seatLabel(teamLabels, onClockTeamIndex, userTeamIndex),
    // Seat labels for EVERY column, resolved once server-side so the board grid,
    // the pick ticker and the on-clock banner cannot disagree about a name.
    seatLabels: Array.from({ length: config.teams_count }, (_, i) => seatLabel(teamLabels, i, userTeamIndex)),
    // The needs panel's anchor: my next turn, and the wait in picks.
    myNextOverall: nextOverall,
    picksUntilMyTurn: complete ? null : picksUntilUserTurn(order, userTeamIndex, currentOverall),
    canUndo: (draft.mode ?? 'sim') === MODE_TRACKER && picks.length > 0,
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

// ---------------------------------------------------------------------------
// TRACKER MODE — live in-person draft companion
// ---------------------------------------------------------------------------
// No engine opponents, no clock: the user records every seat's pick as it is
// announced at a real draft table. The engine needs no changes — applyPick already
// commits a specific player for an arbitrary team index — so the whole mode is
// three flow functions plus the mode flag.

/**
 * Start a tracker draft.
 *
 * PASS-GATED, NO FREE TRIAL: gated on the `sim` entitlement (an active
 * subscription OR an unexpired Draft Pass), exactly like custom configs. There is
 * deliberately NO canStartDraft call — the free 3-draft gate is the mock-draft
 * product's meter, and a tracker draft neither consumes it (getDraftsUsed filters
 * mode='sim') nor is reachable without the entitlement.
 *
 * Always custom-config shaped: a tracker draft mirrors a REAL league, which rarely
 * matches a preset exactly. The client can prefill the console from a preset; the
 * server validates the same untrusted config through the same validateConfig.
 *
 * teamLabels is optional (null renders "Team N"), but a wrong-LENGTH array is
 * rejected rather than padded — see normalizeTeamLabels.
 */
export async function startTrackerDraftFor(userId, configInput, pickPosition, teamLabels = null) {
  const v = validateConfig(configInput);
  if (!v.ok) return { ok: false, reason: v.reason, detail: v.detail };

  const ent = await getEntitlements(userId);
  if (!ent.sim) return { ok: false, reason: 'entitlement_tracker' };

  const cfg = v.config;
  const labels = normalizeTeamLabels(teamLabels, cfg.teamsCount);
  if (!labels.ok) return { ok: false, reason: labels.reason, detail: labels.detail };

  const r = await resolveCustomPool(cfg);
  if (r.err) return r.err;
  const { mapped, snapshotDate, pool } = r;

  const N = cfg.teamsCount;
  const pos = pickPosition === 'random' ? (Math.floor(Math.random() * N) + 1) : Number(pickPosition);
  if (!Number.isInteger(pos) || pos < 1 || pos > N) return { ok: false, reason: 'bad_position' };

  const configRow = (await sql`
    INSERT INTO draft_configs (user_id, name, teams_count, scoring_format, roster_slots, pick_timer_seconds, is_preset, source)
    VALUES (${userId}, ${'Tracker'}, ${cfg.teamsCount}, ${cfg.scoringFormat},
            ${JSON.stringify(cfg.rosterSlots)}::jsonb, NULL, false, 'tracker')
    RETURNING id`)[0];

  // No AI finalize: a tracker draft starts EMPTY. Pick 1 is logged by the user,
  // even when seat 1 is not theirs.
  const draftRow = (await sql`
    INSERT INTO drafts (user_id, config_id, status, pick_position, is_auto, mode, team_labels,
                        pool_snapshot_date, pool_scoring_format, pool_teams_count, started_at)
    VALUES (${userId}, ${configRow.id}, 'in_progress', ${pos}, false, ${MODE_TRACKER},
            ${labels.labels == null ? null : JSON.stringify(labels.labels)}::jsonb,
            ${ymd(snapshotDate)}, ${mapped.pair.scoringFormat}, ${mapped.pair.teamsCount}, now())
    RETURNING id`)[0];

  return {
    ok: true, draftId: draftRow.id, mode: MODE_TRACKER, status: 'in_progress',
    pickPosition: pos, overallPick: 1, snapshotDate: ymd(snapshotDate),
    poolMapping: { exact: mapped.exact, scoringExact: mapped.scoringExact },
  };
}

/**
 * Log the pick for whichever seat is on the clock. THE tracker write path.
 *
 * picked_by attribution is what makes the whole mode honest downstream:
 *   'user'   — the on-clock seat IS the owner's seat (their real roster)
 *   'logged' — the owner recorded another manager's pick
 * Never 'ai': no engine chose any of these. getGlobalMostDrafted filters
 * picked_by='user' AND mode='sim', so neither value leaks into the public board.
 *
 * No advanceAi. Logging a pick advances the draft by exactly one.
 */
export async function logPickFor(userId, draftId, ffcPlayerId) {
  const l = await loadPlayable(userId, draftId, { requireUserTurn: false });
  if (l.err) return l.err;
  const { draft, state, userTeamIndex, onClockTeamIndex } = l;
  if (draft.mode !== MODE_TRACKER) return { ok: false, reason: 'not_tracker' };

  const round = Math.ceil(state.overallPick / state.teamsCount);
  const player = state.available.find((p) => p.ffcPlayerId === String(ffcPlayerId));
  if (!player) return { ok: false, reason: 'player_unavailable' };
  // Same hard legality the engine enforces everywhere else (slot fillable, K/DST
  // timing, position caps). No scarcity ctx — that is an AI-only heuristic, and a
  // real draft room is under no obligation to respect it.
  if (!engine.canRoster(state, state.teams[onClockTeamIndex], player, round)) {
    return { ok: false, reason: 'illegal_pick' };
  }

  const isOwnSeat = onClockTeamIndex === userTeamIndex;
  // needWeight is recorded for the owner's own picks only — it feeds the pivot
  // callout, which is about THEIR roster. Another manager's need is not ours to
  // narrate.
  const nw = isOwnSeat ? engine.needWeight(state, state.teams[onClockTeamIndex], player) : null;
  const rec = engine.applyPick(state, onClockTeamIndex, player, isOwnSeat ? 'user' : 'logged', { needWeight: nw });

  const total = state.rounds * state.teamsCount;
  const done = state.overallPick > total;
  const batch = [pickInsert(draftId, rec)];
  if (done) batch.push(sql`UPDATE drafts SET status = 'completed', completed_at = now() WHERE id = ${draftId}`);
  await sql.transaction(batch);

  return {
    ok: true, draftId, mode: MODE_TRACKER,
    status: done ? 'completed' : 'in_progress',
    pick: pickDTO({ ...rec, isUser: isOwnSeat }),
    teamIndex: onClockTeamIndex, isOwnSeat,
    nextOverall: done ? null : state.overallPick,
    nextTeamIndex: done ? null : state.order[state.overallPick - 1],
  };
}

/**
 * Undo the most recent pick. Repeatable — call it five times, go back five picks.
 *
 * TRACKER ONLY. In sim mode the last pick is almost always an engine pick, so
 * "undo" would mean unwinding the opponents' turns and re-running them, which is a
 * different (and much less useful) operation. Refusing here is honest; sim already
 * has abandonDraft for the "start over" case.
 *
 * ONE TRANSACTION, three statements, because they are one fact:
 *   1. delete the highest overall_pick row
 *   2. un-complete the draft if that pick had finished it
 *   3. delete the draft_reads row
 *
 * (3) is the non-obvious one. draft_reads is written ONCE on first results view
 * and never regenerated (migration 048, draft_id UNIQUE), so a Read left behind by
 * an undo would be served forever against a roster that no longer exists. It must
 * die with the pick that produced it, in the same transaction, or a crash between
 * the two leaves a permanently wrong Read.
 *
 * There is no state to rewind: engine state is rebuilt from draft_picks on every
 * request, so deleting the row IS the rewind.
 */
export async function undoLastPickFor(userId, draftId) {
  const draft = (await sql`SELECT id, status, mode FROM drafts WHERE id = ${draftId} AND user_id = ${userId} LIMIT 1`)[0];
  if (!draft) return { ok: false, reason: 'not_found_or_not_owner' };
  if (draft.mode !== MODE_TRACKER) return { ok: false, reason: 'not_tracker' };
  if (draft.status === 'abandoned') return { ok: false, reason: 'not_in_progress' };

  const last = (await sql`SELECT overall_pick, ffc_player_id, player_name, position, picked_by
                            FROM draft_picks WHERE draft_id = ${draftId}
                           ORDER BY overall_pick DESC LIMIT 1`)[0];
  if (!last) return { ok: false, reason: 'no_picks' };

  await sql.transaction([
    sql`DELETE FROM draft_picks WHERE draft_id = ${draftId} AND overall_pick = ${last.overall_pick}`,
    sql`UPDATE drafts SET status = 'in_progress', completed_at = NULL
         WHERE id = ${draftId} AND status = 'completed'`,
    sql`DELETE FROM draft_reads WHERE draft_id = ${draftId}`,
  ]);

  return {
    ok: true, draftId, status: 'in_progress',
    undone: {
      overallPick: last.overall_pick, ffcPlayerId: last.ffc_player_id,
      playerName: last.player_name, position: last.position, pickedBy: last.picked_by,
    },
    nextOverall: last.overall_pick, // the slot just freed is now on the clock
  };
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

// Graded results for a COMPLETED draft. Replays the persisted picks through the
// engine so needWeight (not persisted, and no schema change allowed) is
// reconstructed for the pivot; also yields bye/synthetic/isUser from the engine
// recs. Skill-only (QB/RB/WR/TE) callouts — a defense is never the headline.
export async function getResults(draftId, userId) {
  const dr = await getDraft(draftId, userId);
  if (!dr) return null;
  const { draft, picks } = dr;
  const config = await loadConfig(draft.config_id);
  const pool = await getPoolAt(draft.pool_scoring_format, draft.pool_teams_count, draft.pool_snapshot_date);
  const state = engine.createDraftState(config, pool, draft.pick_position);
  const byId = new Map(state.available.map((p) => [p.ffcPlayerId, p]));
  const userTeamIndex = draft.pick_position - 1;
  for (const row of [...picks].sort((a, b) => a.overall_pick - b.overall_pick)) {
    const player = byId.get(row.ffc_player_id);
    const teamIndex = state.order[row.overall_pick - 1];
    const nw = teamIndex === userTeamIndex ? engine.needWeight(state, state.teams[teamIndex], player) : null;
    engine.applyPick(state, teamIndex, player, row.picked_by, { needWeight: nw });
  }
  const userRecs = state.picks.filter((r) => r.isUser);
  const g = gradeDraft(userRecs, config);
  return {
    draft, config, userTeamIndex,
    userPicks: userRecs.map(pickDTO),
    grade: g.grade, gradeScore: g.gradeScore, components: g.components,
    rosterValueTotal: engine.rosterValueTotal(userRecs.filter((r) => !r.synthetic)),
    positionalBalance: engine.positionalBalance(userRecs),
    bestValue: g.callouts.bestValue ? pickDTO(g.callouts.bestValue) : null,
    biggestReach: g.callouts.biggestReach ? pickDTO(g.callouts.biggestReach) : null,
    pivot: g.callouts.pivot ? { ...pickDTO(g.callouts.pivot), needWeight: g.callouts.pivot.needWeight } : null,
    byeStackWarnings: g.byeStacks,
  };
}

// Mid-draft AUTO toggle. Persists on drafts.is_auto, the ONLY column the schema
// offers for this (there is no config column and no settings JSON on `drafts`),
// so no migration is needed. The flag already meant "this seat is engine-piloted"
// (startDraftFor sets it when the whole draft runs server-side); mid-draft auto is
// the same statement made later, so the semantics carry rather than conflict.
//
// Deliberately does NOT touch the entitlement gate: getDraftsUsed counts
// status IN ('completed','in_progress') and never reads is_auto, so an
// auto-piloted draft keeps consuming its credit exactly like a manual one.
export async function setAutoDraftFor(userId, draftId, on) {
  const r = await sql`UPDATE drafts SET is_auto = ${on === true}
                       WHERE id = ${draftId} AND user_id = ${userId} AND status = 'in_progress'
                      RETURNING id, is_auto`;
  if (!r.length) return { ok: false, reason: 'not_found_or_not_owner' };
  return { ok: true, draftId, isAuto: r[0].is_auto };
}

export async function abandonDraftFor(userId, draftId) {
  const r = await sql`UPDATE drafts SET status = 'abandoned'
                       WHERE id = ${draftId} AND user_id = ${userId} AND status = 'in_progress'
                      RETURNING id`;
  if (!r.length) return { ok: false, reason: 'not_found_or_not_abandonable' };
  return { ok: true, draftId, status: 'abandoned' };
}
