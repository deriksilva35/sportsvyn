// lib/live/vocabulary.js — provider status -> ours, for the live poller only.
// PURE. Every mapping is explicit and an unrecognised token is COUNTED, never
// coerced.
//
// WHY A SECOND MAP AND NOT lib/gridiron/ingest.js's. That one reads the BDL
// field `status`, which for a not-yet-played NFL game is the kickoff datetime
// rendered as prose ("9/13 - 1:00 PM EDT") - one distinct value per game, so it
// cannot be a table key, and ingest carries a regex to catch it. The live
// payload also carries `status_state`, a machine field, and that is what a
// poller running every thirty seconds should switch on. Measured on the real
// feed 1 Sep 2026: every scheduled Week 1 row has status_state 'scheduled'
// while `status` is the prose.
//
// THE NFL LIVE TOKENS ARE STILL UNVERIFIED AND ARE NOT GUESSED. ingest.js says
// so in its own header and the reason holds here: the first live NFL game is
// Week 1, so no in-progress spelling has ever been observed. 'in_progress' and
// 'final' are mapped below because they are the documented values; anything
// else - including a spelling we got wrong - lands in `unmapped`, writes
// nothing, and alerts. A speculative key would map silently and defeat the one
// mechanism that can teach us the truth.

/** BDL `status_state` -> our status. The machine field, not the prose one. */
export const BDL_STATE = Object.freeze({
  scheduled: 'scheduled',
  in_progress: 'live',
  final: 'final',
  postponed: 'postponed',
  canceled: 'cancelled',
  cancelled: 'cancelled',
});

/** CFBD /scoreboard `status` -> our status. Small and fully observed. */
export const CFBD_SCOREBOARD = Object.freeze({
  scheduled: 'scheduled',
  in_progress: 'live',
  completed: 'final',
  postponed: 'postponed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
});

/**
 * Map one token. Returns null and records the token when it is not known.
 *
 * NULL IS NOT 'unknown status', IT IS 'WRITE NOTHING'. The caller must leave
 * the row exactly as it found it: a status we cannot read is not evidence that
 * the game changed, and coercing it could take a live game off the board or
 * put points on a game in a state we do not understand.
 */
export function mapLiveStatus(provider, token, unmapped) {
  const table = provider === 'bdl' ? BDL_STATE
    : provider === 'cfbd' ? CFBD_SCOREBOARD
      : null;
  if (!table) { unmapped?.push(`(no table: ${provider})`); return null; }
  if (token == null || token === '') { unmapped?.push('(empty)'); return null; }
  const key = String(token).trim().toLowerCase();
  const mapped = table[key];
  if (mapped === undefined) { unmapped?.push(String(token)); return null; }
  return mapped;
}

/**
 * The live chip: period and clock, or null.
 *
 * NULL RATHER THAN A PARTIAL. A chip reading "Q2" with no clock is not half a
 * fact, it is a claim about where in the quarter we are that we cannot support.
 * Same rule the record chip keeps: claim knowledge or say nothing.
 *
 * THIS IS THE ONE WRITER. services/live-poller/poll.mjs is the process that
 * actually wins the write race (the Vercel cron's own live-score arm yields
 * to it on every tick it holds the advisory lock) so {period, clock} - not
 * the older {short, clock} apiSportsImport.js/cfbScoreboard.js shape - is
 * what a reader sees on any row written since. shortOf() below is the one
 * translation from either shape into the display grammar; no other function
 * may parse .short or .period off a live_state object again.
 */
export function liveState(period, clock) {
  const p = Number(period);
  if (!Number.isFinite(p) || p < 1) return null;
  const c = clock == null ? null : String(clock).trim();
  if (!c) return null;
  return { period: p, clock: c };
}

/**
 * live_state -> the 'Q1'..'Q4' / 'OT' / 'HT' short code every display
 * formatter reads, from EITHER shape a row may hold.
 *
 * TWO SHAPES, ONE OUTPUT. {short, clock} (apiSportsImport.js, and any row
 * this ingest wrote before the CFB live poller existed) is honored as
 * written - that provider hands over its own short code and there is nothing
 * to derive. {period, clock} (liveState() above, the shape actually being
 * written today) has no short code at all, so one is derived here - the SAME
 * derivation cfbScoreboard.js's toLiveState used to perform as a WRITER
 * before this became the one place readers and writers share it.
 *
 * HALFTIME IS PERIOD 2 WITH A ZEROED CLOCK, a sustained state, not an
 * instant: observed on SJSU @ USC 29 Aug holding `period=2 clock="00:00"`
 * for twelve minutes running. Emitting 'Q2' for that window matches none of
 * driveStrip.js's halftime tests, so the strip draws a snap that cannot
 * happen for the whole break - precisely what its halftime mode exists to
 * prevent. PERIOD 2 ONLY: end of regulation is period 4 with the same
 * zeroed clock and is not halftime.
 */
export function shortOf(liveState) {
  if (!liveState) return null;
  if (liveState.short) return String(liveState.short).toUpperCase();
  const p = Number(liveState.period);
  if (!Number.isFinite(p) || p < 1) return null;
  const c = liveState.clock == null || liveState.clock === '' ? null : String(liveState.clock);
  if (p === 2 && (c === '00:00' || c === '0:00')) return 'HT';
  return p <= 4 ? `Q${p}` : 'OT';
}
