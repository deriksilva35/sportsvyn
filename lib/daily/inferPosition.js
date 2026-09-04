// lib/daily/inferPosition.js — the position-inference law for a footballdb
// row with no source position. PURE. BDL rows never reach this: they always
// carry a real nfl_players.position, joined directly at rollup time
// (scripts/bdl-season-totals-backfill.mjs), and a footballdb row that
// resolves to an EXISTING nfl_players identity is scored the same way
// (lib/footballdb/identity.js's resolveIdentity prefers the matched
// player's own position over this inference, every time) - this module is
// the fallback for a footballdb row with no other source of truth at all.
//
// THE DEFECT THIS FIXES. The prior inference (lib/footballdb/identity.js,
// now delegating here) checked "does this row have ANY pass field at all"
// first, unconditionally - a real 1995 running back who threw one trick-
// play pass for 13 yards (Harvey Williams: pass_att=1, pass_yds=13,
// pass_td=1, against rush_att=255, rush_yds=1114) read as a QB, because
// presence alone, not magnitude, decided it. The law below asks which
// SCORING COMPONENT actually dominates the row's OWN daily-format points -
// the same number the board grades on - so the inferred position agrees
// with what a human would call the player off the same box score.
//
// A ROW QUALIFIES FOR EXACTLY ONE POSITION (ruling). No row is ever
// returned eligible for two - the caller does not need to arbitrate.

import { SCORING, RECEPTION_PTS } from '../fantasy/scoring.js';

const n = (x) => Number(x ?? 0) || 0;

function passingPoints(r) {
  return (n(r.passYds) / SCORING.passYdsPerPt) + n(r.passTd) * SCORING.passTd + n(r.passInt) * SCORING.interception;
}
function rushingPoints(r) {
  return (n(r.rushYds) / SCORING.rushYdsPerPt) + n(r.rushTd) * SCORING.rushTd;
}
function receivingPoints(r) {
  return (n(r.recYds) / SCORING.recYdsPerPt) + n(r.recTd) * SCORING.recTd + n(r.rec) * RECEPTION_PTS.daily;
}

/**
 * @param row { passAtt, passYds, passTd, passInt, rushAtt, rushYds, rushTd,
 *              rec, recYds, recTd, fgm, fga, xp } - lib/footballdb/parse.js's
 *              own camelCase shape, the row this always runs on.
 * @returns 'QB'|'RB'|'WR'|'PK'|null - null only for a row with no offensive
 *          or clean-kicking component at all (a Defense-tab-only row).
 */
export function inferPosition(row) {
  const r = row ?? {};
  const pass = passingPoints(r);
  const rush = rushingPoints(r);
  const rec = receivingPoints(r);

  // K: field goal attempts > 0 AND no other component - a pure kicker's
  // row carries nothing offensive at all under this source.
  const hasFga = n(r.fga) > 0 || n(r.fgm) > 0;
  if (hasFga && pass === 0 && rush === 0 && rec === 0) return 'PK';

  // QB is only a CANDIDATE at 100+ pass attempts - a token trick-play pass
  // never enters the largest-component comparison at all, regardless of
  // how its points happen to compare.
  const qbEligible = n(r.passAtt) >= 100;
  const candidates = [
    qbEligible ? { pos: 'QB', pts: pass } : null,
    { pos: 'RB', pts: rush },
    { pos: 'WR', pts: rec }, // TE folded into WR, per the standing ruling
  ].filter((c) => c && c.pts > 0);

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.pts - a.pts);
  return candidates[0].pos;
}
