// lib/fantasy/engine.js — the mock-draft AI engine. PURE functions: no AI-API
// calls, no DB access, no I/O. Everything in = arguments; everything out = return
// values. Deterministic under an injected seeded RNG (makeRng). The caller loads
// pool rows (DEV sim_player_pool) and passes them in; the engine never reads them.
//
// ============================================================================
// THE PICK MODEL (transcribe to /methodology)
// ============================================================================
// At each pick the drafting team scores a CANDIDATE set (top CANDIDATE_N=15
// available by ADP, after hard sanity floors) and samples one:
//
//   valueScore_i = currentOverallPick - adp_i
//       (positive = the player has FALLEN past his ADP to you -> attracts;
//        negative = drafting him now is a REACH -> repels)
//
//   needWeight_i = starterSlotsForPos > 0
//                    ? 1 + NEED_K * starterSlotsForPos * fillPressure
//                    : 1.0            (bench-eligible, starters covered -> neutral)
//     fillPressure = clamp(openStarterSlots / picksRemaining, 0, 2)
//                    (urgency rises as open starting slots approach picks left)
//     starterSlotsForPos = open dedicated slots for the position
//                          + open FLEX slots if the position is FLEX-eligible
//     RUN DETECTION: if >= RUN_THRESHOLD(4) of the last RUN_WINDOW(6) overall
//     picks share a position, needWeight for that position is multiplied by
//     RUN_MULT(1.5) for ALL teams (drafts panic together).
//
//   logit_i = (valueScore_i * needWeight_i) / T_i
//   T_i = max(TEMP_MIN, TEMP_BASE * stdev_i / medianStdev)   (NULL stdev -> median)
//     Per-candidate temperature scaled by the player's REAL ADP stdev (measured
//     market disagreement, migration 047). Low-stdev (consensus) -> small T ->
//     logit dominated by value -> picked near ADP. High-stdev (polarizing) ->
//     large T -> flatter -> genuinely reached for AND slid past. The variance is
//     a STATED PRINCIPLE (real market spread), never a tuned magic knob.
//
//   P(pick i) = softmax over logits, sampled with the injected rng.
//
// autoPick (timer expiry) skips the sampling: deterministic best-available ADP
// that satisfies the same hard floors.
// ============================================================================

// ---- tunables (documented above; single source) ----
export const PARAMS = {
  CANDIDATE_N: 15,
  NEED_K: 0.8,
  TEMP_BASE: 8,
  TEMP_MIN: 2.5,
  RUN_WINDOW: 6,
  RUN_THRESHOLD: 4,
  RUN_MULT: 1.5,
  K_DST_MIN_ROUND: 13,
};

const FLEX_ELIGIBLE = new Set(['RB', 'WR', 'TE']);
// FFC position vocab -> roster slot vocab.
const POS_TO_SLOT = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', PK: 'K', DEF: 'DST' };
function slotPos(position) { return POS_TO_SLOT[position] ?? position; }
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// FFC's ADP feed lists FEWER kickers/defenses than a full league needs (it ranks
// only the most-drafted K/DST), so with rigid K:1/DST:1 slots some teams could
// not complete a legal roster. Backfill replacement-level fillers at these scarce
// mandatory positions up to (cap * teams_count), with an ADP strictly worse than
// every real player so they are drafted only when forced. Flagged `synthetic` and
// excluded from value grading. Pure (data in -> data out). The future pool-reader
// may instead pull the full kicker/DST universe and drop this.
const SCARCE = { K: 'PK', DST: 'DEF' };
export function ensureFillablePool(pool, config) {
  const N = config.teams_count;
  const maxAdp = pool.reduce((m, p) => Math.max(m, Number(p.adp) || 0), 0);
  const counts = {};
  for (const p of pool) { const sp = slotPos(p.position); counts[sp] = (counts[sp] ?? 0) + 1; }
  const padded = pool.slice();
  let syn = 0;
  for (const [slotType, ffcPos] of Object.entries(SCARCE)) {
    const need = (config.roster_slots[slotType] ?? 0) * N;
    for (let i = counts[slotType] ?? 0; i < need; i++) {
      syn += 1;
      padded.push({
        ffcPlayerId: `syn-${slotType}-${i}`, name: `Replacement ${slotType} ${syn}`,
        position: ffcPos, team: null, adp: maxAdp + 50 + syn, stdev: null, bye: null, synthetic: true,
      });
    }
  }
  return padded;
}

