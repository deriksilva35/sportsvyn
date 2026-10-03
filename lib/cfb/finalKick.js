// lib/cfb/finalKick.js - the CFB box score, kicked by the final (sun-6 item 2).
//
// THE RULING (Derik, verbatim): "Finals within 15 min: the live poller kicks
// the CFBD week import when a CFB game goes final (advanceKick pattern),
// throttled to one run per 10 min. Keep the hourly cron as the backstop."
//
// WHY. cfb_player_game_stats was written only by the hourly cron
// (app/api/cron/cfb-player-stats), so on 3 Oct a final waited 9-96 min for its
// box, mostly 25-55. CFBD's /games/players is post-game only - a call while the
// game is live returns nothing for it - so the earliest useful moment is the
// final itself, and the live poller is the process that sees it.
//
// THIS FILE IS PURE: no DB, no network, no real clock. The throttle and the
// once-per-match dedupe live here and are tested with a fake clock
// (finalKick.test.mjs); the DB-bound run is lib/cfb/finalKickRun.js.
//
// THE THROTTLE, START TO START: at most one import run per KICK_WINDOW_MS,
// across every week. A final that arrives with no run in the last window runs
// NOW (the leading edge). One that arrives inside the window is queued, and ONE
// trailing run at the window's end covers everything queued meanwhile - so no
// final waits for the hourly cron when the window could cover it sooner, and a
// Saturday's forty finals cost at most six runs an hour.
//
// THE RETRY. CFBD's box can trail the final by a few minutes, and the cron may
// hold the shared lock at the moment of the kick. The run says which items it
// did NOT land (box not yet published, or the run was locked out or failed),
// and those go round again on the next window, up to KICK_MAX_ATTEMPTS; after
// that the hourly cron's catch-up pass (weeksMissingStats) owns them.

export const KICK_WINDOW_MS = 10 * 60 * 1000;
export const KICK_MAX_ATTEMPTS = 3;

/** One CFBD call's worth: a (season, phase, week). */
export const weekKey = ({ season, phase, week }) => `${season}|${phase}|${week}`;

/**
 * THE ONCE-PER-MATCH GATE. pollOnce already reports only rows THIS poll turned
 * final (services/live-poller/poll.mjs turnedFinal), so an already-final game
 * never appears on a later tick. A game that flaps final -> live -> final would
 * appear twice; `seen` is what keeps that to one kick per process. Returns the
 * ids not seen before and marks them seen.
 */
export function newFinals(finalIds, seen) {
  const out = [];
  for (const raw of finalIds ?? []) {
    if (raw == null) continue;
    const id = Number(raw);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * The throttle. `run(batch)` is handed [{ season, phase, week, matchIds, attempts }]
 * and resolves { requeue: [{ season, phase, week, matchIds }] } for whatever it
 * did not land. It may also throw; the whole batch then goes round again.
 * NOTHING HERE THROWS INTO THE CALLER: enqueue() is synchronous and returns at
 * once, and the run happens off the poll loop's await chain.
 */
export function createKickThrottle({
  run, windowMs = KICK_WINDOW_MS, maxAttempts = KICK_MAX_ATTEMPTS,
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, log = () => {},
} = {}) {
  const pending = new Map();
  let lastStartAt = null;
  let running = null;
  let timer = null;

  function merge(item, attempts) {
    const key = weekKey(item);
    const cur = pending.get(key);
    const ids = new Set([...(cur?.matchIds ?? []), ...(item.matchIds ?? []).map(Number)]);
    pending.set(key, {
      season: item.season, phase: item.phase, week: item.week,
      matchIds: [...ids],
      // A fresh final on a week already queued for a retry resets nothing: the
      // retry count belongs to the oldest unlanded box in the item.
      attempts: Math.max(cur?.attempts ?? 0, attempts),
    });
  }

  function start() {
    const batch = [...pending.values()];
    pending.clear();
    lastStartAt = now();
    running = Promise.resolve()
      .then(() => run(batch))
      .then((res) => res?.requeue ?? [], (e) => {
        log('[cfb] final-kick run threw:', String(e?.message ?? e).slice(0, 160));
        return batch;
      })
      .then((requeue) => {
        const byKey = new Map(batch.map((b) => [weekKey(b), b.attempts ?? 0]));
        for (const it of requeue) {
          const attempts = (byKey.get(weekKey(it)) ?? 0) + 1;
          if (attempts >= maxAttempts) {
            log(`[cfb] final-kick ${weekKey(it)} still missing after ${attempts} runs - left to the hourly cron`);
            continue;
          }
          merge(it, attempts);
        }
      })
      .catch(() => {})
      .finally(() => { running = null; schedule(); });
  }

  function schedule() {
    if (running || timer || pending.size === 0) return;
    const due = lastStartAt == null ? now() : lastStartAt + windowMs;
    const wait = due - now();
    if (wait <= 0) { start(); return; }
    timer = setTimer(() => { timer = null; schedule(); }, wait);
    timer?.unref?.();
  }

  return {
    enqueue(items) {
      try {
        for (const it of items ?? []) {
          if (it?.season == null || it?.week == null) continue;
          merge(it, 0);
        }
        schedule();
      } catch (e) {
        log('[cfb] final-kick enqueue failed:', String(e?.message ?? e).slice(0, 160));
      }
    },
    /** For tests and the journal: what is waiting, and whether a run is out. */
    state: () => ({ pending: [...pending.values()], running: Boolean(running), timer: Boolean(timer), lastStartAt }),
    /** Resolves when the in-flight run (if any) has settled. Tests only. */
    idle: () => running ?? Promise.resolve(),
    stop() { if (timer) { clearTimer(timer); timer = null; } },
  };
}
