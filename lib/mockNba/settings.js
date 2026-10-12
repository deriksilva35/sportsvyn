// lib/mockNba/settings.js - the NBA mock's setup, normalised (sun-7). PURE.
//
// One shape for the setup screen, the saved settings (an account row for a signed-
// in reader, localStorage for a guest) and the draft itself. normalizeSettings
// accepts anything - an old save, a hand-edited localStorage value - and returns a
// valid setup, falling back field by field to the defaults.

import { SCORING_PRESETS, STATS, POINTS_LEAGUE, cleanWeight } from './scoring.js';
import { ROSTER_PRESETS, SLOT_KEYS, SLOT_MAX, slotsFromCounts } from './roster.js';

export const TEAMS_MIN = 8;
export const TEAMS_MAX = 14;
export const CLOCKS = Object.freeze([0, 30, 60]);
export const STORAGE_KEY = 'sv.mockNba.settings.v1';

export const DEFAULT_SETTINGS = Object.freeze({
  teams: 12,
  seat: 'random',
  scoring: 'standard',
  customWeights: { ...POINTS_LEAGUE },
  roster: 'standard',
  customCounts: { ...ROSTER_PRESETS.standard.counts },
  clock: 0,
});

const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };

export function normalizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const teams = int(r.teams, TEAMS_MIN, TEAMS_MAX, DEFAULT_SETTINGS.teams);
  const seat = r.seat === 'random' ? 'random' : (int(r.seat, 1, teams, null) ?? 'random');
  const scoring = [...Object.keys(SCORING_PRESETS), 'custom'].includes(r.scoring) ? r.scoring : DEFAULT_SETTINGS.scoring;
  const customWeights = Object.fromEntries(STATS.map(({ key }) => [key, r.customWeights && key in r.customWeights ? cleanWeight(r.customWeights[key]) : POINTS_LEAGUE[key]]));
  const roster = [...Object.keys(ROSTER_PRESETS), 'custom'].includes(r.roster) ? r.roster : DEFAULT_SETTINGS.roster;
  const customCounts = Object.fromEntries(SLOT_KEYS.map((k) => [k, int(r.customCounts?.[k], 0, SLOT_MAX, ROSTER_PRESETS.standard.counts[k])]));
  const clock = CLOCKS.includes(Number(r.clock)) ? Number(r.clock) : DEFAULT_SETTINGS.clock;
  return { teams, seat, scoring, customWeights, roster, customCounts, clock };
}

/** The scoring weights a setup means. */
export const weightsOf = (s) => (s.scoring === 'custom' ? s.customWeights : SCORING_PRESETS[s.scoring].weights);
/** The slot counts a setup means. */
export const countsOf = (s) => (s.roster === 'custom' ? s.customCounts : ROSTER_PRESETS[s.roster].counts);
/** The slot list (rounds = its length). */
export const slotsOf = (s) => slotsFromCounts(countsOf(s));

/** For storage: JSON in, settings out - never throws. */
export const serializeSettings = (s) => JSON.stringify(normalizeSettings(s));
export function parseSettings(text) {
  try { return normalizeSettings(JSON.parse(text)); } catch { return normalizeSettings(null); }
}
