// lib/gridiron/driveStrip.js - the DriveStrip's geometry, vocabulary and states.
//
// THE FIELD IS 120 UNITS: 100 yards of play plus a 10-yard end zone at each
// end. Every horizontal position on the strip is a percentage of that, and the
// numbers are not invented - they are read back off the mock. The mock draws
// its 50 at left:50.00%, its own-10 at 16.67%, a ball at 63.33% for PHI holding
// at DAL 34, and the to-go line at 69.17% for 2nd & 7. pctForAbsolute() below
// reproduces all four exactly, which is why this file, not a stylesheet, owns
// field placement.
//
// ORIENTATION, FIXED AND STATED: the LEFT end zone belongs to the HOME team,
// the RIGHT to the AWAY team. Home therefore attacks rightward. The mock draws
// its left zone as PHI (home) and its right as DAL (away) and moves PHI's drive
// left-to-right, so this is the mock's own convention, not a choice made here.

export const FIELD_UNITS = 120;          // 100 playing yards + 2 x 10 end zone
export const ENDZONE_PCT = (10 / FIELD_UNITS) * 100;   // 8.333…%
export const YARD_PCT = (1 / FIELD_UNITS) * 100;       // 0.8333…%

/** A yard line measured from the LEFT goal line, as a percentage of the strip. */
export function pctForAbsolute(absYardFromLeftGoal) {
  const y = Math.max(0, Math.min(100, Number(absYardFromLeftGoal)));
  return ((10 + y) / FIELD_UNITS) * 100;
}

/**
 * yards_to_goal is always measured toward the DEFENSE'S end zone. Converting it
 * to a fixed-field position therefore needs to know which way the offense is
 * pointing, and nothing else.
 */
export function absoluteYardFromLeft(offenseIsHome, yardsToGoal) {
  if (yardsToGoal == null) return null;
  const ytg = Math.max(0, Math.min(100, Number(yardsToGoal)));
  return offenseIsHome ? 100 - ytg : ytg;
}

/** Ball spot, first-down marker and the drive's travelled span, all in %. */
export function stripGeometry({ offenseIsHome, yardsToGoal, distance, driveStartYardsToGoal }) {
  const ballAbs = absoluteYardFromLeft(offenseIsHome, yardsToGoal);
  if (ballAbs == null) return null;
  const ball = pctForAbsolute(ballAbs);

  // The to-go line sits `distance` yards downfield of the spot. Goal-to-go has
  // no marker of its own - the goal line already is one.
  let toGo = null;
  if (distance != null && yardsToGoal != null && distance < yardsToGoal) {
    toGo = pctForAbsolute(absoluteYardFromLeft(offenseIsHome, yardsToGoal - distance));
  }

  let drive = null;
  if (driveStartYardsToGoal != null) {
    const startAbs = absoluteYardFromLeft(offenseIsHome, driveStartYardsToGoal);
    const left = Math.min(startAbs, ballAbs);
    const right = Math.max(startAbs, ballAbs);
    drive = { left: pctForAbsolute(left), width: pctForAbsolute(right) - pctForAbsolute(left) };
  }
  return { ball, toGo, drive };
}

const ORDINAL = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };

/** "2nd & 7", "1st & G", or null when the provider gave us no down at all. */
export function downDistanceLabel(down, distance, yardsToGoal) {
  const o = ORDINAL[Number(down)];
  if (!o) return null;
  if (distance == null) return o;
  const goalToGo = yardsToGoal != null && distance >= yardsToGoal;
  return `${o} & ${goalToGo ? 'G' : distance}`;
}

/** "DAL 34", "PHI 48", "50" - whose half of the field the ball sits on. */
export function spotLabel(yardsToGoal, offenseAbbr, defenseAbbr) {
  if (yardsToGoal == null) return null;
  const ytg = Number(yardsToGoal);
  if (ytg === 50) return '50';
  return ytg > 50 ? `${offenseAbbr ?? ''} ${100 - ytg}`.trim()
    : `${defenseAbbr ?? ''} ${ytg}`.trim();
}

/**
 * THE STATE MACHINE, per the recon's honest-gap contract. The strip never
 * guesses: when the plays feed has told us nothing, the strip says so and the
 * score header carries on above it.
 *
 *   none      - nothing to draw (game not started, or final with no feed)
 *   pending   - live, but no plays have arrived. The honest gap.
 *   halftime  - live between halves. Drops the field rather than draw a stale ball.
 *   between   - live, no live down/distance. Field stays, ball does not.
 *   live      - live with a ball to place.
 *   final     - retired strip; the drive chart is the whole story.
 *
 * NOTE ON WHAT IS PROVEN: `final` and `pending` are exercised against real
 * completed games. `live`, `halftime` and `between` are reachable in code and
 * unit-tested, but no live game has driven them yet - that waits on the Aug 29
 * CFB window. Nothing here claims otherwise.
 */
