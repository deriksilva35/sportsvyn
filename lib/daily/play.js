// lib/daily/play.js - the rules of a Daily entry. PURE.
//
// THE CLOCK IS THE GAME, and the clock is SERVER LAW. The 2:00 in the browser
// is a courtesy - a progress bar so the player knows where they are. It is not
// the rule. The rule is `now - started_at`, measured against a timestamp the
// server issued and the server stores, checked at lock time. A client that
// stops its own timer, edits it, or never runs it at all gets exactly the same
// verdict.
//
// GRACE IS 10 SECONDS, and the number is a ruling rather than a feel. A lock
// request has to travel: a slow mobile connection can put five seconds between
// the tap and the row. Rejecting a lineup the player finished at 1:58 because
// their train went into a tunnel would be the game cheating, not the player.
// Ten seconds is long enough to cover a bad network and short enough that it is
// not a thirteenth slot of thinking time. It is applied to the DEADLINE, never
// to the score.

export const CLOCK_MS = 120_000;   // 2:00
export const GRACE_MS = 10_000;    // see above

export const SLOTS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'FLEX2'];
const FLEX_OK = new Set(['RB', 'WR', 'TE']);

/** Which board positions may fill a given slot. */
export function slotAccepts(slot, pos) {
  if (slot === 'FLEX' || slot === 'FLEX2') return FLEX_OK.has(pos);
  return slot === pos;
}

/**
 * Is this lock in time?
 *
 * @returns {{ ok:boolean, elapsedMs:number, reason?:string }}
 */
export function clockVerdict(startedAt, now = new Date()) {
  const t = new Date(startedAt ?? NaN).getTime();
  if (!Number.isFinite(t)) return { ok: false, elapsedMs: Infinity, reason: 'no start time' };
  const elapsedMs = now.getTime() - t;
  // A negative elapsed means the client's start time is ahead of the server's
  // clock, which cannot happen honestly - the server issued it.
  if (elapsedMs < 0) return { ok: false, elapsedMs, reason: 'start time is in the future' };
  if (elapsedMs > CLOCK_MS + GRACE_MS) return { ok: false, elapsedMs, reason: 'too late' };
  return { ok: true, elapsedMs };
}

/**
 * Validate a lineup against the board.
 *
 * Every failure is named. A lineup that is wrong in three ways should say so
 * once per way, because "invalid lineup" sends the player back to guess.
 */
export function validateLineup(lineup, board) {
  const errors = [];
  const byId = new Map((board ?? []).map((p) => [p.id, p]));
  const seen = new Set();

  for (const slot of SLOTS) {
    const id = lineup?.[slot];
    if (id == null) { errors.push(`${slot}: empty`); continue; }
    const p = byId.get(id);
    if (!p) { errors.push(`${slot}: not on today's board`); continue; }
    if (!slotAccepts(slot, p.pos)) { errors.push(`${slot}: a ${p.pos} cannot fill ${slot}`); continue; }
    if (seen.has(id)) { errors.push(`${slot}: ${p.name} is already in the lineup`); continue; }
    seen.add(id);
  }
  const extra = Object.keys(lineup ?? {}).filter((k) => !SLOTS.includes(k));
  if (extra.length) errors.push(`unknown slot: ${extra.join(', ')}`);

  return { ok: errors.length === 0, errors };
}

/**
 * Score a validated lineup: PPR, DROP THE WORST.
 *
 * Six slots are filled and five count. Dropping the worst is what stops one
 * unlucky pick ending the round - it keeps a board readable as "how good were
 * your five best calls" rather than "did you avoid the trap".
 */
export function scoreLineup(lineup, board) {
  const byId = new Map((board ?? []).map((p) => [p.id, p]));
  const picks = SLOTS.map((slot) => {
    const p = byId.get(lineup?.[slot]);
    return { slot, id: p?.id ?? null, name: p?.name ?? null, pos: p?.pos ?? null, points: p ? Number(p.points) : 0 };
  });
  const worst = picks.reduce((lo, p, i) => (p.points < picks[lo].points ? i : lo), 0);
  const counted = picks.filter((_, i) => i !== worst);
  const base = counted.reduce((a, p) => a + p.points, 0);
  return {
    picks: picks.map((p, i) => ({ ...p, dropped: i === worst })),
    droppedSlot: picks[worst].slot,
    baseScore: Math.round(base * 10) / 10,
  };
}

/**
 * The guess bonus.
 *
 * Both right is the headline; the season alone is most of it, because naming
 * the season off six names is the read the puzzle is actually testing. The week
 * alone is a coin-flip's worth of credit - you can get close by recognising one
 * big performance - so it pays least.
 */
export const BONUS = { both: 0.10, season: 0.05, week: 0.02, none: 0 };

export function bonusFor(guess, truth) {
  const s = guess?.season != null && Number(guess.season) === Number(truth?.season);
  const w = guess?.week != null && Number(guess.week) === Number(truth?.week);
  if (s && w) return BONUS.both;
  if (s) return BONUS.season;
  if (w) return BONUS.week;
  return BONUS.none;
}

export const applyBonus = (base, pct) => Math.round(Number(base) * (1 + Number(pct)) * 10) / 10;

/**
 * Percentile BAND, never a rank.
 *
 * A band is what a player can act on ("top 10%") without it becoming a
 * leaderboard, and it does not turn into a name. Ties share a band: two equal
 * scores must never read differently.
 */
export const BANDS = [
  { at: 0.05, label: 'Top 5%' },
  { at: 0.10, label: 'Top 10%' },
  { at: 0.25, label: 'Top 25%' },
  { at: 0.50, label: 'Top 50%' },
  { at: 1.00, label: 'Bottom half' },
];

export function bandFor(score, allScores) {
  const scores = (allScores ?? []).filter((s) => s != null).map(Number);
  if (!scores.length || score == null) return null;
  // Strictly-better count, so ties land in the same band.
  const better = scores.filter((s) => s > Number(score)).length;
  const pct = better / scores.length;
  return BANDS.find((b) => pct < b.at)?.label ?? BANDS[BANDS.length - 1].label;
}
