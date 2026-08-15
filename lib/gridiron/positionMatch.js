// lib/gridiron/positionMatch.js - which BDL player is this nflverse name?
//
// PURE. Candidates in, a decision out. No database, no network - the resolution
// order is the whole design, and a design you can only exercise against a
// 17,000-row table is a design nobody checks.
//
// ============================================================================
// RESOLUTION ORDER
// ============================================================================
//   1. OVERRIDE   a human-confirmed mapping. Always wins, never second-guessed.
//   2. UNIQUE     exactly one BDL player with stat rows that season shares the
//                 normalized name.
//   3. TEAM       several share it; exactly one played for a team the nflverse
//                 roster stint also lists. Team comes from the STAT ROWS, which
//                 are per-game and correct for trades - never from
//                 nfl_players.team_id, which holds a retired player's LAST team
//                 (Greg Jennings reads MIN, not the GB anyone remembers).
//   4. PROFILE    still several; separate on what the stat line SHAPE says the
//                 player did, against the position nflverse claims. This is the
//                 Michael Carter (RB) vs Michael Carter II (CB) case: same
//                 team, same seasons, and a normalization that strips the II
//                 collapses them. A running back has carries; a corner does
//                 not. If the profile does not separate them, fall to birth
//                 date and career bounds.
//   5. REFUSE     emitted as unresolved. Never guessed.
//
// ============================================================================
// THE SUFFIX RULE
// ============================================================================
// normalizeName() in nameMatch.js strips ONE trailing jr|sr|ii|iii|iv - and NOT
// V, which is how William Fuller V and David Sills V reached the exit gate's
// miss list. It is also what collapses Michael Carter and Michael Carter II.
//
// normalizeName() IS NOT TOUCHED. The sim's pool matcher depends on its exact
// behaviour and 231 live players resolve through it; changing it to fix a
// historical import would be repairing the roof by moving the house.
//
// Instead the matcher normalizes LOCALLY and SUFFIX-AWARE: it compares
// suffix-preserving first, so "michael carter ii" and "michael carter" are
// different keys, and only falls back to the stripped comparison when the
// suffix-aware pass found nothing at all. Strictest match first, loosest last.

import { ffcPosition } from './nameMatch.js';

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

/** Diacritic-stripped, de-punctuated, lowercased. Suffix RETAINED. */
export function normalizeSuffixAware(raw) {
  return String(raw ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim().replace(/\s+/g, ' ');
}

/** The same, with ONE trailing generational suffix removed - including V. */
export function normalizeSuffixStripped(raw) {
  const parts = normalizeSuffixAware(raw).split(' ');
  if (parts.length > 1 && SUFFIXES.has(parts[parts.length - 1])) parts.pop();
  return parts.join(' ');
}

/**
 * Our vocabulary. nflverse says K, the pool says PK; QB/RB/WR/TE pass straight
 * through. Everything else is stored as nflverse spelled it - the puzzle reads
 * only the five, and inventing a mapping for a nose tackle would be inventing
 * a fact.
 */
export function toOurPosition(nflversePosition) {
  const p = String(nflversePosition ?? '').toUpperCase();
  if (!p) return null;
  if (p === 'K' || p === 'PK') return 'PK';
  if (['QB', 'RB', 'WR', 'TE', 'FB'].includes(p)) return ffcPosition(p); // FB -> RB
  return p;
}

// ---------------------------------------------------------------------------
// Position profile — what the stat line says the player actually did
// ---------------------------------------------------------------------------
// Deliberately coarse. It exists to separate a running back from a cornerback,
// not to re-derive a depth chart, and a coarse rule that is right is worth more
// than a precise one that is confident.
export function profileOf(totals) {
  const t = totals ?? {};
  const pass = Number(t.pass_att ?? 0);
  const rush = Number(t.rush_att ?? 0);
  const rec = Number(t.rec ?? 0);
  const fga = Number(t.fga ?? 0);
  const touches = pass + rush + rec + fga;
  if (touches === 0) return null;              // no offensive shape to read
  if (fga > 0 && touches === fga) return 'PK';
  if (pass >= 10 && pass >= rush + rec) return 'QB';
  if (rush > rec) return 'RB';
  if (rec > 0) return 'WR/TE';                 // the box score cannot split these
  return null;
}

/** Does a candidate's stat shape agree with the position nflverse claims? */
export function profileAgrees(claimed, totals) {
  const prof = profileOf(totals);
  if (!prof) return false;
  const c = toOurPosition(claimed);
  if (prof === 'WR/TE') return c === 'WR' || c === 'TE';
  return prof === c;
}

/**
 * Resolve ONE nflverse player-season against BDL candidates.
 *
 * @param {object} nv          { name, gsis, position, teams:Set, birthDate, rookie, last }
 * @param {Array}  candidates  BDL players WITH stat rows that season:
 *                             { id, fullName, teams:string[], totals:{}, birthDate? }
 * @param {Map}    overrides   normalizedSuffixAware(bdl name) -> { gsis } confirmed
 * @returns {{ ok: boolean, playerId?: number, rule?: string, reason?: string, candidates?: number }}
 */
export function resolveOne(nv, candidates, overrides = new Map()) {
  // 1. OVERRIDE
  for (const c of candidates) {
    const ov = overrides.get(normalizeSuffixAware(c.fullName));
    if (ov && ov.gsis === nv.gsis) return { ok: true, playerId: c.id, rule: 'override' };
  }

  // 2. UNIQUE — suffix-aware first, stripped only if that found nothing.
  const wantAware = normalizeSuffixAware(nv.name);
  let hits = candidates.filter((c) => normalizeSuffixAware(c.fullName) === wantAware);
  let via = 'aware';
  if (hits.length === 0) {
    const wantStripped = normalizeSuffixStripped(nv.name);
    hits = candidates.filter((c) => normalizeSuffixStripped(c.fullName) === wantStripped);
    via = 'stripped';
  }
  if (hits.length === 0) return { ok: false, reason: 'no name match', candidates: 0 };
  if (hits.length === 1) return { ok: true, playerId: hits[0].id, rule: 'unique', via };

  // 3. TEAM — stat-row teams against the roster stint's teams.
  const want = nv.teams ?? new Set();
  const byTeam = hits.filter((c) => (c.teams ?? []).some((t) => want.has(t)));
  if (byTeam.length === 1) return { ok: true, playerId: byTeam[0].id, rule: 'team' };
  const pool = byTeam.length > 1 ? byTeam : hits;

  // 4. PROFILE — then birth date / career bounds.
  const byProfile = pool.filter((c) => profileAgrees(nv.position, c.totals));
  if (byProfile.length === 1) return { ok: true, playerId: byProfile[0].id, rule: 'profile' };

  if (nv.birthDate) {
    const byBirth = (byProfile.length ? byProfile : pool).filter((c) => c.birthDate && c.birthDate === nv.birthDate);
    if (byBirth.length === 1) return { ok: true, playerId: byBirth[0].id, rule: 'profile' };
  }

  return {
    ok: false,
    reason: byProfile.length > 1 ? 'ambiguous: profile did not separate' : 'ambiguous: no rule separated',
    candidates: pool.length,
  };
}
