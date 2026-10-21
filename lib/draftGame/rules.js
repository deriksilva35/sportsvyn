// lib/draftGame/rules.js - the per-game Draft's room, as pure functions (thu-3 S1).
//
// ONE REAL GAME, FOUR DRAFTERS, FOUR PICKS EACH, BEST THREE COUNT (Derik's
// ruling). The pool is both teams' players, frozen on the contest when the board
// is made (lib/draftGame/create.js), and the room is a 4-seat snake over it:
// you in one seat, a bot in each of the other three.
//
// SLOT-FREE. There are no position slots: any player is a legal pick, so a seat
// can never be left unable to pick, and best ball absorbs the scarcity - with
// two QBs in the pool a QB is a choice, not a requirement. That is also why
// this is NOT lib/fantasy/engine.js: the sim engine is built around slots,
// 8-16 seats and the FFC pool, and the weekly ranked Draft keeps running on it
// unchanged until S4 retires it.
//
// DETERMINISTIC BOTS. A bot's choice is a function of (contest, the human's
// seat, the pick number) and the board, never of the room id or the clock -
// the same reason lib/draft/roomSeed.js exists: two readers at the same seat of
// the same game who make the same picks see the same room.
//
// Nothing here reads the database or the clock; callers pass `now`.

export const SEATS = 4;
export const ROUNDS = 4;
export const COUNT_BEST = 3;
export const CLOCK_SECONDS = 30;
/** Picks a room makes in all: 16. */
export const TOTAL_PICKS = SEATS * ROUNDS;
/** Players only - no K, no DST (ruling). */
export const NFL_POSITIONS = Object.freeze(['QB', 'RB', 'WR', 'TE']);
/** A bot chooses among the best this many still on the board. */
export const BOT_TOP_N = 3;
const BOT_WEIGHTS = [0.6, 0.3, 0.1];

/** The seat (1-based) on the clock at overall pick n (1-based): a 4-seat snake. */
export function seatAt(n, seats = SEATS) {
  const i = n - 1;
  const round = Math.floor(i / seats);
  const k = i % seats;
  return (round % 2 === 0 ? k : seats - 1 - k) + 1;
}

/**
 * THE ROOM'S SHAPE (tue-6). A per-game board is the constants above; the NBA
 * Nightly Draft carries its own on contest.meta: { seats, rounds, slots, count }.
 * `slots` (e.g. ['G','F','UTIL']) makes the room positional: a seat may only
 * take a player who still fits one of its open slots. No slots = slot-free.
 */
export const DEFAULT_SHAPE = Object.freeze({ seats: SEATS, rounds: ROUNDS, slots: null, count: COUNT_BEST });
export function shapeOf(meta) {
  const m = meta ?? {};
  return {
    seats: Number(m.seats) || SEATS,
    rounds: Number(m.rounds) || ROUNDS,
    slots: Array.isArray(m.slots) && m.slots.length ? m.slots : null,
    count: Number(m.count) || COUNT_BEST,
  };
}

/** Can a player listed at `pos` fill `slot`? UTIL takes anyone; G/F/C by letter (BDL "G-F" fits both). */
export function slotFits(pos, slot) {
  if (slot === 'UTIL') return true;
  const parts = String(pos ?? '').toUpperCase().split(/[-/ ]+/).filter(Boolean);
  if (slot === 'G') return parts.some((x) => x === 'G' || x === 'PG' || x === 'SG');
  if (slot === 'F') return parts.some((x) => x === 'F' || x === 'SF' || x === 'PF');
  if (slot === 'C') return parts.includes('C');
  return parts.includes(slot);
}

/**
 * Assign players (in pick order) to distinct slots, or null when they cannot all
 * fit. Small exhaustive search - three slots, three players. PURE.
 * Returns [slot per player].
 */
