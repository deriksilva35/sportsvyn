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
import { ROOKIE_SEASON } from './movement.js';
import { gradeDraft } from './grade.js';
import { validateConfig, deriveRounds, nearestPoolPair } from './config.js';
import { MODE_TRACKER, normalizeTeamLabels, seatLabel, nextUserOverall, picksUntilUserTurn } from './tracker.js';

/**
 * THE PRACTICE RANGE IS FREE AND UNLIMITED FOR THE 2026 SEASON.
 *
 * This was 3 drafts a week. The wall is gone: every signed-in user drafts as
 * many mocks as they like. The constant survives as 0 = no limit so the account
 * page and the setup console can keep asking the same question and get an
 * honest answer, rather than every call site growing its own conditional.
 *
 * WHY. Measured before the change: 27 people had started a draft, 7 reached the
 * wall, and of the five who were not the owner's own accounts, FOUR NEVER CAME
 * BACK - each ran exactly three drafts in a single day and stopped. A wall that
 * converts nobody and ends four of five sessions is not pricing a product, it
 * is capping the only thing new users do.
 *
 * WHAT MEMBERSHIP STILL PRICES, so this is a reposition and not a giveaway:
 * custom league configs, tracker mode, 14/16-team rooms, and the SUPERFLEX
 * slot. Ranked play was already free by ruling.
 *
 * FREE-FOR-2026 IS THE POSTURE, NOT A PROMISE FOREVER. Revisit with real usage:
 * if unlimited practice turns out to cost real money in ADP calls or to
 * cannibalise the Pass, the honest move is to reprice it before a season
 * starts, not mid-season.
 */
export const FREE_DRAFT_LIMIT = 0;   // 0 = unlimited

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------
export async function getPresets() {
  // THE RANKED FORMAT LEADS THE DECK. "The Weekly Six" is the rehearsal for the
  // game that actually counts, so it sits before the casual shapes rather than
  // last by insertion order - it was added most recently and ORDER BY id put it
  // at the end, which is the opposite of its importance.
  //
  // Ordered by NAME rather than id because the ids differ per database (DEV's
  // row is 1902, PROD's is 20) and a hardcoded id would order one of them
  // wrong. The name is asserted against DRAFT_CONFIG in lib/draft/preset.test.
  return sql`SELECT id, name, teams_count, scoring_format, roster_slots, pick_timer_seconds
               FROM draft_configs WHERE is_preset = true
               ORDER BY (name = 'The Weekly Six') DESC, id`;
}

function mapPoolRow(r) {
  return {
    ffcPlayerId: r.ffc_player_id, name: r.name, position: r.position, team: r.team,
    adp: Number(r.adp), adpHigh: r.adp_high == null ? null : Number(r.adp_high),
    adpLow: r.adp_low == null ? null : Number(r.adp_low), timesDrafted: r.times_drafted,
    stdev: r.stdev == null ? null : Number(r.stdev), bye: r.bye,
    // Display only. Nothing in the engine reads this - see the note on getPoolAt.
    // `=== true` because SQL hands back NULL for both "no match" and "matched but
    // rookie_season is NULL", and both must land as false rather than nullish.
    rookie: r.rookie === true,
  };
}

export async function getLatestPool(scoringFormat, teamsCount) {
  const snap = (await sql`SELECT max(snapshot_date) d FROM sim_player_pool
                           WHERE scoring_format = ${scoringFormat} AND teams_count = ${teamsCount}`)[0];
  if (!snap?.d) return { snapshotDate: null, rows: [] };
  return { snapshotDate: snap.d, rows: await getPoolAt(scoringFormat, teamsCount, snap.d) };
}

