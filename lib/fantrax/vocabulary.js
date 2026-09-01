// lib/fantrax/vocabulary.js — the boundary between Fantrax's words and ours.
// PURE. Every translation lives here so there is one place to read when a
// kicker goes missing.
//
// THERE ARE THREE VOCABULARIES IN PLAY AND THEY ALL DISAGREE:
//     Fantrax   QB RB WR TE RWT K  DST
//     the pool  QB RB WR TE ---  PK DEF   (FFC's words, stored verbatim)
//     the slots QB RB WR TE FLEX K  DST   (engine.js SLOT_KEYS)
// The pool and the slots already translate through engine.js's SCARCE and
// POS_TO_SLOT. This file adds the third leg, and nothing else may.

import { normalizeName } from '../gridiron/nameMatch.js';


/** Fantrax position -> the pool's FFC vocabulary. Used at pool-WRITE time. */
export const TO_POOL_POSITION = Object.freeze({
  QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE',
  K: 'PK',      // FFC calls a kicker PK
  DST: 'DEF',   // FFC calls a team defense DEF
});

export function toPoolPosition(fantraxPos, { isTeamRow = false } = {}) {
  if (isTeamRow) return 'DEF';
  const p = String(fantraxPos ?? '').toUpperCase().trim();
  return TO_POOL_POSITION[p] ?? POOL_ALIAS[p] ?? p;
}

/**
 * "Last, First" -> "First Last", THEN normalizeName.
 *
 * normalizeName IS NOT TOUCHED. It is the same function that writes
 * nfl_players.normalized_name, so changing it would re-key every match already
 * stored - roughly 1,500 pool identities. The reorder is a wrapper, and it
 * belongs to the Fantrax boundary rather than to the matcher, because only
 * Fantrax speaks this way.
 *
 * SPLIT ON THE FIRST COMMA ONLY. "Smith, John Jr." is last "Smith", first
 * "John Jr." - a second comma would be part of the given name, and splitting on
 * all of them would scatter a suffix into the middle of the result.
 */
export function swapLastFirst(raw) {
  const s = String(raw ?? '').trim();
  const i = s.indexOf(',');
  if (i === -1) return s;
  const last = s.slice(0, i).trim();
  const first = s.slice(i + 1).trim();
  if (!last || !first) return s.replace(',', ' ').trim();
  return `${first} ${last}`;
}

/** The display name we store, in the order a reader expects. */
export const displayName = (fantraxName) => swapLastFirst(fantraxName);

/** The key we match on. Reorder first, then the house normalizer. */
export const matchKey = (fantraxName) => normalizeName(swapLastFirst(fantraxName));

/**
 * THE ROSTER SLOTS, in engine vocabulary.
 *
 * RWT IS FLEX, EXACTLY. engine.js:58 is
 * `FLEX_ELIGIBLE = new Set(['RB','WR','TE'])`, which is what RWT means, so the
 * mapping is an identity rather than an approximation - and playerInfo's own
 * eligiblePos strings ("RWT,WR") confirm it from the provider's side.
 *
 * THE BENCH IS DERIVED, NOT READ. Fantrax reports maxTotalPlayers and
 * maxTotalActivePlayers and never names a bench; BN is the difference. Deriving
 * it keeps deriveRounds(slots) equal to maxTotalPlayers, which is what the
 * engine turns into rounds.
 */
export const FANTRAX_TO_SLOT = Object.freeze({
  QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', RWT: 'FLEX', K: 'K', DST: 'DST',
});

