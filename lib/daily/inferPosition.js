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
//
// AMENDMENT: RB vs WR is decided by TOUCHES, not points. Points measure
// production; they do not tell you what a player lined up as - a 50-catch,
// 6-carry receiver and a 50-carry, 6-catch runner can score identically on a
// given box score and still be two different positions. rushAtt vs rec is
// the same signal a human reads off the tab a player's row lives on. QB
// stays exactly as before (100+ pass attempts, and passing must still be the
// largest of the three scoring components) - the gate is about a real
// starting quarterback, not a touch count.

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

  const rushAtt = n(r.rushAtt);
  const recCt = n(r.rec);
  const passAtt = n(r.passAtt);

  // NO TOUCHES AT ALL, BUT A REAL PASS ATTEMPT EXISTS -> QB, regardless of
  // the 100-attempt floor (amendment). The floor exists to keep a token
  // trick-play pass from outscoring REAL rushing/receiving usage; with zero
  // touches to compete against, there is nothing left for the floor to
  // protect against - a backup QB who went 0-for-1 for zero yards has zero
  // passing POINTS, so the points-based gate below would never call him a
  // QB, even though the pass attempt is the only real signal on the row and
  // it is a real one. This is the ONLY law-driven route to QB below 100
  // attempts.
  if (rushAtt === 0 && recCt === 0 && passAtt > 0) return 'QB';

  // QB is otherwise only a CANDIDATE at 100+ pass attempts, and only WINS
  // if passing is still the largest of the three scoring components -
  // unchanged from before this amendment.
  const qbEligible = passAtt >= 100 && pass > rush && pass > rec;
  if (qbEligible) return 'QB';

  // RB vs WR: touches, not points. rushAtt > rec -> RB; rec >= rushAtt -> WR
  // (TE folded into WR, per the standing ruling; the >= break also means a
  // dead-even touch count never leaves this unresolved).
  if (rushAtt === 0 && recCt === 0) return null; // no pass attempts, no touches, no kicks - the only case still null
  return rushAtt > recCt ? 'RB' : 'WR';
}