// ---- seeded RNG (mulberry32) — deterministic, injectable ----
export function makeRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function median(nums) {
  const a = nums.filter((n) => n != null).slice().sort((x, y) => x - y);
  if (a.length === 0) return 1;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// ---------------------------------------------------------------------------
// createDraftState
// ---------------------------------------------------------------------------
export function createDraftState(config, poolRows, userPickPosition) {
  const teamsCount = config.teams_count;
  const slots = config.roster_slots;
  const rounds = Object.values(slots).reduce((a, b) => a + b, 0);

  // snake order: overall pick -> teamIndex (0-based). odd rounds L->R, even R->L.
  const order = [];
  for (let r = 1; r <= rounds; r++) {
    const row = [];
    for (let t = 0; t < teamsCount; t++) row.push(t);
    if (r % 2 === 0) row.reverse();
    order.push(...row);
  }

  const teams = [];
  for (let i = 0; i < teamsCount; i++) {
    const teamSlots = {};
    for (const [k, cap] of Object.entries(slots)) teamSlots[k] = { cap, filled: 0 };
    teams.push({
      index: i,
      isUser: userPickPosition != null && i === userPickPosition - 1,
      picks: [],
      slots: teamSlots,
      posCount: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 },
    });
  }

  const fillable = ensureFillablePool(poolRows, config);
  const available = fillable.slice().sort((a, b) => Number(a.adp) - Number(b.adp));
  return {
    config, rounds, teamsCount, userPickPosition,
    order, teams, available,
    picks: [],
    overallPick: 1,
    medianStdev: median(fillable.map((p) => (p.stdev == null ? null : Number(p.stdev)))),
    qbCap: (slots.QB ?? 0) >= 2 ? 3 : 2,
  };
}

// ---- roster slot helpers ----
const openDed = (team, p) => (team.slots[p] ? team.slots[p].cap - team.slots[p].filled : 0);
const openFlex = (team) => (team.slots.FLEX ? team.slots.FLEX.cap - team.slots.FLEX.filled : 0);
const openBN = (team) => (team.slots.BN ? team.slots.BN.cap - team.slots.BN.filled : 0);
const STARTER_POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
function openStarterSlots(team) {
  let n = 0;
  for (const p of STARTER_POS) n += openDed(team, p);
  n += openFlex(team);
  return n;
}
function openNonKDST(team) {
  let n = openFlex(team) + openBN(team);
  for (const p of ['QB', 'RB', 'WR', 'TE']) n += openDed(team, p);
  return n;
}

// Per-pick context: remaining supply by slotPos + how many teams still need each
// position as a dedicated starter. Feeds the scarcity floor.
function computeCtx(state) {
  const availByPos = {};
  for (const p of state.available) { const sp = slotPos(p.position); availByPos[sp] = (availByPos[sp] ?? 0) + 1; }
  // Total OPEN dedicated starter SLOTS per position across the league (not teams —
  // a 2QB team with 0 QBs contributes 2, so the reservation is per-slot correct).
  const starterSlotsNeededByPos = {};
  for (const t of state.teams) for (const sp of STARTER_POS) starterSlotsNeededByPos[sp] = (starterSlotsNeededByPos[sp] ?? 0) + openDed(t, sp);
  return { availByPos, starterSlotsNeededByPos };
}

// Hard sanity floors. round is 1-based. ctx (optional) enables the scarcity floor.
export function canRoster(state, team, player, round, ctx = null) {
  const p = slotPos(player.position);
  const dedOpen = openDed(team, p);
  const flexOpen = FLEX_ELIGIBLE.has(p) ? openFlex(team) : 0;
  const bnOpen = openBN(team);
  // (d) position can fill NO remaining slot
  if (dedOpen + flexOpen + bnOpen === 0) return false;
  // (b) never a 2nd K / 2nd DST
  if ((p === 'K' || p === 'DST') && team.posCount[p] >= 1) return false;
  // (c) QB cap (no 3rd QB in 1QB; no 4th QB in 2QB)
  if (p === 'QB' && team.posCount.QB >= state.qbCap) return false;
  // (a) no K/DST before K_DST_MIN_ROUND unless only K/DST slots remain
  if ((p === 'K' || p === 'DST') && round < PARAMS.K_DST_MIN_ROUND && openNonKDST(team) > 0) return false;
  // (e) SCARCITY: a PURE BENCH add (does not fill one of this team's open starter
  //     slots) is barred while remaining supply of that position <= the number of
  //     OTHER teams still needing it as a starter. Stops one team hoarding a
  //     scarce position (e.g. TE) to its bench and starving others. Relaxed by
  //     the fallback in legalCandidates if it would leave no legal move.
  if (ctx) {
    const fillsStarter = dedOpen > 0 || flexOpen > 0;
    if (!fillsStarter) {
      const avail = ctx.availByPos[p] ?? 0;
      const need = ctx.starterSlotsNeededByPos[p] ?? 0;
      if (avail <= need) return false;
    }
  }
  return true;
}