export function gamecastState({ status, playCount = 0, lastPlay = null, liveState = null }) {
  const s = String(status ?? '');
  if (s === 'final') return playCount > 0 ? { mode: 'final' } : { mode: 'none', reason: 'no_plays' };
  if (s !== 'live') return { mode: 'none', reason: 'not_started' };
  if (!playCount) return { mode: 'pending' };

  const period = liveState?.period ?? lastPlay?.period ?? null;
  const clock = String(liveState?.clock ?? '');
  if (/^half/i.test(String(liveState?.periodLabel ?? '')) || /^HALF$/i.test(clock)) {
    return { mode: 'halftime', period };
  }
  if (lastPlay?.down == null || lastPlay?.yardsToGoal == null) {
    return { mode: 'between', period, lastPlay };
  }
  return { mode: 'live', period, lastPlay };
}

/**
 * The drive chart: newest drive first, exactly as both mock frames order it.
 * Plays inside a drive are newest-first too - the mock's in-progress drive
 * leads with the most recent snap.
 *
 * Takes already-normalised play rows plus the drive envelopes the importer
 * stored. Where a code has no envelope (the NFL's reconstruction), the summary
 * fields are derived from the plays themselves and flagged `derived` so the
 * render can be honest about which numbers are the provider's.
 */
export function buildDriveChart(plays, { drives = [], homeTeamId = null, teamAbbr = new Map(), inProgressDriveId = null } = {}) {
  const byDrive = new Map();
  for (const p of plays ?? []) {
    if (p.driveId == null) continue;
    if (!byDrive.has(p.driveId)) byDrive.set(p.driveId, []);
    byDrive.get(p.driveId).push(p);
  }
  const envelopes = new Map(drives.map((d) => [d.driveId, d]));

  const rows = [...byDrive.entries()].map(([driveId, ps]) => {
    const env = envelopes.get(driveId) ?? null;
    // A drive's offense is the offense of its scrimmage plays, never of a
    // terminal handoff row - see TRAP 2 in plays.js.
    const offenseTeamId = env?.offenseTeamId
      ?? ps.find((p) => p.offenseTeamId != null)?.offenseTeamId ?? null;
    const first = ps[0];
    const last = ps.at(-1);
    return {
      driveId,
      driveNumber: env?.driveNumber ?? first?.driveNumber ?? null,
      offenseTeamId,
      offenseAbbr: teamAbbr.get(offenseTeamId) ?? null,
      offenseIsHome: offenseTeamId != null && offenseTeamId === homeTeamId,
      // A DRIVE STILL BEING PLAYED HAS NOT HAPPENED YET. The stored envelope
      // knows how it ended, because the game is over in the table - but a strip
      // showing the state as of play 40 must not tag the live drive
      // "Touchdown" before the touchdown. The mock labels it "In progress" and
      // so does this.
      result: driveId === inProgressDriveId ? 'In progress' : (env?.result ?? null),
      playCount: env?.playCount ?? ps.length,
      yards: env?.yards ?? null,
      duration: env?.duration ?? null,
      startYardsToGoal: env?.startYardsToGoal ?? first?.yardsToGoal ?? null,
      endPeriod: env?.endPeriod ?? last?.period ?? null,
      endClock: env?.endClock ?? last?.clock ?? null,
      derived: !env,
      plays: [...ps].reverse(),
    };
  });
  rows.sort((a, b) => (b.driveNumber ?? 0) - (a.driveNumber ?? 0));
  return rows;
}

/** "9 plays · 74 yds · 4:51 · started PHI 26" - the mock's drive sub-line. */
export function driveSubLine(row, defenseAbbr) {
  const bits = [];
  if (row.playCount != null) bits.push(`${row.playCount} play${row.playCount === 1 ? '' : 's'}`);
  if (row.yards != null) bits.push(`${row.yards} yds`);
  if (row.duration) bits.push(row.duration);
  const spot = spotLabel(row.startYardsToGoal, row.offenseAbbr, defenseAbbr);
  if (spot) bits.push(`started ${spot}`);
  return bits.join(' · ');
}

/**
 * MID-GAME SIMULATION, and precisely what it proves.
 *
 * Truncating a completed game's play list to its first N plays produces exactly
 * the state the strip would have held at that moment: a ball spot, a to-go
 * line, a drive in progress, a last play. Rendering that PROVES THE VISUAL
 * COMPONENT - geometry, states, drive assembly - against real data.
 *
 * IT PROVES NOTHING ABOUT LIVE POLLING. No cadence, no mid-game feed latency,
 * no partial-drive arrival, no clock drift is exercised here; the plays are
 * already in the table and complete. Whether /live/plays populates DURING a
 * game is the Aug 29 CFB rehearsal's question and is not answered by this.
 */
export function simulateAsOf(plays, n) {
  const list = plays ?? [];
  if (n == null) return { plays: list, simulated: false, ofTotal: list.length };
  const cut = Math.max(1, Math.min(list.length, Number(n)));
  return { plays: list.slice(0, cut), simulated: true, asOf: cut, ofTotal: list.length };
}

/** The last play that actually had a ball on the field - skips admin rows. */
export function lastLivePlay(plays) {
  for (let i = (plays?.length ?? 0) - 1; i >= 0; i--) {
    const p = plays[i];
    if (p.yardsToGoal != null && p.down != null) return p;
  }
  return null;
}
