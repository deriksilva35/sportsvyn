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
//   POOLS WITHOUT STDEV (tempMode 'adp'). Fantrax's ADP feed carries no spread
//     (getAdp: ADP_PPR/ADP only; every sim_player_pool row with source
//     'fantrax' has stdev NULL). Until 2 Sep 2026 such a pool fell through
//     median([]) -> 1 and stdev NULL -> medianStdev, so EVERY candidate drew
//     T = TEMP_BASE = 8 flat - the engine's maximum-disagreement setting applied
//     to Bijan Robinson at 1.3 (44% to go, vs 92% under FFC's real stdev), and a
//     10th-available reach (Barkley, ADP 15.1) fired at 0.8% twice in six picks
//     across two rooms. The fix is a DERIVATION, not a new knob: in every FFC
//     pool the spread is proportional to ADP - stdev/adp sits at 0.113-0.119 in
//     all four FFC shapes on the 2026-09-01 snapshot - so
//         TEMP_BASE * stdev_i / medianStdev  ==  TEMP_BASE * adp_i / medianAdp
//     with the proportionality constant cancelled. A pool that has no stdev is
//     therefore drafted at
//   T_i = max(TEMP_MIN, TEMP_BASE * adp_i / ADP_REF)
//     where ADP_REF stands in for medianAdp of an FFC pool of the same shape:
//     106-130 across FFC's four shapes (standard/8 106, half-ppr/10 110,
//     2qb/12 120, ppr/12 130) - FFC's pool DEPTH, a provider fact, which is why
//     the sourceless pool's own median ADP (Fantrax publishes 417 rows, median
//     274) is the wrong normaliser. ADP_REF = 120, the middle of that range;
//     band-by-band the proxy reproduces FFC's real median T within ~15%
//     (ppr/12: ADP 49-96 real 5.21 vs 4.6; 97-150 real 8.56 vs 8.0; 151+ real
//     11.41 vs 10.0; the floor binds through ADP ~37 in both). No invented
//     data: the input is the pool's own ADP and one measured ratio.
//     tempMode is 'stdev' when at least half the fillable pool carries stdev
//     (NULL rows take the median, as before) and 'adp' otherwise. There is no
//     third path and no default of 1: a 'stdev' pool with no median throws.
//
//   P(pick i) = softmax over logits, sampled with the injected rng.
//
// autoPick (timer expiry) skips the sampling: deterministic best-available ADP
// that satisfies the same hard floors.
// ============================================================================

// THE ONE IMPORT this otherwise self-contained module carries: the singleton
// set is defined in config.js (one place, with its rationale) and the floors
// must read the same definition the tracker's panels do.
import { SINGLETON_POSITIONS } from './config.js';

