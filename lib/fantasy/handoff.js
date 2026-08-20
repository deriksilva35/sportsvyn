// lib/fantasy/handoff.js - the Mock -> Tracker config handoff, as URLs. PURE.
//
// One tap on the Mock's setup screen carries the CURRENT config into the
// Tracker's setup: teams, scoring, roster, bench. The scoresNav law applies
// verbatim - one builder, one parser, round-tripped in tests - because a
// handoff that can produce state the tracker cannot read is worse than no
// handoff: it LOOKS carried and silently reverts to defaults.
//
// The seat is deliberately NOT carried: the Mock has no concept of where you
// sit in your real league; asking on the Tracker side is the point of the
// Tracker's setup.
//
// Roster wire format: "QB1-RB2-WR2-TE1-FLEX1-DST1-K1-BN6" - readable in a
// URL bar, order-free on parse, keys validated against SLOT_KEYS and counts
// clamped to SLOT_BOUNDS. Anything malformed returns null WHOLE: a handoff
// is all-or-nothing, because half a config is a lie about the other half.

import { SLOT_KEYS, SLOT_BOUNDS, SCORING_FORMATS, TEAMS_MIN, TEAMS_MAX } from './config.js';

/** Build /sim/tracker?from=mock&... from a live Mock config. */
export function trackerHandoffHref(config) {
  const p = new URLSearchParams();
  p.set('from', 'mock');
  p.set('teams', String(config?.teamsCount ?? ''));
  p.set('scoring', String(config?.scoringFormat ?? ''));
  const roster = Object.entries(config?.rosterSlots ?? {})
    .filter(([k, v]) => SLOT_KEYS.includes(k) && Number(v) > 0)
    .map(([k, v]) => `${k}${v}`)
    .join('-');
  p.set('roster', roster);
  return `/sim/tracker?${p.toString()}`;
}

/**
 * Parse the handoff back out of searchParams.
 * @returns {{teamsCount:number, scoringFormat:string, rosterSlots:object}|null}
 *   null unless EVERY part validates - all-or-nothing by design.
 */
export function parseTrackerHandoff(sp = {}) {
  const one = (v) => (Array.isArray(v) ? v[0] : v);
  if (one(sp.from) !== 'mock') return null;

  const teams = Number(one(sp.teams));
  if (!Number.isInteger(teams) || teams < TEAMS_MIN || teams > TEAMS_MAX) return null;

  const scoring = one(sp.scoring);
  if (!SCORING_FORMATS.includes(scoring)) return null;

  const raw = String(one(sp.roster) ?? '');
  if (!raw) return null;
  const rosterSlots = {};
  for (const part of raw.split('-')) {
    const m = /^([A-Z]+)(\d{1,2})$/.exec(part);
    if (!m) return null;
    const [, k, n] = m;
    if (!SLOT_KEYS.includes(k) || rosterSlots[k] != null) return null;
    const count = Number(n);
    const [lo, hi] = SLOT_BOUNDS[k];
    if (count < Math.max(1, lo) || count > hi) return null;
    rosterSlots[k] = count;
  }
  if (Object.keys(rosterSlots).length === 0) return null;

  return { teamsCount: teams, scoringFormat: scoring, rosterSlots };
}