function assignToSlot(team, player) {
  const p = slotPos(player.position);
  team.posCount[p] = (team.posCount[p] ?? 0) + 1;
  if (team.slots[p] && team.slots[p].filled < team.slots[p].cap) { team.slots[p].filled++; return p; }
  if (FLEX_ELIGIBLE.has(p) && team.slots.FLEX && team.slots.FLEX.filled < team.slots.FLEX.cap) { team.slots.FLEX.filled++; return 'FLEX'; }
  team.slots.BN.filled++; return 'BN';
}

function runActive(state, p) {
  const last = state.picks.slice(-PARAMS.RUN_WINDOW);
  const c = last.filter((pk) => pk.slotPos === p).length;
  return c >= PARAMS.RUN_THRESHOLD;
}

export function needWeight(state, team, player) {
  const p = slotPos(player.position);
  const picksRemaining = state.rounds - team.picks.length;
  const fillPressure = clamp(openStarterSlots(team) / Math.max(1, picksRemaining), 0, 2);
  const starterSlotsForP = openDed(team, p) + (FLEX_ELIGIBLE.has(p) ? openFlex(team) : 0);
  let w = starterSlotsForP > 0 ? 1 + PARAMS.NEED_K * starterSlotsForP * fillPressure : 1.0;
  if (runActive(state, p)) w *= PARAMS.RUN_MULT;
  return w;
}

function legalCandidates(state, team, round) {
  const ctx = computeCtx(state);
  const collect = (useCtx) => {
    const out = [];
    for (const pl of state.available) {
      if (canRoster(state, team, pl, round, useCtx)) { out.push(pl); if (out.length >= PARAMS.CANDIDATE_N) break; }
    }
    return out;
  };
  // Scarcity floor on first; if it would leave no legal move, relax it (hard
  // floors a-d only) so a legal pick always exists when any player is placeable.
  const withScarcity = collect(ctx);
  return withScarcity.length > 0 ? withScarcity : collect(null);
}

function commit(state, team, player, pickedBy, extra = {}) {
  const round = Math.ceil(state.overallPick / state.teamsCount);
  const rosterSlot = assignToSlot(team, player);
  const rec = {
    round,
    overallPick: state.overallPick,
    teamIndex: team.index,
    isUser: team.isUser,
    ffcPlayerId: player.ffcPlayerId,
    playerName: player.name,
    position: player.position,
    slotPos: slotPos(player.position),
    rosterSlot,
    team: player.team ?? null,
    bye: player.bye ?? null,
    adpAtPick: Number(player.adp),
    pickedBy,
    needWeight: extra.needWeight ?? null,
    synthetic: player.synthetic === true,
  };
  team.picks.push(rec);
  state.picks.push(rec);
  const idx = state.available.indexOf(player);
  if (idx >= 0) state.available.splice(idx, 1);
  state.overallPick += 1;
  return rec;
}

// ---------------------------------------------------------------------------
// aiPick — the sampled core
// ---------------------------------------------------------------------------
export function aiPick(state, teamIndex, rng) {
  const team = state.teams[teamIndex];
  const round = Math.ceil(state.overallPick / state.teamsCount);
  const cands = legalCandidates(state, team, round);
  if (cands.length === 0) return null; // no legal player (should not happen)
  if (cands.length === 1) return commit(state, team, cands[0], 'ai', { needWeight: needWeight(state, team, cands[0]) });

  const scored = cands.map((c) => {
    const nw = needWeight(state, team, c);
    const value = state.overallPick - Number(c.adp);
    const stdev = c.stdev == null ? state.medianStdev : Number(c.stdev);
    const T = Math.max(PARAMS.TEMP_MIN, PARAMS.TEMP_BASE * (stdev / (state.medianStdev || 1)));
    return { c, nw, logit: (value * nw) / T };
  });
  // softmax (subtract max for stability) then sample with rng
  const maxL = Math.max(...scored.map((s) => s.logit));
  let total = 0;
  for (const s of scored) { s.w = Math.exp(s.logit - maxL); total += s.w; }
  let draw = rng() * total;
  let chosen = scored[scored.length - 1];
  for (const s of scored) { draw -= s.w; if (draw <= 0) { chosen = s; break; } }
  return commit(state, team, chosen.c, 'ai', { needWeight: chosen.nw });
}