export function assignSlots(positions, slots) {
  const used = new Array(slots.length).fill(false);
  const out = [];
  const go = (i) => {
    if (i === positions.length) return true;
    for (let k = 0; k < slots.length; k += 1) {
      if (used[k] || !slotFits(positions[i], slots[k])) continue;
      used[k] = true; out[i] = slots[k];
      if (go(i + 1)) return true;
      used[k] = false;
    }
    return false;
  };
  return go(0) ? [...out] : null;
}

const POS_SLOTS = ['G', 'F', 'C'];

/** Slots (by name) a roster of positions leaves unfilled under the first assignment found; null if it cannot be placed. PURE. */
export function unfilledSlots(positions, slots) {
  const used = new Array(slots.length).fill(false);
  const go = (i) => {
    if (i === positions.length) return true;
    for (let k = 0; k < slots.length; k += 1) {
      if (used[k] || !slotFits(positions[i], slots[k])) continue;
      used[k] = true;
      if (go(i + 1)) return true;
      used[k] = false;
    }
    return false;
  };
  return go(0) ? slots.filter((_, k) => !used[k]) : null;
}

/**
 * A positional room must not strand a seat: a candidate is kept only if, once he
 * is gone, the players left on the board still cover the G / F / C slots every
 * seat has yet to fill. A necessary condition (a G-F player counts toward both),
 * so it is a preference, not a promise: if it would leave nothing, the legal
 * list stands. PURE.
 */
function keepFinishable(legal, open, rosters, onClock, slots) {
  const base = Object.fromEntries(POS_SLOTS.map((t) => [t, 0]));
  for (const s of Object.keys(rosters)) {
    if (Number(s) === onClock) continue;
    for (const t of unfilledSlots(rosters[s].map((x) => x.pos), slots) ?? []) if (t in base) base[t] += 1;
  }
  const elig = Object.fromEntries(POS_SLOTS.map((t) => [t, open.filter((r) => slotFits(r.pos, t)).length]));
  const mine = rosters[onClock].map((x) => x.pos);
  const ok = legal.filter((r) => {
    const left = unfilledSlots([...mine, r.pos], slots) ?? [];
    return POS_SLOTS.every((t) => {
      const demand = base[t] + left.filter((x) => x === t).length;
      return elig[t] - (slotFits(r.pos, t) ? 1 : 0) >= demand;
    });
  });
  return ok.length ? ok : legal;
}

/** 1-based round of overall pick n. */
export const roundOf = (n, seats = SEATS) => Math.floor((n - 1) / seats) + 1;

/** Board rows sorted best projection first; ties by name so the order is total. */
export function byProjection(rows) {
  return [...rows].sort((a, b) => (Number(b.proj) - Number(a.proj)) || String(a.name).localeCompare(String(b.name)) || (Number(a.id) - Number(b.id)));
}

/**
 * The room as it stands after `picks` ([{ n, seat, id, by }], any order).
 * Returns { next, done, onClock, available (best first), rosters {seat: [rows]} }.
 * A pick whose player is not on the board, or already taken, throws - a stored
 * room that does not replay is a defect to surface, not to paper over.
 */
