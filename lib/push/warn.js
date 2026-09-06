// lib/push/warn.js - every early return in the push path says so out loud.
//
// THE DEFECT THIS CLOSES. pushPayload(), scoreHeadline() and dispatch()
// each had guards that returned null on a missing field. They were correct
// to refuse - but they refused SILENTLY, with no log line, no error and no
// push_sends row, so 35+ lost pushes on 5 Sep left no trace at all and the
// camelCase mismatch survived a full slate before anyone noticed.
//
// A REFUSAL IS A FACT ABOUT A MATCH, so it is logged with the match id and
// the event, which is what makes it greppable against a ledger afterwards.
// Counters ride alongside for the heartbeat summary: one line per refusal
// is right for a debug trail, and a running total is what a summary needs.

const counts = { payloadNull: 0, audienceEmpty: 0, headlineNull: 0, dispatchSkip: 0 };

export function pushWarn(reason, { matchId = null, event = null, detail = null } = {}) {
  if (reason in counts) counts[reason] += 1;
  const bits = [
    `[push] ${reason}`,
    matchId != null ? `match=${matchId}` : null,
    event ? `event=${event}` : null,
    detail ? `detail=${detail}` : null,
  ].filter(Boolean);
  console.warn(new Date().toISOString(), bits.join(' '));
}

/** Snapshot the counters and reset - the heartbeat reads a WINDOW, not a
 *  process total, so it must clear as it reads. */
export function drainPushCounts() {
  const out = { ...counts };
  for (const k of Object.keys(counts)) counts[k] = 0;
  return out;
}

/** Read without resetting, for tests. */
export const peekPushCounts = () => ({ ...counts });
