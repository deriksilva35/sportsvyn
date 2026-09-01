// lib/live/quota.js — the provider call budget, per league per UTC day.
//
// PERSISTED, BECAUSE A COUNTER IN MEMORY IS NOT A CAP. systemd restarts this
// process on every crash (Restart=always, by design), and an in-process tally
// would reset to zero each time - so the one failure mode that spends a
// month's budget in an afternoon, a crash loop, is exactly the one an in-memory
// counter cannot see. The count lives in sync_runs alongside everything else
// that has to survive a restart.
//
// THE CAP DEGRADES, IT DOES NOT STOP. Hitting it drops the league to the idle
// cadence and alerts; it does not kill the loop. A poller that goes silent at
// the cap looks identical to a poller that died, and the slate still needs
// finals written even at five minutes.

export const DEFAULT_CAP = Object.freeze({ cfb: 2000, nfl: 5000 });

/**
 * FCS RIDES EVERY FOURTH POLL. Ruled, and the ratio is arithmetic rather than
 * taste.
 *
 * CFBD's /scoreboard serves FBS by default; FCS is a SECOND call with
 * ?classification=fcs. At 30 seconds both, a twelve-hour Saturday is
 * 1,440 + 1,440 = 2,880 calls against a 2,000 cap - it does not fit, so it does
 * not run at that cadence. Every fourth poll gives FCS a two-minute cadence:
 *
 *     FBS  12h at 30s   = 1,440 calls
 *     FCS  12h at 120s  =   360 calls
 *                         -------------
 *                           1,800, inside 2,000 with the heartbeat's slack
 *
 * TIER-A IS STILL ITS OWN RELAY. Nothing calls this yet; the ratio is pinned
 * here so the relay that lands FCS starts from the number the budget actually
 * allows rather than re-deriving it, and so a test can hold it.
 */
export const FCS_EVERY_NTH_POLL = 4;

/** Does this poll index carry the FCS call too? Poll 0 is the first of a window. */
export function fcsThisPoll(pollIndex, nth = FCS_EVERY_NTH_POLL) {
  return Number.isInteger(pollIndex) && pollIndex >= 0 && pollIndex % nth === 0;
}

/** Calls a 12-hour Saturday costs at a given cadence. Used by the test, and by
 *  anyone re-checking the ruling against a changed cap. */
export function saturdayCalls({ hours = 12, liveSec = 30, fcsNth = FCS_EVERY_NTH_POLL } = {}) {
  const polls = Math.round((hours * 3600) / liveSec);
  return { polls, fbs: polls, fcs: Math.ceil(polls / fcsNth), total: polls + Math.ceil(polls / fcsNth) };
}

export const utcDay = (now = new Date()) => new Date(now).toISOString().slice(0, 10);

const SOURCE = (league) => `live-poller-${league}`;

/**
 * APPEND A DELTA, SUM TO READ. Not an upserted running total, and the reason is
 * the schema rather than taste: sync_runs has no unique index on
 * (source, kind), so ON CONFLICT has nothing to conflict on. Adding one is a
 * migration, and a migration is a dual-GO for a counter - append-only needs
 * neither, and cannot lose a race between two writers because there is no
 * read-modify-write to lose.
 *
 * THE DELTA IS FLUSHED ON THE HEARTBEAT, NOT PER POLL. A row per 30s poll would
 * be 1,440 ledger rows per league per Saturday, which buries every other row in
 * the table. Flushed every five minutes it is 12 rows an hour.
 *
 * WHAT THAT COSTS, STATED: a crash loses the calls made since the last flush -
 * at most five minutes of them, ten calls. The cap is therefore accurate to
 * within one heartbeat, which is the right trade against a migration and a
 * per-poll write. It is bounded and it is in the direction of spending slightly
 * more, never of silently capping early.
 */
export async function addCalls(sql, league, n, now = new Date()) {
  if (!Number.isFinite(n) || n <= 0) return callsToday(sql, league, now);
  const day = utcDay(now);
  await sql`
    INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, summary)
    VALUES (${SOURCE(league)}, ${'quota:' + day}, now(), now(), true,
            ${JSON.stringify({ day, calls: n })}::jsonb)`;
  return callsToday(sql, league, now);
}

/** Today's tally, summed over the day's delta rows. */
export async function callsToday(sql, league, now = new Date()) {
  const day = utcDay(now);
  const rows = await sql`
    SELECT COALESCE(SUM((summary->>'calls')::int), 0)::int AS calls
      FROM sync_runs
     WHERE source = ${SOURCE(league)} AND kind = ${'quota:' + day}`;
  return rows[0]?.calls ?? 0;
}

/**
 * Is this league over budget? PURE, so the decision is testable without a
 * database and without spending a call to find out.
 */
export function overCap(calls, league, caps = DEFAULT_CAP) {
  const cap = caps[league];
  if (!Number.isFinite(cap)) return false;
  return Number(calls ?? 0) >= cap;
}

/**
 * The cadence a league may actually run at, given its spend.
 *
 * THE CAP OVERRIDES THE STATE MACHINE AND NOTHING ELSE DOES. Passing the
 * decision through here rather than branching in the loop keeps "how often
 * should I look" in one place with one answer.
 */
export function applyCap(decision, calls, league, caps = DEFAULT_CAP) {
  if (!overCap(calls, league, caps)) return decision;
  return { ...decision, state: `${decision.state}-capped`, sleepSec: Math.max(decision.sleepSec, 300), capped: true };
}