export function roomState(board, picks, shape = DEFAULT_SHAPE) {
  const { seats, rounds, slots } = shape ?? DEFAULT_SHAPE;
  const rows = byProjection(board ?? []);
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  const taken = new Set();
  const rosters = Object.fromEntries(Array.from({ length: seats }, (_, i) => [i + 1, []]));
  const sorted = [...(picks ?? [])].sort((a, b) => a.n - b.n);
  sorted.forEach((p, i) => {
    if (p.n !== i + 1) throw new Error(`roomState: pick ${p.n} out of order (expected ${i + 1})`);
    if (p.seat !== seatAt(p.n, seats)) throw new Error(`roomState: pick ${p.n} made by seat ${p.seat}, not ${seatAt(p.n, seats)}`);
    const row = byId.get(Number(p.id));
    if (!row) throw new Error(`roomState: player ${p.id} is not on this board`);
    if (taken.has(Number(p.id))) throw new Error(`roomState: player ${p.id} taken twice`);
    taken.add(Number(p.id));
    rosters[p.seat].push({ ...row, n: p.n, by: p.by });
  });
  const next = sorted.length + 1;
  const done = sorted.length >= seats * rounds;
  const onClock = done ? null : seatAt(next, seats);
  const open = rows.filter((r) => !taken.has(Number(r.id)));
  // POSITIONAL ROOMS: what the seat on the clock may legally take - a player who
  // still fits one of its open slots alongside what it already holds.
  const legal = slots && onClock
    ? open.filter((r) => assignSlots([...rosters[onClock].map((x) => x.pos), r.pos], slots) != null)
    : open;
  // ...and, where it can be told, one that leaves every seat a way to finish: the
  // players still on the board must cover the slots the seats have yet to fill.
  const available = slots && onClock ? keepFinishable(legal, open, rosters, onClock, slots) : legal;
  if (slots) {
    for (const s of Object.keys(rosters)) {
      const a = assignSlots(rosters[s].map((x) => x.pos), slots);
      rosters[s] = rosters[s].map((x, i) => ({ ...x, slot: a ? a[i] : null }));
    }
  }
  return { next, done, onClock, available, rosters };
}

// mulberry32 - small, seedable, plenty for picking one of three.
function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The bot's dice for one pick: (contest, the human's seat, pick number). */
export function botSeed({ contestId, userSeat, n }) {
  return ((Number(contestId) * 1_000_003) ^ (Number(userSeat) * 7919) ^ (Number(n) * 104_729)) >>> 0;
}

/**
 * A bot's pick: one of the best BOT_TOP_N by projection, weighted 60/30/10.
 * Never null while anything is available - a bot cannot stall a room.
 */
export function botPick(available, seed) {
  const top = available.slice(0, BOT_TOP_N);
  if (!top.length) return null;
  const w = BOT_WEIGHTS.slice(0, top.length);
  const total = w.reduce((a, b) => a + b, 0);
  let r = rng32(seed)() * total;
  for (let i = 0; i < top.length; i += 1) {
    r -= w[i];
    if (r < 0) return top[i];
  }
  return top[top.length - 1];
}

/** The clock ran out, or the room locked: the top projection still available. */
export const autoPick = (available) => available[0] ?? null;

/**
 * Run the bots from the current pick until it is the human's turn or the room
 * is full. Returns the NEW pick records only (the caller persists them).
 */
export function advanceBots(board, picks, { contestId, userSeat, shape = DEFAULT_SHAPE }) {
  const made = [];
  let all = [...picks];
  let st = roomState(board, all, shape);
  while (!st.done && st.onClock !== userSeat) {
    const row = botPick(st.available, botSeed({ contestId, userSeat, n: st.next }));
    if (!row) throw new Error(`advanceBots: empty board at pick ${st.next}`);
    const rec = { n: st.next, seat: st.onClock, id: Number(row.id), by: 'bot' };
    made.push(rec);
    all = [...all, rec];
    st = roomState(board, all, shape);
  }
  return made;
}

/**
 * Finish a room no human will move again (the game locked): every remaining
 * pick is made - the human's seat by autoPick, the bots as ever.
 */
export function completeRoom(board, picks, { contestId, userSeat, shape = DEFAULT_SHAPE }) {
  const made = [];
  let all = [...picks];
  let st = roomState(board, all, shape);
  while (!st.done) {
    let rec;
    if (st.onClock === userSeat) {
      const row = autoPick(st.available);
      if (!row) throw new Error(`completeRoom: empty board at pick ${st.next}`);
      rec = { n: st.next, seat: userSeat, id: Number(row.id), by: 'auto' };
      made.push(rec);
      all = [...all, rec];
    } else {
      const bots = advanceBots(board, all, { contestId, userSeat, shape });
      made.push(...bots);
      all = [...all, ...bots];
    }
    st = roomState(board, all, shape);
  }
  return made;
}