// The rookie flag is resolved HERE, on the identity join, so every room surface
// downstream reads the same boolean rather than each one deciding for itself.
//
// LEFT JOIN, and on matched_player_id -> nfl_players.id ONLY. That column is an
// FK to a serial primary key, so the join is strictly many-to-one and cannot
// fan out - which is the whole reason it is safe to hang off a query the engine
// also consumes. A pool row with no match (or a matched player whose
// rookie_season is NULL) yields rookie = false: unknown is not a chip.
export async function getPoolAt(scoringFormat, teamsCount, snapshotDate) {
  const rows = await sql`SELECT p.ffc_player_id, p.name, p.position, p.team, p.adp,
                                p.adp_high, p.adp_low, p.times_drafted, p.stdev, p.bye,
                                (np.rookie_season = ${ROOKIE_SEASON}) AS rookie
                           FROM sim_player_pool p
                           LEFT JOIN nfl_players np ON np.id = p.matched_player_id
                          WHERE p.scoring_format = ${scoringFormat} AND p.teams_count = ${teamsCount}
                            AND p.snapshot_date = ${snapshotDate}
                          ORDER BY p.adp ASC`;
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
  // NO WALL. Still reports `used` because the account page and the setup
  // console display it, and a count of what you have done is worth showing even
  // when nothing is being counted against you. See FREE_DRAFT_LIMIT.
  //
  // THE SIGN-IN GATE REMAINS - it is upstream of this, in the routes. A draft
  // belongs to a user_id; there is nowhere to put an anonymous one.
  const used = await getDraftsUsed(userId);
  return { ok: true, used, limit: FREE_DRAFT_LIMIT };
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

// The user's open tracker draft, if any. Powers the TRACKER tab's resume-or-setup
// behaviour: a live draft is a thing you are IN, so the tab returns you to it
// rather than offering to start another one on top of it.
//
// Newest first, and only one is ever used - a user could in principle have two
// open tracker drafts (nothing forbids it), and resuming the most recent is the
// only defensible guess.
export async function getOpenTrackerDraft(userId) {
  const r = await sql`SELECT id, started_at FROM drafts
                       WHERE user_id = ${userId} AND mode = 'tracker' AND status = 'in_progress'
                       ORDER BY started_at DESC NULLS LAST, id DESC LIMIT 1`;
  return r[0] ?? null;
}

/**
 * The user's open SIM draft, if any. The mirror of getOpenTrackerDraft above,
 * and it should have existed at the same time.
 *
 * WHY IT WAS MISSING AND WHAT THAT COST. The lobby ran three reads - presets,
 * drafts-used, membership - and none of them asked whether the user was already
 * in a draft. A returning player with a half-finished room saw the preset deck
 * with a "Start a mock draft" kicker, as though nothing existed. The only way
 * back was the HISTORY tab, where the row sits among finished drafts labelled
 * "In progress", which is a place you have to already know to look.
 *
 * It also costs a free credit while it sits there: getDraftsUsed counts
 * status IN ('completed','in_progress'), so an abandoned room has already spent
 * one of three. Invisible AND billed is the worst pair.
 *
 * Newest first, and only one is ever surfaced - nothing forbids two open sim
 * drafts, and resuming the most recent is the only defensible guess. Carries
 * the pick count and config name so the card can say where you are without a
 * second query.
 */
export async function getOpenSimDraft(userId) {
  if (userId == null) return null;
  const r = await sql`
    SELECT d.id, d.started_at, d.pick_position,
           c.name AS config_name, c.teams_count, c.scoring_format, c.roster_slots,
           (SELECT count(*)::int FROM draft_picks p WHERE p.draft_id = d.id) AS pick_count,
           (SELECT count(*)::int FROM draft_picks p WHERE p.draft_id = d.id AND p.picked_by = 'user') AS own_picks
      FROM drafts d
      LEFT JOIN draft_configs c ON c.id = d.config_id
     WHERE d.user_id = ${userId} AND d.mode = 'sim' AND d.status = 'in_progress'
     ORDER BY d.started_at DESC NULLS LAST, d.id DESC
     LIMIT 1`;
  return r[0] ?? null;
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

  // RANKED BYPASSES BOTH GATES, and the reason is what the gates are for. The
  // 3-free limit and the members-only console price the PRACTICE RANGE: an
  // unlimited sandbox of any league shape you like. A ranked week is one draft,
  // on one fixed config nobody chose, that counts toward a public standing -
  // charging for it would make the season leaderboard a paid table, which is
  // not what the membership sells. The config is still validated above and the
  // one-per-week limit is enforced by contest_entries, not by these counters.
  if (!opts.ranked) {
    const member = await isMember(userId);
    if (!member) return { ok: false, reason: 'entitlement_custom' };
    const gate = await canStartDraft(userId, member); // members bypass the 3-free gate
    if (!gate.ok) return { ok: false, reason: 'entitlement', used: gate.used, limit: gate.limit };
  }

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

  // RANKED ROOMS BRIDGE THEIR ROSTER THE MOMENT THEY FINISH, so a player learns
  // straight away whether theirs can field a legal six rather than discovering
  // it on Tuesday. CAUGHT AND IGNORED on purpose: the draft is already
  // committed above, and a failure here must not turn a completed draft into an
  // error the player sees. Settlement re-runs this idempotently as the
  // self-heal - see bridgeContestRosters.
  if (done) await afterRankedComplete(draftId).catch(() => null);

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
      // Picks made BEFORE this page load: resolved from the pool row the pick
      // points at. Picks made DURING the session come back through the engine,
      // which does not carry the flag, so the rooms restore those from their own
      // rookie-id set - see the note in each room.
      rookie: pl?.rookie === true,
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
  // humanPick: the K/DST round floor is an AI-realism rule and must not bind a
  // person choosing their own roster. See canRoster.
  if (!engine.canRoster(state, state.teams[userTeamIndex], player, round, null, { humanPick: true })) {
    return { ok: false, reason: 'illegal_pick' };
  }
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
  // humanPick: in tracker mode every seat is a real person at a real table, so
  // the engine's K/DST floor must never refuse to RECORD a pick that happened.
  if (!engine.canRoster(state, state.teams[onClockTeamIndex], player, round, null, { humanPick: true })) {
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

/**
 * Results for a COMPLETED TRACKER draft: the VALUE LEDGER, no letter grade.
 *
 * NO GRADE, deliberately and structurally. grade.js's bands are calibrated on 300
 * seeded MOCK auto-drafts ("median auto-draft lands B-/C+, A at most 5%"). A real
 * draft room is a different population, so putting that letter on a tracker draft
 * would extend a calibrated claim to data it was never calibrated against. This
 * function never imports gradeDraft.
 *
 * What it does return is engine.gradeRoster — which despite the name computes no
 * grade at all: per-pick value, the roster total, positional balance, the best
 * value / biggest reach / pivot callouts, and bye stacks. That is the ledger, and
 * every number in it is an arithmetic fact about pick number vs frozen ADP.
 */
export async function getTrackerResults(draftId, userId) {
  const dr = await getDraft(draftId, userId);
  if (!dr) return null;
  const { draft, picks } = dr;
  if ((draft.mode ?? 'sim') !== MODE_TRACKER) return null;

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
  const ledger = engine.gradeRoster(userRecs); // NB: computes no grade, only the ledger
  if (!ledger) return null;

  return {
    draft, config, userTeamIndex,
    teamLabels: draft.team_labels ?? null,
    userPicks: userRecs.map(pickDTO),
    rosterValueTotal: ledger.rosterValueTotal,
    positionalBalance: ledger.positionalBalance,
    bestValue: ledger.bestValue ? pickDTO(ledger.bestValue) : null,
    biggestReach: ledger.biggestReach ? pickDTO(ledger.biggestReach) : null,
    pivot: ledger.pivot ? { ...pickDTO(ledger.pivot), needWeight: ledger.pivot.needWeight } : null,
    byeStackWarnings: ledger.byeStackWarnings,
    pickCount: picks.length,
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

/**
 * If this draft owns a ranked contest entry, store its bridged roster.
 *
 * IMPORTED LAZILY. lib/draft/entry.js imports lib/draft/contest.js, which
 * imports the weekly pool and the gridiron ingest boundary; pulling that whole
 * graph into drafts.js at module load would drag it into every sim page that
 * has nothing to do with ranked play.
 */
async function afterRankedComplete(draftId) {
  const e = (await sql`
    SELECT id, user_id FROM contest_entries
     WHERE (meta->>'draftId')::int = ${draftId} LIMIT 1`)[0];
  if (!e) return null;
  const { bridgeRoster, storeRoster } = await import('../draft/entry.js');
  const r = await bridgeRoster(draftId, Number(e.user_id));
  if (!r.ok) return null;
  return storeRoster(e.id, r);
}

/**
 * Where a tracked draft has got to, for the resume card.
 *
 * DERIVED FROM THE PICK COUNT, not stored. The room derives round and pick the
 * same way, so a stored copy would be a second source of truth that could
 * disagree with the board the user is looking at.
 */
export async function trackerResumeCard(draftId) {
  const r = (await sql`
    SELECT d.id, c.teams_count,
           (SELECT count(*)::int FROM draft_picks p WHERE p.draft_id = d.id) AS picks
      FROM drafts d LEFT JOIN draft_configs c ON c.id = d.config_id
     WHERE d.id = ${draftId}`)[0];
  if (!r) return null;
  const teams = Number(r.teams_count) || 12;
  const picks = Number(r.picks) || 0;
  // The NEXT pick is the one the room is waiting on, so count from picks+1.
  const next = picks + 1;
  return {
    id: r.id,
    picks,
    round: Math.ceil(next / teams),
    pickInRound: ((next - 1) % teams) + 1,
  };
}

/**
 * Fill an abandoned draft's remaining picks with the engine's best-available.
 *
 * ============================================================================
 * START IS CONSUMED PROTECTS THE ENTRY'S REALITY, NOT ITS PUNISHMENT.
 * ============================================================================
 * Opening a ranked room spends the week's entry, so an abandoned room cannot
 * become a second attempt. That rule exists to stop a free look at the board -
 * it was never meant to void what somebody actually drafted. Picks made COUNT;
 * picks unmade FILL MECHANICALLY; and abandonment stays strictly dominated by
 * playing, because best-available-by-ADP is exactly the pick a disengaged
 * player would have made and never better than an engaged one.
 *
 * DNF IS NO LONGER A PLAYER OUTCOME. It survives only for a canFieldSix failure
 * at lock, which the config makes unreachable - eight picks deal 1 QB and 7
 * flex-eligible against a requirement of 1 and 5 (asserted in
 * lib/fantasy/smallConfig.test.mjs). So DNF is now a CONFIG-CHANGE TRIPWIRE: if
 * it ever fires, the ranked shape has been changed to something unfieldable.
 *
 * THE SAME PICKER THE AI SEATS USE, and no more than that. engine.autoPick is
 * deterministic best-available filtered by canRoster - legality only, no
 * need-optimisation. Auto-completing with a SMARTER picker than the room
 * offers would reward walking away, which inverts the whole point.
 *
 * IDEMPOTENT: a completed draft returns immediately, so a re-run at settle
 * cannot double-pick.
 */
export async function autoCompleteDraftFor(draftId) {
  const draft = (await sql`SELECT * FROM drafts WHERE id = ${draftId} LIMIT 1`)[0];
  if (!draft) return { ok: false, reason: 'not_found' };
  if (draft.status !== 'in_progress') return { ok: true, completed: false, reason: draft.status };

  const config = await loadConfig(draft.config_id);
  const pool = await getPoolAt(draft.pool_scoring_format, draft.pool_teams_count, draft.pool_snapshot_date);
  const pickRows = await sql`SELECT * FROM draft_picks WHERE draft_id = ${draftId} ORDER BY overall_pick ASC`;
  const state = rebuildState(config, pool, draft.pick_position, pickRows);
  const userTeamIndex = draft.pick_position - 1;
  const total = state.rounds * state.teamsCount;

  const made = [];
  let userPicks = 0;
  while (state.overallPick <= total) {
    const seat = state.order[state.overallPick - 1];
    // The user's seat gets autoPick (deterministic BPA); every other seat gets
    // the same seeded aiPick the room would have run, so a replay of this draft
    // produces the same board.
    const rec = seat === userTeamIndex
      ? engine.autoPick(state, seat)
      : engine.aiPick(state, seat, engine.makeRng(draftId * 7919 + state.overallPick));
    if (!rec) return { ok: false, reason: 'no_legal_pick', atOverall: state.overallPick };
    if (seat === userTeamIndex) {
      // THE SEAT'S PICKS BELONG TO THE SEAT, whoever's hand made them.
      // engine.autoPick commits as 'ai' because that is what it is inside the
      // engine, and lib/draft/entry.js bridgeRoster reads WHERE picked_by =
      // 'user' - so leaving the tag alone silently dropped every auto-filled
      // pick from the roster. The entry would have bridged five of eight and
      // settled as a DNF, which is the exact outcome this feature exists to
      // prevent. Caught by the replay case, not by reading.
      //
      // 'auto' is not an option: the column's CHECK allows user | ai | logged,
      // and a migration to widen it would buy provenance the entry records
      // anyway - bridgeContestRosters stamps autoFilled on the entry meta.
      rec.pickedBy = 'user';
      userPicks += 1;
    }
    made.push(rec);
  }

  if (made.length) {
    await sql.transaction([
      ...made.map((r) => pickInsert(draftId, r)),
      sql`UPDATE drafts SET status = 'completed', completed_at = now() WHERE id = ${draftId}`,
    ]);
  } else {
    await sql`UPDATE drafts SET status = 'completed', completed_at = now() WHERE id = ${draftId}`;
  }
  return { ok: true, completed: true, filled: made.length, userPicksFilled: userPicks };
}