// ---- tunables (documented above; single source) ----
export const PARAMS = {
  CANDIDATE_N: 15,
  NEED_K: 0.8,
  TEMP_BASE: 8,
  TEMP_MIN: 2.5,
  // The medianAdp of an FFC pool, for pools that carry no stdev (see THE PICK
  // MODEL: "POOLS WITHOUT STDEV"). Measured, not tuned: 106-130 across FFC's
  // four shapes on 2026-09-01, so 120. Re-measure if FFC changes its cutoff.
  ADP_REF: 120,
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

// NULL on an empty list. It used to return 1, and that 1 was the silent default
// that put every Fantrax room at maximum temperature (see the pick model).
function median(nums) {
  const a = nums.filter((n) => n != null).slice().sort((x, y) => x - y);
  if (a.length === 0) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// ---------------------------------------------------------------------------
// createDraftState
// ---------------------------------------------------------------------------
/**
 * @param keepers OPTIONAL Map of overallPick -> { ffcPlayerId, playerName, position, adp?, team? }.
 *
 * KEEPERS ARE NOT A PREFIX. A Fantrax league's made picks sit at scattered grid
 * positions - round 1 pick 10, round 13 pick 2 - and applying them up front
 * with applyPick numbered them 1..41 instead, because commit() takes its
 * overall from state.overallPick and increments it. Seats were then computed
 * from the real overall while the RECORD carried a made-up one, so teams ended
 * up with uneven pick counts and the draft died with "no legal pick at overall
 * 193". Measured, not reasoned about.
 *
 * So the keepers ride ON the state and the draft walks the grid in order,
 * taking the keeper when one occupies the current pick. commit() stays the only
 * thing that advances overallPick, which is what keeps the seats honest.
 */
export function createDraftState(config, poolRows, userPickPosition, keepers = null) {
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
  let available = fillable.slice().sort((a, b) => Number(a.adp) - Number(b.adp));

  // KEPT PLAYERS ARE HELD OUT OF THE POOL FROM PICK ONE. The first run of this
  // left them in `available` until their owed overall, and Chase Brown - kept
  // at overall 12 - went to an AI at overall 4, because by ADP he is a fourth
  // pick. A keeper is not on the board at any pick before his own; he is on a
  // shelf, and takeKeeper is the only thing that reaches it.
  //
  // THE SHELF IS BUILT FROM THE KEEPER RECORD, NOT LOOKED UP IN THE POOL. The
  // pool is the draftable universe, and an imported league's pool excludes every
  // player the league already holds - which is every keeper. So the record
  // carries what a pick needs (name, position, adp, team) and the pool row, when
  // one exists, only adds what the record lacks. The first run of this threw
  // when the pool lacked the keeper; that was right while the pool still listed
  // him and wrong the moment it stopped, because the throw fired on every
  // imported league. What still fails at creation: a record with no name or no
  // position, which is a keeper nobody could read on a board - skipping him
  // would hand that seat an extra pick and leave the league one player short.
  const held = new Map();
  if (keepers?.size) {
    const byId = new Map(available.map((pl) => [pl.ffcPlayerId, pl]));
    for (const [overall, k] of keepers) {
      if (!k.playerName || !k.position) {
        throw new Error(`keeper ${k.ffcPlayerId} at overall ${overall} has no name or position`);
      }
      const pl = byId.get(k.ffcPlayerId) ?? null;
      held.set(k.ffcPlayerId, {
        ffcPlayerId: k.ffcPlayerId,
        name: k.playerName,
        position: k.position,
        team: k.team ?? pl?.team ?? null,
        bye: pl?.bye ?? null,
        adp: k.adp ?? pl?.adp ?? null,
        stdev: pl?.stdev ?? null,
      });
    }
    available = available.filter((pl) => !held.has(pl.ffcPlayerId));
  }
  // Temperature source, decided ONCE per draft from the pool's own rows and
  // carried on the state so every pick of the room draws T the same way.
  const stdevs = fillable.map((p) => (p.stdev == null ? null : Number(p.stdev)));
  const withStdev = stdevs.filter((x) => x != null).length;
  const tempMode = fillable.length > 0 && withStdev * 2 >= fillable.length ? 'stdev' : 'adp';
  const medianStdev = tempMode === 'stdev' ? median(stdevs) : null;
  if (tempMode === 'stdev' && !(medianStdev > 0)) {
    throw new Error(`createDraftState: stdev pool with no usable median (${withStdev}/${fillable.length} rows, median ${medianStdev})`);
  }
  return {
    config, rounds, teamsCount, userPickPosition,
    order, teams, available,
    keepers: keepers ?? null,
    held,
    picks: [],
    overallPick: 1,
    tempMode,
    medianStdev,
    qbCap: (slots.QB ?? 0) >= 2 ? 3 : 2,
  };
}

// T_i for one candidate under the state's temperature source (the pick model,
// above). Exported so the tests pin the table per source and a probe can print
// the room's temperatures without re-deriving them.
export function temperature(state, c) {
  if (state.tempMode === 'stdev') {
    if (!(state.medianStdev > 0)) throw new Error('temperature: stdev pool without a median');
    const stdev = c.stdev == null ? state.medianStdev : Number(c.stdev);
    return Math.max(PARAMS.TEMP_MIN, PARAMS.TEMP_BASE * (stdev / state.medianStdev));
  }
  if (state.tempMode === 'adp') {
    return Math.max(PARAMS.TEMP_MIN, PARAMS.TEMP_BASE * (Number(c.adp) / PARAMS.ADP_REF));
  }
  throw new Error(`temperature: unknown tempMode ${state.tempMode}`);
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
// ---- PURE READ HELPERS FOR NON-DRAFTING SURFACES ----
//
// The "My Team" sort needs the engine's own roster arithmetic for the HUMAN
// seat, which never runs through createDraftState in the room (the client has
// picks, not engine state). These two exports exist so that surface can reuse
// the slot vocabulary instead of reimplementing it - a second copy of "is this
// position full" is a second copy that drifts.
//
// NOTHING IN THE DRAFT PATH CALLS THEM. No existing function is modified, and
// neither of these can be reached from aiPick, canRoster, needWeight or commit,
// so AI behaviour is unchanged by construction.

/**
 * A `team`-shaped object for one seat, rebuilt from that seat's persisted picks.
 *
 * slots.filled is COUNTED FROM pick.rosterSlot rather than re-derived: the
 * engine already made that assignment at pick time via assignToSlot and it was
 * persisted to draft_picks.roster_slot. Recomputing it here would be a second
 * assignment implementation, and the two would eventually disagree.
 */
export function seatTeamFromPicks(rosterSlots, seatPicks) {
  const slots = {};
  for (const [k, cap] of Object.entries(rosterSlots ?? {})) slots[k] = { cap, filled: 0 };
  const posCount = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 };
  const picks = [...(seatPicks ?? [])];
  for (const pk of picks) {
    const assigned = pk.rosterSlot;
    if (assigned && slots[assigned]) slots[assigned].filled += 1;
    const p = slotPos(pk.position);
    if (posCount[p] != null) posCount[p] += 1;
  }
  return { index: null, isUser: true, picks, slots, posCount };
}

/**
 * How this seat's roster can currently absorb `position`:
 *   'open' - a dedicated starter slot for it is still empty
 *   'flex' - dedicated is full, but the player is FLEX-eligible and FLEX is open
 *   'full' - neither; only bench value remains
 *
 * This is the DISPLAY fact behind the sort. It is read straight off the same
 * helpers canRoster uses, so the tag can never disagree with the arithmetic.
 */
export function slotStateFor(team, position) {
  const p = slotPos(position);
  if (openDed(team, p) > 0) return 'open';
  if (FLEX_ELIGIBLE.has(p) && openFlex(team) > 0) return 'flex';
  // BENCH IS A REAL SLOT. Rounds 6 to 15 are mostly bench, and a roster with six
  // empty bench spots has somewhere to put the best player available - calling
  // that 'full' hid the best value on the board behind worse picks whose
  // dedicated slot happened to be open. 'full' now means what it says: nowhere
  // left at all, which is nearly the end of the draft.
  if (openBN(team) > 0) return 'bench';
  return 'full';
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
/**
 * Can this team roster this player?
 *
 * `opts.humanPick` exempts rules (a) and (b), the two K/DST guardrails. Both
 * exist to keep AI DRAFTERS realistic - engines left to themselves will take a
 * kicker in round 3, and a second one after that - and both are sanity rules
 * about the simulation, not rules of fantasy football:
 *
 *   (a) the round floor. A user with an OPEN DST slot in round 8 was refused
 *       with "Roster can't fit that pick" over a slot that was visibly empty.
 *   (b) never a second K/DST. A bench slot is POSITIONLESS - it will hold
 *       anything - so refusing a second defense while six bench spots stand
 *       empty is the engine deciding a roster question that belongs to the
 *       person filling the roster. Two kickers can never both start, which
 *       makes it a poor pick, not an illegal one. The sort demotes it to its
 *       own tier below skill depth (see seatValuation.js); the rulebook no
 *       longer forbids it.
 *
 * Imposed on a person, either contradicts the whole promise: the read is theirs.
 *
 * It is opt-OUT rather than opt-in so the engine's own behaviour is preserved by
 * default: aiPick reaches this through legalCandidates without opts, keeps the
 * floor, and drafts byte-identically. Only the two human-facing callers pass it.
 *
 * NOTE both of those are human: the sim user's own pick, AND every tracker log -
 * in tracker mode all twelve seats are real people at a real table, so applying
 * an AI-realism rule there would refuse to record something that actually
 * happened.
 */
export function canRoster(state, team, player, round, ctx = null, opts = {}) {
  const p = slotPos(player.position);
  const dedOpen = openDed(team, p);
  const flexOpen = FLEX_ELIGIBLE.has(p) ? openFlex(team) : 0;
  const bnOpen = openBN(team);
  // (d) position can fill NO remaining slot
  if (dedOpen + flexOpen + bnOpen === 0) return false;
  // (b) SINGLETON CAP - no copies beyond STARTABLE slots for K/DST. ENGINE
  //     SEATS ONLY - see the note on this function. A person may stash one on
  //     a bench slot that would otherwise sit empty; the sort ranks it behind
  //     skill depth rather than refusing it. The cap reads the ROOM'S roster
  //     shape (a 2-K console roster caps at 2), never a hardcoded 1 - which is
  //     exactly what this floor was before the K/DST-cap law (it read >= 1 and
  //     would have wrongly barred the second K of a 2-K custom room).
  if (!opts.humanPick && SINGLETON_POSITIONS.includes(p)
    && team.posCount[p] >= (team.slots[p]?.cap ?? 1)) return false;
  // (c) QB cap (no 3rd QB in 1QB; no 4th QB in 2QB)
  if (p === 'QB' && team.posCount.QB >= state.qbCap) return false;
  // (a) no K/DST before K_DST_MIN_ROUND unless only K/DST slots remain.
  //     ENGINE SEATS ONLY - see the note on this function.
  if (!opts.humanPick
    && (p === 'K' || p === 'DST') && round < PARAMS.K_DST_MIN_ROUND && openNonKDST(team) > 0) return false;
  // (f) FORCE-UP - the floors' contrapositive, and it did NOT exist before
  //     the K/DST-cap law (recon item 2: BUILD, not confirm). When the picks
  //     remaining are no more than the open starter slots, every pick must
  //     fill a starter: a pure bench add here starves a required slot the
  //     roster can never come back for. Relaxed LAST in legalCandidates'
  //     fallback chain so a pool with no startable players left still yields
  //     a legal move.
  if (!opts.humanPick && !opts.relaxForceUp) {
    const remaining = state.rounds - team.picks.length;
    if (remaining <= openStarterSlots(team) && dedOpen + flexOpen === 0) return false;
  }
  // (e) SCARCITY: a PURE BENCH add (does not fill one of this team's open starter
  //     slots) is barred while remaining supply of that position <= the number of
  //     OTHER teams still needing it as a starter. Stops one team hoarding a
  //     scarce position (e.g. TE) to its bench and starving others. Relaxed by
  //     the fallback in legalCandidates if it would leave no legal move.
  if (ctx) {
    // Bypass scarcity only when the pick fills the team's OWN DEDICATED slot for
    // the position — NOT FLEX. A scarce position (e.g. TE) drafted into FLEX
    // still consumes a body another team needs for its dedicated starter, so a
    // FLEX/bench fill of a scarce position is gated: fill FLEX with an abundant
    // RB/WR instead. (Without this, FLEX-TEs starved a team's TE slot.)
    const fillsDedicated = dedOpen > 0;
    if (!fillsDedicated) {
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
  const collect = (useCtx, opts = {}) => {
    const out = [];
    for (const pl of state.available) {
      if (canRoster(state, team, pl, round, useCtx, opts)) { out.push(pl); if (out.length >= PARAMS.CANDIDATE_N) break; }
    }
    return out;
  };
  // Relaxation chain, strictest first: scarcity yields, then force-up - so a
  // legal pick always exists when any player is placeable.
  const withScarcity = collect(ctx);
  if (withScarcity.length > 0) return withScarcity;
  const withoutScarcity = collect(null);
  if (withoutScarcity.length > 0) return withoutScarcity;
  return collect(null, { relaxForceUp: true });
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
    // null stays null: a keeper the feed never priced has no market price, and
    // Number(null) is 0, which would grade as a 200-pick reach.
    adpAtPick: player.adp == null ? null : Number(player.adp),
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
    const T = temperature(state, c);
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
/**
 * The keeper owed at the current overall, or null. His player comes off the
 * shelf createDraftState set aside, never from `available` - he was never on
 * the board for anyone else.
 */
export function keeperAt(state) {
  const k = state.keepers?.get(state.overallPick);
  if (!k) return null;
  const player = state.held?.get(k.ffcPlayerId);
  if (!player) {
    throw new Error(`keeper ${k.playerName} (${k.ffcPlayerId}) is not on the shelf at overall ${state.overallPick}`);
  }
  return { player, keeper: k };
}

/** Commit the keeper owed here, off the shelf. Returns the record, or null if none is owed. */
export function takeKeeper(state) {
  const owed = keeperAt(state);
  if (!owed) return null;
  const teamIndex = state.order[state.overallPick - 1];
  const rec = commit(state, state.teams[teamIndex], owed.player, 'logged');
  rec.isKeeper = true;
  state.held.delete(owed.player.ffcPlayerId);
  return rec;
}

export function applyPick(state, teamIndex, player, pickedBy = 'user', extra = {}) {
  if (!state.available.includes(player)) return null;
  return commit(state, state.teams[teamIndex], player, pickedBy, extra);
}

// ---------------------------------------------------------------------------
// runFullDraft — full simulation (all seats AI in auto mode)
// ---------------------------------------------------------------------------
/**
 * @param seedState  OPTIONAL, a state that already carries pre-made picks.
 *
 * KEEPERS ARRIVE AS A PRE-SEEDED STATE rather than as a list this function
 * applies. A Fantrax league's first 41 picks are already made, and they must be
 * OFF the available pool before any AI decision - a fresh createDraftState here
 * would re-offer every kept player and the draft would hand out duplicates.
 *
 * The returned `picks` are the ones THIS call made. The seeded ones are already
 * persisted by the caller, and returning them again would double-insert.
 */
export function runFullDraft(config, pool, userPickPosition, opts, rng, seedState) {
  const state = seedState ?? createDraftState(config, pool, userPickPosition);
  const before = state.picks.length;
  const totalPicks = state.rounds * state.teamsCount;
  // Resume from wherever the state actually is, not from zero.
  for (let k = state.overallPick - 1; k < totalPicks; k++) {
    // THE KEEPER FIRST, IF ONE IS OWED HERE. It is not a choice, so no AI runs
    // for it and no RNG is drawn - which also keeps a keepered draft's AI picks
    // deterministic against the same seed.
    if (takeKeeper(state)) continue;
    const teamIndex = state.order[k];
    const rec = aiPick(state, teamIndex, rng);
    if (!rec) throw new Error(`runFullDraft: no legal pick at overall ${state.overallPick} (team ${teamIndex})`);
  }
  return { picks: state.picks.slice(before), teams: state.teams, state };
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