/**
 * Sweep the human's expired clocks. While the human is on the clock and
 * `now` is past the deadline, auto-pick for them, run the bots, and start the
 * next clock FROM THE OLD DEADLINE (an absent reader loses one pick per 30 s,
 * not one per visit). Returns { made, deadline } - deadline null once the
 * room is full.
 */
export function sweepClock(board, picks, deadlineIso, { contestId, userSeat, now, clockSeconds = CLOCK_SECONDS, shape = DEFAULT_SHAPE }) {
  const made = [];
  let all = [...picks];
  let deadline = deadlineIso ? new Date(deadlineIso) : null;
  let st = roomState(board, all, shape);
  while (!st.done && st.onClock === userSeat && deadline && now >= deadline) {
    const row = autoPick(st.available);
    const rec = { n: st.next, seat: userSeat, id: Number(row.id), by: 'auto' };
    const bots = advanceBots(board, [...all, rec], { contestId, userSeat, shape });
    made.push(rec, ...bots);
    all = [...all, rec, ...bots];
    st = roomState(board, all, shape);
    deadline = st.done ? null : new Date(deadline.getTime() + clockSeconds * 1000);
  }
  return { made, deadline: st.done ? null : (deadline ? deadline.toISOString() : null) };
}

/** Best COUNT_BEST of a seat's points (missing / null scores count 0). */
export function bestOf(points, count = COUNT_BEST) {
  return [...points].map((p) => Number(p) || 0).sort((a, b) => b - a).slice(0, count)
    .reduce((a, b) => a + b, 0);
}

/**
 * Is the game locked for drafting? Status off 'scheduled' (live, final, off)
 * locks whatever the clock says; otherwise kickoff, `<=` at the boundary - the
 * Pick'em rule (lib/pickem/entry.js dayGameLocked).
 */
export function gameLocked({ status, kickoff_at: kickoffAt }, now) {
  if (status && status !== 'scheduled') return true;
  const k = new Date(kickoffAt).getTime();
  return !Number.isFinite(k) || new Date(now).getTime() >= k;
}

/** The room header: "Round N of 4 · your pick" (or the room's other states). */
export function roomHeader(st, userSeat, shape = DEFAULT_SHAPE) {
  if (st.done) return 'Draft complete';
  const round = roundOf(st.next, shape.seats);
  return st.onClock === userSeat ? `Round ${round} of ${shape.rounds} · your pick` : `Round ${round} of ${shape.rounds}`;
}

/**
 * Seat names: 'You', and the bots lettered A, B, C in seat order, skipping
 * yours - a seat number beside "You" read as a fifth drafter (thu-3 shots).
 */
export function seatLabels(userSeat, seats = SEATS) {
  const out = {};
  let k = 0;
  for (let s = 1; s <= seats; s += 1) out[s] = s === userSeat ? 'You' : `Bot ${'ABCDEFG'[k++]}`;
  return out;
}

/** Open boards grouped by ET game day (dayKey), kickoff order kept. PURE. */
export function groupByDay(boards) {
  const out = [];
  for (const b of boards) {
    const last = out[out.length - 1];
    if (last && last.dayKey === b.dayKey) last.boards.push(b);
    else out.push({ dayKey: b.dayKey, day: b.day, boards: [b] });
  }
  return out;
}

/** "1st", "2nd", "3rd", "4th". */
export const ordinal = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/** "NFL · Sunday · 2 of 13 drafted" - the list's lime chip for one game day. */
export const dayChip = (sport, day, drafted, total) => `${String(sport).toUpperCase()} · ${day} · ${drafted} of ${total} drafted`;

export const COPY = Object.freeze({
  listTitle: 'Draft one game.',
  listSub: 'Four drafters, four picks each. Your best three score. Over when the game ends.',
  count: 'Best 3 of 4 count',
  poolFoot: "Pool: both teams' players.",
});