export function toRosterSlots(rosterInfo) {
  const pc = rosterInfo?.positionConstraints ?? {};
  const slots = {};
  const unmapped = [];
  for (const [pos, cfg] of Object.entries(pc)) {
    const key = FANTRAX_TO_SLOT[String(pos).toUpperCase()];
    // FAIL LOUD. An unrecognised constraint is a roster shape we cannot honour,
    // and silently dropping it would build a draft with the wrong number of
    // rounds - which looks like a working draft.
    if (!key) { unmapped.push(pos); continue; }
    slots[key] = (slots[key] ?? 0) + (Number(cfg?.maxActive) || 0);
  }
  const active = Object.values(slots).reduce((a, b) => a + b, 0);
  const total = Number(rosterInfo?.maxTotalPlayers) || active;
  const bench = Math.max(0, total - active);
  if (bench) slots.BN = bench;
  return { slots, active, total, unmapped };
}

/**
 * Fantrax scoring -> one of the four values draft_configs' CHECK allows.
 *
 * REJECT RATHER THAN INVENT. draft_configs_scoring_format_check permits
 * ppr / half-ppr / standard / 2qb and nothing else, so a league that maps to
 * none of them must produce a readable error here - not a constraint violation
 * three statements later, and never a fifth value smuggled past the check.
 */
export const SCORING_FORMATS = Object.freeze(['ppr', 'half-ppr', 'standard', '2qb']);

export function toScoringFormat(leagueInfo) {
  const type = leagueInfo?.scoringSystem?.type ?? null;
  if (type !== 'HEAD_TO_HEAD_POINTS_BASED') {
    return { ok: false, error: `Unsupported Fantrax scoring system "${type ?? 'none'}". Sportsvyn drafts run on points leagues.` };
  }
  // TWO QB SLOTS IS A DIFFERENT POOL, not a different scoring rule, and FFC
  // prices it separately - so it wins over ppr when both are true.
  const qb = Number(leagueInfo?.rosterInfo?.positionConstraints?.QB?.maxActive) || 0;
  const sf = Number(leagueInfo?.rosterInfo?.positionConstraints?.SUPERFLEX?.maxActive) || 0;
  if (qb + sf >= 2) return { ok: true, format: '2qb' };
  if (leagueInfo?.ppr === true) return { ok: true, format: 'ppr' };
  if (leagueInfo?.ppr === false) return { ok: true, format: 'standard' };
  return { ok: false, error: 'Could not read this league\'s PPR setting.' };
}

/**
 * THE POSITIONS A LEAGUE CAN ACTUALLY ROSTER, in pool vocabulary.
 *
 * FANTRAX'S ADP FEED IS NOT OFFENCE-ONLY. Measured on the real import: 853
 * rows carrying LB 75, S 60, CB 50, DT 45, P 40, DE 35, DL 28, OLB 17, DB 11
 * and TQB 23 - an IDP-capable list, served to a league whose
 * positionConstraints name QB, RB, WR, TE, RWT, K and DST and nothing else.
 *
 * WRITING THEM ANYWAY IS NOT HARMLESS. A linebacker has no dedicated slot, is
 * not FLEX-eligible and can only ever land on a bench, so the AI eventually
 * reaches a seat where every legal option is exhausted and the draft dies -
 * measured, "no legal pick at overall 193". The pool has to be the league's
 * pool, not the provider's whole universe.
 *
 * DERIVED FROM THE SLOTS, NOT HARDCODED. A league that one day adds an IDP
 * slot gets those players back without anyone remembering to edit a list.
 */
const SLOT_TO_POOL = Object.freeze({
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'],
  FLEX: ['RB', 'WR', 'TE'], SUPERFLEX: ['QB', 'RB', 'WR', 'TE'],
  K: ['PK'], DST: ['DEF'],
});

export function draftablePositions(slots) {
  const out = new Set();
  for (const [key, n] of Object.entries(slots ?? {})) {
    if (!n) continue;
    for (const p of SLOT_TO_POOL[key] ?? []) out.add(p);
  }
  return out;
}

/**
 * Positions that are the same player wearing a different label.
 * FB is a running back everywhere that matters, and ffcPosition already says so.
 */
export const POOL_ALIAS = Object.freeze({ FB: 'RB' });
