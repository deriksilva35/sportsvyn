// lib/mockNba/setupChoice.js - the "League setup" dropdown's logic (mon-2). PURE, browser + server.
//
// The dropdown lists the reader's SAVED setups first, then the presets (a preset
// sets scoring + roster together - and the team count when it names one - leaving
// slot and clock alone),
// then "Custom". What it shows is derived from the current settings: the saved
// setup they equal, else the preset whose scoring and roster they use, else the
// saved setup last chosen marked "edited", else Custom.

import * as NBA from './settings.js';
import * as NFL from '../mockNfl/settings.js';

export const MAX_SETUPS = 10;
export const NAME_MAX = 40;

/** A name as stored: trimmed, inner spaces collapsed, 1-40 characters - or null. */
export function cleanName(raw) {
  const n = String(raw ?? '').replace(/\s+/g, ' ').trim();
  return n && n.length <= NAME_MAX ? n : null;
}

/** The words for a refused save / rename / delete. */
export const REASON_COPY = Object.freeze({
  bad_name: `Give it a name (up to ${NAME_MAX} characters).`,
  limit: `You have ${MAX_SETUPS} saved setups. Delete one to save another.`,
  name_taken: 'You already have a setup with that name.',
  not_found: 'That setup is gone. Reload the page.',
  signed_out: 'Sign in to save your league setup.',
});

// ONE LIST PER SPORT (mon-3): each sport's presets and its settings normaliser.
// A preset sets scoring + roster together; the NFL's Yahoo-style league is Half PPR.
export const SPORTS = Object.freeze({
  nba: Object.freeze({
    presets: Object.freeze({
      espn: Object.freeze({ label: 'ESPN-style league', scoring: 'standard', roster: 'standard' }),
      yahoo: Object.freeze({ label: 'Yahoo-style league', scoring: 'simple', roster: 'twoc' }),
    }),
    normalize: NBA.normalizeSettings, serialize: NBA.serializeSettings,
  }),
  nfl: Object.freeze({
    presets: Object.freeze({
      espn: Object.freeze({ label: 'ESPN-style league', scoring: 'ppr', roster: 'espn' }),
      yahoo: Object.freeze({ label: 'Yahoo-style league', scoring: 'half', roster: 'yahoo' }),
      // THE WEEKLY DRAFT, PRACTISED (tue-0): its 12 teams, PPR and eight slots.
      thedraft: Object.freeze({ label: 'The Draft practice', scoring: 'ppr', roster: 'thedraft', teams: 12 }),
    }),
    normalize: NFL.normalizeSettings, serialize: NFL.serializeSettings,
  }),
});
export const PRESET_SETUPS = SPORTS.nba.presets;
const specOf = (sport) => SPORTS[sport] ?? SPORTS.nba;

/** The settings a choice ('saved:<id>' | 'preset:<key>') produces from `settings`. */
export function applyChoice(settings, choice, setups = [], sport = 'nba') {
  const { presets: PRESET_SETUPS, normalize: normalizeSettings } = specOf(sport);
  const [kind, key] = String(choice ?? '').split(':');
  if (kind === 'saved') {
    const s = setups.find((x) => String(x.id) === key);
    return s ? normalizeSettings(s.settings) : settings;
  }
  if (kind === 'preset' && PRESET_SETUPS[key]) {
    const p = PRESET_SETUPS[key];
    return normalizeSettings({ ...settings, scoring: p.scoring, roster: p.roster, ...(p.teams ? { teams: p.teams } : {}) });
  }
  return settings;
}

/**
 * What the dropdown shows: { value, edited, savedId }. `chosen` is the last
 * choice the reader made ('saved:<id>' etc.), so an edited saved setup stays named.
 */
export function currentChoice(settings, setups = [], chosen = null, sport = 'nba') {
  const { presets: PRESET_SETUPS, serialize: serializeSettings } = specOf(sport);
  const key = serializeSettings(settings);
  const same = setups.find((x) => serializeSettings(x.settings) === key);
  if (same) return { value: `saved:${same.id}`, edited: false, savedId: same.id };
  const [kind, id] = String(chosen ?? '').split(':');
  if (kind === 'saved' && setups.some((x) => String(x.id) === id)) return { value: chosen, edited: true, savedId: Number(id) };
  for (const [k, p] of Object.entries(PRESET_SETUPS)) {
    if (settings.scoring === p.scoring && settings.roster === p.roster && (!p.teams || settings.teams === p.teams)) return { value: `preset:${k}`, edited: false, savedId: null };
  }
  return { value: 'custom', edited: false, savedId: null };
}