// ---------------------------------------------------------------------------
// autoPick — deterministic timer-expiry pick (best available ADP, floors only)
// ---------------------------------------------------------------------------
export function autoPick(state, teamIndex) {
  const team = state.teams[teamIndex];
  const round = Math.ceil(state.overallPick / state.teamsCount);
  const cands = legalCandidates(state, team, round);
  if (cands.length === 0) return null;
  return commit(state, team, cands[0], 'ai', { needWeight: needWeight(state, team, cands[0]) });
}

// ---------------------------------------------------------------------------
// applyPick — commit a SPECIFIC chosen player as team's pick. The counterpart to
// aiPick/autoPick, used by the server layer to (a) replay a persisted pick list
// back into engine state and (b) commit a human's chosen player. Pure. Legality
// is the caller's responsibility (validate via canRoster first). Returns the
// pick record, or null if the player is not in the available set.
// ---------------------------------------------------------------------------
export function applyPick(state, teamIndex, player, pickedBy = 'user', extra = {}) {
  if (!state.available.includes(player)) return null;
  return commit(state, state.teams[teamIndex], player, pickedBy, extra);
}

// ---------------------------------------------------------------------------
// runFullDraft — full simulation (all seats AI in auto mode)
// ---------------------------------------------------------------------------
export function runFullDraft(config, pool, userPickPosition, opts, rng) {
  const state = createDraftState(config, pool, userPickPosition);
  const totalPicks = state.rounds * state.teamsCount;
  for (let k = 0; k < totalPicks; k++) {
    const teamIndex = state.order[k];
    const rec = aiPick(state, teamIndex, rng);
    if (!rec) throw new Error(`runFullDraft: no legal pick at overall ${state.overallPick} (team ${teamIndex})`);
  }
  return { picks: state.picks, teams: state.teams, state };
}

// ===========================================================================
// Grading primitives (the Read consumes these next session — math only)
// ===========================================================================
// perPickValue = adp_at_pick - overall_pick.
//   NEGATIVE = value (the player fell past his ADP to this slot);
//   POSITIVE = reach (drafted earlier than ADP). So bestValue = min, reach = max.
export function perPickValue(pick) { return pick.adpAtPick - pick.overallPick; }
export function rosterValueTotal(picks) { return picks.reduce((a, p) => a + perPickValue(p), 0); }

export function positionalBalance(picks) {
  const bal = {};
  for (const p of picks) bal[p.slotPos] = (bal[p.slotPos] ?? 0) + 1;
  return bal;
}

export function byeStackWarnings(picks) {
  const byBye = {};
  for (const p of picks) {
    if (p.rosterSlot === 'BN' || p.bye == null) continue; // starters only
    (byBye[p.bye] ??= []).push(p.playerName);
  }
  return Object.entries(byBye)
    .filter(([, names]) => names.length >= 3)
    .map(([bye, names]) => ({ bye: Number(bye), count: names.length, players: names }));
}

// Grade one team's roster. bestValue/biggestReach are picks; pivot = the pick
// with the largest need-weight the engine assigned (the most need-driven, i.e.
// the roster's biggest need swing).
export function gradeRoster(picks) {
  if (picks.length === 0) return null;
  // Value grading ignores synthetic replacement K/DST (they are not real market
  // events); positional balance counts them (the roster slot is genuinely filled).
  const real = picks.filter((p) => !p.synthetic);
  const withPPV = real.map((p) => ({ ...p, ppv: perPickValue(p) }));
  const bestValue = withPPV.reduce((a, b) => (b.ppv < a.ppv ? b : a));
  const biggestReach = withPPV.reduce((a, b) => (b.ppv > a.ppv ? b : a));
  const rated = real.filter((p) => p.needWeight != null);
  const pivot = rated.length ? rated.reduce((a, b) => (b.needWeight > a.needWeight ? b : a)) : null;
  return {
    picks,
    rosterValueTotal: rosterValueTotal(real),
    positionalBalance: positionalBalance(picks),
    bestValue, biggestReach, pivot,
    byeStackWarnings: byeStackWarnings(picks),
  };
}

export const _internals = { slotPos, canRoster, needWeight, assignToSlot, openStarterSlots };
