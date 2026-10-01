// lib/eplWeekly5/scoring.js - EPL Weekly 5's points, PURE (ruled thu-13).
//
//   appearance        60+ min 2, under 60 min 1 (0 min: nothing)
//   goal              DEF/GK 6, MID 5, FWD 4
//   assist            3
//   clean sheet       DEF/GK 4, MID 1 - only with 60+ min, and only if his
//                     team conceded nothing WHILE HE WAS ON THE PITCH
//   GK saves          1 per 3 saves
//   penalty save      5
//   yellow -1, red -3, own goal -2, penalty miss -2
//
// ONE FUNCTION SCORES THE CARD, THE LIVE CHIPS, THE POOL'S PTS/GAME AND THE
// SETTLE - so the number a reader sorts the pool by and the number their slot
// lands on are the same arithmetic.
//
// A SENDING-OFF IS -3, NOT -4. The provider marks a second-yellow dismissal as
// yellow 1 AND red 1; the red already prices the dismissal, so a red card
// suppresses the yellow (the FPL convention). A straight red with no earlier
// yellow is -3 either way.

/** players.position (API-Sports) -> the game's three positions. */
export function posOf(position) {
  const p = String(position ?? '').toUpperCase();
  if (p === 'GK' || p === 'G' || p === 'GOALKEEPER') return 'GK';
  if (p === 'DEF' || p === 'D' || p === 'DEFENDER') return 'DEF';
  if (p === 'MID' || p === 'M' || p === 'MIDFIELDER') return 'MID';
  if (p === 'ATT' || p === 'FWD' || p === 'F' || p === 'ATTACKER' || p === 'FORWARD') return 'FWD';
  return null;
}

export const GOAL_PTS = Object.freeze({ GK: 6, DEF: 6, MID: 5, FWD: 4 });
export const CLEAN_SHEET_PTS = Object.freeze({ GK: 4, DEF: 4, MID: 1, FWD: 0 });
export const PTS = Object.freeze({
  appearance60: 2, appearanceUnder60: 1, assist: 3, savesPer: 3, save: 1,
  penSave: 5, yellow: -1, red: -3, ownGoal: -2, penMiss: -2,
});

/** The rules in one line each, for "How it works". */
export const RULES_LINES = Object.freeze([
  'Playing 60+ minutes 2 · under 60 1',
  'Goal: DEF/GK 6 · MID 5 · FWD 4',
  'Assist 3',
  'Clean sheet (60+ min): DEF/GK 4 · MID 1',
  'Goalkeeper: 1 per 3 saves · penalty save 5',
  'Yellow −1 · red −3 · own goal −2 · penalty miss −2',
]);

const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));
const signed = (p) => (p < 0 ? `−${Math.abs(p)}` : String(p));

/**
 * A player_match_stats row (or the same shape built from the feed) -> the
 * line the scorer reads. Column names are the table's; the four added by
 * migration 121 may be NULL on a row imported before it, and are read as 0.
 *
 * concededOnPitch NULL means "never derived" (no events for the match). The
 * clean sheet then falls back to the whole match: a team that conceded
 * nothing conceded nothing while anyone was on; one that conceded is not
 * credited, because which side of the substitution the goal fell is unknown.
 */
export function lineFromRow(row, { position = null, teamConceded = null } = {}) {
  if (!row) return null;
  return {
    position: posOf(position ?? row.position),
    minutes: n(row.minutes_played),
    goals: n(row.goals),
    assists: n(row.assists),
    saves: n(row.saves),
    yellow: n(row.yellow_cards),
    red: n(row.red_cards),
    ownGoals: n(row.own_goals),
    penSaved: n(row.penalties_saved),
    penMissed: n(row.penalties_missed),
    concededOnPitch: row.conceded_on_pitch == null
      ? (teamConceded == null ? null : Number(teamConceded))
      : Number(row.conceded_on_pitch),
  };
}

/**
 * One player's points for one match, with every component as a chip.
 *
 * @param line  { position, minutes, goals, assists, saves, yellow, red,
 *                ownGoals, penSaved, penMissed, concededOnPitch }
 * @param opts  { final } - a clean sheet is only a clean sheet at full time;
 *              while the match is live the chip is withheld (the team can
 *              still concede) but appearance, goals and cards land as they
 *              happen.
 * @returns { points, parts: [{ key, label, pts, text }] }
 */
export function scoreLine(line, { final = true } = {}) {
  const parts = [];
  if (!line) return { points: 0, parts };
  const pos = posOf(line.position) ?? 'MID';
  const add = (key, label, pts, times = 1) => {
    for (let i = 0; i < times; i += 1) parts.push({ key, label, pts, text: `${label} ${signed(pts)}` });
  };
  const min = n(line.minutes);
  if (min >= 60) add('app60', '60+ min', PTS.appearance60);
  else if (min > 0) add('app', 'Under 60 min', PTS.appearanceUnder60);

  add('goal', 'Goal', GOAL_PTS[pos], n(line.goals));
  add('assist', 'Assist', PTS.assist, n(line.assists));

  const cs = CLEAN_SHEET_PTS[pos];
  if (final && cs > 0 && min >= 60 && line.concededOnPitch === 0) add('cs', 'Clean sheet', cs);

  if (pos === 'GK') {
    const s = Math.floor(n(line.saves) / PTS.savesPer);
    if (s > 0) parts.push({ key: 'saves', label: `${n(line.saves)} saves`, pts: s * PTS.save, text: `${n(line.saves)} saves ${s * PTS.save}` });
  }
  add('pensave', 'Pen save', PTS.penSave, n(line.penSaved));

  if (n(line.red) > 0) add('red', 'Red', PTS.red);
  else add('yellow', 'Yellow', PTS.yellow, Math.min(1, n(line.yellow)));
  add('og', 'Own goal', PTS.ownGoal, n(line.ownGoals));
  add('penmiss', 'Pen miss', PTS.penMiss, n(line.penMissed));

  return { points: parts.reduce((a, p) => a + p.pts, 0), parts };
}

/** Points per game over a season's lines: total / matches with minutes. */
export function pointsPerGame(lines = []) {
  const played = lines.filter((l) => n(l?.minutes) > 0);
  if (!played.length) return { ppg: null, games: 0, total: 0 };
  const total = played.reduce((a, l) => a + scoreLine(l).points, 0);
  return { ppg: Math.round((total / played.length) * 10) / 10, games: played.length, total };
}
