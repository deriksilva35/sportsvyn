// lib/mockNfl/settings.js - the NFL mock's setup, normalised (mon-3). PURE.
// The NBA mock's shape (lib/mockNba/settings.js) with the NFL's scoring and roster.

import { SCORING_PRESETS, STATS, PPR, cleanWeight } from './scoring.js';
import { ROSTER_PRESETS, SLOT_KEYS, SLOT_MAX, BENCH_MAX, slotsFromCounts } from './roster.js';

export const TEAMS_MIN = 8;
export const TEAMS_MAX = 14;
export const CLOCKS = Object.freeze([0, 30, 60]);
export const STORAGE_KEY = 'sv.mockNfl.settings.v1';

export const DEFAULT_SETTINGS = Object.freeze({
  teams: 12, seat: 'random', scoring: 'ppr', customWeights: { ...PPR },
  roster: 'espn', customCounts: { ...ROSTER_PRESETS.espn.counts, SFLX: 0 }, clock: 0,
  // FULL AUTO (tue-0): every pick automatic - the room plays itself to the result.
  fullAuto: false,
});

const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };

export function normalizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const teams = int(r.teams, TEAMS_MIN, TEAMS_MAX, DEFAULT_SETTINGS.teams);
  const seat = r.seat === 'random' ? 'random' : (int(r.seat, 1, teams, null) ?? 'random');
  const scoring = [...Object.keys(SCORING_PRESETS), 'custom'].includes(r.scoring) ? r.scoring : DEFAULT_SETTINGS.scoring;
  const customWeights = Object.fromEntries(STATS.map(({ key }) => [key, r.customWeights && key in r.customWeights ? cleanWeight(r.customWeights[key]) : PPR[key]]));
  const roster = [...Object.keys(ROSTER_PRESETS), 'custom'].includes(r.roster) ? r.roster : DEFAULT_SETTINGS.roster;
  const customCounts = Object.fromEntries(SLOT_KEYS.map((k) => [k, int(r.customCounts?.[k], 0, k === 'BN' ? BENCH_MAX : SLOT_MAX, ROSTER_PRESETS.espn.counts[k] ?? 0)]));
  const clock = CLOCKS.includes(Number(r.clock)) ? Number(r.clock) : DEFAULT_SETTINGS.clock;
  const fullAuto = r.fullAuto === true;
  return { teams, seat, scoring, customWeights, roster, customCounts, clock, fullAuto };
}

export const weightsOf = (s) => (s.scoring === 'custom' ? s.customWeights : SCORING_PRESETS[s.scoring].weights);
export const countsOf = (s) => (s.roster === 'custom' ? s.customCounts : ROSTER_PRESETS[s.roster].counts);
export const slotsOf = (s) => slotsFromCounts(countsOf(s));
export const serializeSettings = (s) => JSON.stringify(normalizeSettings(s));
export function parseSettings(text) {
  try { return normalizeSettings(JSON.parse(text)); } catch { return normalizeSettings(null); }
}
