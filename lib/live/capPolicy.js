// lib/live/capPolicy.js - what the live poller does when a league is at its daily call cap.
//
// CAPPED MEANS SLOW, NOT STOPPED (see the header of lib/live/quota.js). applyCap()
// lifts the sleep to >= 300 s and marks the decision `capped`; that is the WHOLE
// effect. On 31 Oct the loop also gated the poll on `!decision.capped`, so CFB
// opened its window and then never polled: every live game kept NULL scores for
// 3.5 hours with no log line. The poll now runs every time the loop wakes, and
// the capped sleep is what keeps it to one poll per five minutes.
//
// What a capped poll costs: one primary fetch (+ the league's enrich/detail, as
// on any poll) per five minutes. The box-score tracker counts POLLS (every 10th),
// so it slows by the same factor; the MLB/NBA extras are uncapped leagues. FCS is
// not wired into the loop. Nothing in the tick multiplies calls under the cap.

/** Should this loop tick poll the provider? Capped is NOT a reason to skip. */
export function shouldPoll({ active, lock }) {
  return Boolean(active && lock);
}

/**
 * Journal notes for the cap, one instance per league loop. PURE apart from the
 * log function it is handed.
 *   - cap reached: one line per UTC day (and per process), the first tick spend >= cap
 *   - capped window: one line per window, the first polling tick while capped
 */
export function createCapNotes(log) {
  let reachedDay = null;
  let windowNoted = false;
  return {
    /** Call once per tick, after applyCap(). `windowOpen` = the lock is held. */
    tick({ league, capped, calls, cap, windowOpen, now = new Date() }) {
      const day = new Date(now).toISOString().slice(0, 10);
      if (capped && reachedDay !== day) {
        reachedDay = day;
        log(`[${league}] daily cap reached: ${calls}/${cap} calls - dropping to 5m`);
      }
      if (!capped) windowNoted = false;
      else if (windowOpen && !windowNoted) {
        windowNoted = true;
        log(`[${league}] capped: polling at 5m`);
      }
    },
    /** The window closed: the next capped window announces itself again. */
    windowClosed() { windowNoted = false; },
  };
}
