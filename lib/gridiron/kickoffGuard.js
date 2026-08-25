// lib/gridiron/kickoffGuard.js - refuse the ET/UTC-mislabel kickoff drift.
//
// WHAT HAPPENED, 25 Aug 2026. Between 13:23Z and 16:30Z, CFBD's
// /games?year=2026&week=1 began serving every Week 1 kickoff four hours early:
// North Carolina @ TCU went from 16:00Z to 12:00Z, and all eight of Saturday's
// board games moved by exactly -4h. The Odds API - an independent feed - still
// said 16:00Z, 19:00Z, 19:30Z, 02:00Z for the four cross-checked, matching the
// Pick'em board's frozen snapshot. So the provider was wrong, not us: it had
// re-published Eastern-local times labelled as UTC.
//
// Our ingest was blameless. toUtc('cfbd') passes an already-UTC ISO string
// straight through, which is correct - there is no parsing bug to fix. The
// failure mode is a provider publishing a WRONG VALUE in the RIGHT FORMAT, and
// no amount of care at the parsing boundary catches that.
//
// So the guard is not about parsing. It is about REVISIONS: a scheduled game
// whose kickoff suddenly moves by exactly a US-Eastern offset, days before it
// is played, is far more likely to be a mislabel than a reschedule. We keep
// what we have and shout.
//
// THE COST IS ACKNOWLEDGED. A genuine 4h or 5h reschedule inside the window is
// refused too, and needs a human to release it. Those are rare - a network
// moving a game a whole afternoon in the final week is news - and the alert
// makes the refusal visible the same day. A silently corrupted Saturday is the
// worse trade: it moved every live window four hours off, which would have
// taken score polling cold at almost exactly kickoff.

/** US Eastern is UTC-4 (EDT) or UTC-5 (EST). Those are the drifts we refuse. */
export const DRIFT_HOURS = Object.freeze([4, 5]);

/**
 * Tolerance in hours. The observed drift was exact to the second, but a
 * provider that also rounds to the nearest five minutes would slip past an
 * equality check, so a small band is allowed. Kept tight deliberately: at 0.5h
 * this would start swallowing real 4.5-hour reschedules.
 */
export const DRIFT_TOLERANCE_HOURS = 0.1;   // 6 minutes

/**
 * How close to kickoff the guard applies.
 *
 * SEVEN DAYS, and I would not go wider. Long-lead schedule changes are
 * ordinary - kickoff times for a whole season get set, moved and finalised
 * months out, and plenty of those legitimately shift by four hours when a TV
 * window is assigned. Refusing those would fight the provider's normal
 * behaviour and train everyone to ignore the alert. Inside a week, a
 * four-hour move is genuinely exceptional, which is exactly when a refusal is
 * cheap and a corruption is expensive.
 */
export const GUARD_WINDOW_DAYS = 7;

/**
 * Should this kickoff revision be refused?
 *
 * @param current   the kickoff we already hold (ISO string or Date), or null
 * @param incoming  the kickoff the provider is now claiming
 * @param status    the row's CURRENT status - only 'scheduled' games are guarded
 * @param now       clock, injectable for tests
 * @returns { refuse, deltaHours, reason }
 */
export function inspectKickoffRevision({ current, incoming, status, now = new Date() }) {
  // Nothing to protect: a brand-new row has no value worth keeping.
  if (current == null || incoming == null) return { refuse: false, reason: 'no_current' };

  // A game already under way or finished should not be having its kickoff
  // revised at all, and its live window no longer depends on the value.
  if (status !== 'scheduled') return { refuse: false, reason: 'not_scheduled' };

  const cur = new Date(current).getTime();
  const inc = new Date(incoming).getTime();
  if (!Number.isFinite(cur) || !Number.isFinite(inc)) return { refuse: false, reason: 'unparseable' };

  const deltaHours = (inc - cur) / 3_600_000;
  if (deltaHours === 0) return { refuse: false, deltaHours, reason: 'unchanged' };

  // Only inside the window, measured from the kickoff we currently believe.
  const daysOut = (cur - now.getTime()) / 86_400_000;
  if (daysOut > GUARD_WINDOW_DAYS) return { refuse: false, deltaHours, reason: 'outside_window' };
  // A kickoff already in the past cannot be usefully revised either way, but it
  // is also not the corruption this guards - leave it alone.
  if (daysOut < 0) return { refuse: false, deltaHours, reason: 'already_passed' };

  const magnitude = Math.abs(deltaHours);
  const matched = DRIFT_HOURS.find((h) => Math.abs(magnitude - h) <= DRIFT_TOLERANCE_HOURS);
  if (matched == null) return { refuse: false, deltaHours, reason: 'not_drift_shaped' };

  return { refuse: true, deltaHours, matchedOffset: matched, daysOut, reason: 'et_utc_drift' };
}

/** A refusal, in the one shape the ledger and the alert body both read. */
export function describeRefusal({ slug, current, incoming, deltaHours }) {
  const iso = (d) => new Date(d).toISOString();
  return {
    slug,
    kept: iso(current),
    refused: iso(incoming),
    delta_hours: Number(deltaHours.toFixed(2)),
  };
}

/**
 * The alert body. Names every affected game with old, new and delta - the
 * relay's requirement, and the difference between an alert someone can act on
 * and one they have to go digging behind.
 */
export function refusalAlertBody({ source, refusals }) {
  const lines = refusals.map((r) =>
    `  ${r.slug}\n    kept    ${r.kept}\n    refused ${r.refused}  (${r.delta_hours > 0 ? '+' : ''}${r.delta_hours}h)`);
  return [
    `source: ${source}`,
    `${refusals.length} kickoff revision(s) refused as ET/UTC-mislabel drift.`,
    '',
    'The stored kickoff was KEPT. If one of these is a genuine reschedule,',
    'release it by updating matches.kickoff_at by hand; the guard only refuses',
    `revisions of about ${DRIFT_HOURS.join('h or ')}h within ${GUARD_WINDOW_DAYS} days of kickoff.`,
    '',
    ...lines,
  ].join('\n');
}
