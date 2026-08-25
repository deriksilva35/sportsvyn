// lib/gridiron/plays.js - play-by-play normalisation and drive grouping.
//
// TWO CODES, TWO WIRE SHAPES, TWO TRAPS. Everything provider-specific is
// resolved here so that migration 074's `plays` table and every render above it
// see one vocabulary.
//
// TRAP 1 - ABSOLUTE YARD LINES DO NOT AGREE. CFBD's `yardline` counts from the
// OFFENSE'S own goal; BDL's `start_yard_line` counts from the HOME team's goal.
// Reading either as "the yard line" puts the ball on the wrong half of the
// field for one code. Both providers do publish distance-to-the-defense's-end-
// zone (CFBD `yardsToGoal`, BDL `start_yards_to_endzone`) and THAT is the field
// we store. Verified against the mock's own pixel coordinates: PHI (home) with
// the ball at DAL 34 is yards_to_goal 34, which the geometry in driveStrip.js
// places at 63.33% - the exact left offset the mock draws its ball marker at.
//
// TRAP 2 - BDL ATTRIBUTES CHANGE-OF-POSSESSION PLAYS TO THE RECEIVING TEAM.
// A punt row carries team=DAL when the punter is PHI's; a fumble recovery
// carries the recovering team while the text describes the fumbling team's
// runner. Taking `team` as the offense on those rows splits drives in the wrong
// places and merges others - it produced 16 drives on a game with 21. Those
// types are listed in HANDOFF_TYPES and terminate the drive they belong to
// rather than starting a new one.
//
// CFB has neither problem: CFBD hands us a native driveId per play.

import { noteUnmapped } from './ingest.js';

// Administrative rows. No offense, no drive membership, but real plays that a
// full feed contains and a re-import must not choke on.
export const ADMIN_TYPES = new Set([
  'timeout', 'official-timeout', 'end-period', 'two-minute-warning',
  'end-of-half', 'end-of-game', 'coin-toss', 'end-of-regulation',
]);

// TRAP 2's list. On these BDL rows, `team` is the team that ENDS UP with the
// ball, so it must not be read as the offense.
export const HANDOFF_TYPES = new Set([
  'kickoff', 'punt', 'interception', 'fumble-recovery-opponent',
  'interception-return', 'interception-return-touchdown',
  'fumble-return-touchdown', 'punt-return-touchdown', 'kickoff-return-touchdown',
  'blocked-punt', 'blocked-punt-touchdown', 'blocked-field-goal',
  'blocked-field-goal-touchdown', 'missed-field-goal-return', 'safety',
  'fumble-recovery-opponent-touchdown', 'punt-blocked', 'kickoff-return',
  'punt-return',
]);

/** A drive's outcome, in the mock's own vocabulary. */
export const DRIVE_RESULTS = Object.freeze({
  TD: 'Touchdown', FG: 'Field goal', PUNT: 'Punt', TURNOVER: 'Turnover',
  DOWNS: 'Downs', MISSED_FG: 'Missed FG', SAFETY: 'Safety',
  END_HALF: 'End of half', END_GAME: 'End of game', END_QUARTER: 'End of quarter',
  IN_PROGRESS: 'In progress',
  UNKNOWN: null,
});

const CFBD_RESULT_MAP = new Map(Object.entries({
  'TD': DRIVE_RESULTS.TD, 'Touchdown': DRIVE_RESULTS.TD,
  'Passing Touchdown': DRIVE_RESULTS.TD, 'Rushing Touchdown': DRIVE_RESULTS.TD,
  'FG': DRIVE_RESULTS.FG, 'Field Goal': DRIVE_RESULTS.FG, 'FG GOOD': DRIVE_RESULTS.FG,
  'FG MISSED': DRIVE_RESULTS.MISSED_FG, 'Missed Field Goal': DRIVE_RESULTS.MISSED_FG,
  'Missed FG': DRIVE_RESULTS.MISSED_FG, 'MISSED FG': DRIVE_RESULTS.MISSED_FG,
  'Blocked FG': DRIVE_RESULTS.MISSED_FG, 'Blocked Field Goal': DRIVE_RESULTS.MISSED_FG,
  'PUNT': DRIVE_RESULTS.PUNT, 'Punt': DRIVE_RESULTS.PUNT,
  'INT': DRIVE_RESULTS.TURNOVER, 'Interception': DRIVE_RESULTS.TURNOVER,
  'Interception Touchdown': DRIVE_RESULTS.TURNOVER,
  'Fumble Touchdown': DRIVE_RESULTS.TURNOVER,
  'Fumble Return Touchdown': DRIVE_RESULTS.TURNOVER,
  'Punt Touchdown': DRIVE_RESULTS.TURNOVER,
  'Blocked Punt Touchdown': DRIVE_RESULTS.TURNOVER,
  'Missed FG Touchdown': DRIVE_RESULTS.TURNOVER,
  'INT TD': DRIVE_RESULTS.TURNOVER, 'FUMBLE': DRIVE_RESULTS.TURNOVER,
  'Fumble': DRIVE_RESULTS.TURNOVER, 'FUMBLE TD': DRIVE_RESULTS.TURNOVER,
  'DOWNS': DRIVE_RESULTS.DOWNS, 'Downs': DRIVE_RESULTS.DOWNS,
  'TURNOVER ON DOWNS': DRIVE_RESULTS.DOWNS,
  'SF': DRIVE_RESULTS.SAFETY, 'Safety': DRIVE_RESULTS.SAFETY,
  'END OF HALF': DRIVE_RESULTS.END_HALF, 'End of Half': DRIVE_RESULTS.END_HALF,
  'END OF GAME': DRIVE_RESULTS.END_GAME, 'End of Game': DRIVE_RESULTS.END_GAME,
  'END OF 4TH QUARTER': DRIVE_RESULTS.END_GAME,
  'End Of Quarter': DRIVE_RESULTS.END_QUARTER, 'END OF QUARTER': DRIVE_RESULTS.END_QUARTER,
  'End of Regulation': DRIVE_RESULTS.END_GAME,
}));

/**
 * A drive's result from CFBD's own word for it. An unrecognised word is NAMED
 * in the run summary rather than guessed at - the 15 Aug unmapped-token law.
 * Returns null (not a fabricated result) when the vocabulary is new.
 */
export function cfbdDriveResult(word, runSummary = null) {
  if (word == null || word === '') return DRIVE_RESULTS.UNKNOWN;
  const hit = CFBD_RESULT_MAP.get(String(word));
  if (hit !== undefined) return hit;
  const norm = CFBD_RESULT_MAP.get(String(word).toUpperCase());
  if (norm !== undefined) return norm;
  if (runSummary) noteUnmapped(runSummary, `(drive) ${word}`);
  return DRIVE_RESULTS.UNKNOWN;
}

/**
 * The NFL has no drive-result field, so it is read off the drive's own plays.
 *
 * READING THE LAST PLAY ALONE IS WRONG, and the unmapped counter caught it: a
 * scoring drive's final row is the KICKOFF that follows the score, so 46 of 58
 * drives across the first backfill came back as "(drive) kickoff" - a drive
 * that plainly ended in a touchdown reported as unmappable. The score lives on
 * the last SCRIMMAGE play; only a punt or a turnover puts the result on the
 * terminal handoff row. So both are consulted, scrimmage first.
 *
 * Deliberately conservative at the end: an unrecognised shape is NAMED and
 * returns null, and the chart renders that drive untagged rather than wrong.
 */
export function bdlDriveResult(plays, runSummary = null, followedBy = null) {
  const list = Array.isArray(plays) ? plays : [];
  const typeOf = (p) => String(p?.type_slug ?? '');
  const scrimmage = list.filter((p) => {
    const t = typeOf(p);
    return t && !ADMIN_TYPES.has(t) && !HANDOFF_TYPES.has(t);
  });
  const lastScrim = scrimmage.at(-1);
  const terminal = list.at(-1);
  const ls = typeOf(lastScrim);
  const tt = typeOf(terminal);

  if (/touchdown$/.test(ls)) return DRIVE_RESULTS.TD;
  if (ls === 'field-goal-good') return DRIVE_RESULTS.FG;
  if (ls === 'field-goal-missed' || ls === 'field-goal-blocked') return DRIVE_RESULTS.MISSED_FG;

  if (tt === 'punt' || tt === 'blocked-punt' || tt === 'punt-blocked') return DRIVE_RESULTS.PUNT;
  if (tt.startsWith('interception') || tt === 'fumble-recovery-opponent'
      || tt === 'fumble-recovery-opponent-touchdown') return DRIVE_RESULTS.TURNOVER;
  if (tt === 'safety' || ls === 'safety') return DRIVE_RESULTS.SAFETY;

  // A drive whose terminal row is the ensuing kickoff scored - the kickoff only
  // happens because points were put on the board. Which score it was comes off
  // the scoring play itself, never assumed.
  if (tt === 'kickoff' || tt === 'kickoff-return' || tt === 'kickoff-return-touchdown') {
    const scored = [...scrimmage].reverse().find((p) => p.scoring_play);
    if (scored) return /field-goal/.test(typeOf(scored)) ? DRIVE_RESULTS.FG : DRIVE_RESULTS.TD;
  }

  // What FOLLOWED the drive, when nothing inside it named the result. The
  // half- and game-ending rows are administrative, so they never live inside a
  // drive - checking `terminal` for them was a dead branch, and 12 drives came
  // back untagged because of it. reconstructDrives() hands the following
  // administrative row in as `followedBy` precisely for this.
  const after = String(followedBy ?? '');
  if (after === 'end-of-half') return DRIVE_RESULTS.END_HALF;
  if (after === 'end-of-game' || after === 'end-of-regulation') return DRIVE_RESULTS.END_GAME;
  if (after === 'end-period') return DRIVE_RESULTS.END_QUARTER;

  // Fourth down that neither scored, punted, nor turned the ball over is a
  // turnover on downs - the one result the NFL feed never names outright.
  if (lastScrim?.start_down === 4) return DRIVE_RESULTS.DOWNS;

  if (!list.length) return DRIVE_RESULTS.UNKNOWN;
  if (runSummary) noteUnmapped(runSummary, `(drive) ${tt || ls}`);
  return DRIVE_RESULTS.UNKNOWN;
}

// ---------------------------------------------------------------- CFB / CFBD

/**
 * CFBD /live/plays?gameId= - which serves COMPLETED games as well as live ones
 * (probed against Army-Navy 2025, status "Final", 16 drives returned). One
 * request per game, drives already nested, so no reconstruction is needed and
 * none is attempted.
 *
 * `teamMap` maps a CFBD team id to our teams.id.
 */
export function normalizeCfbdLive(live, teamMap, runSummary = null) {
  const out = [];
  const drives = Array.isArray(live?.drives) ? live.drives : [];
  let prevHome = 0, prevAway = 0;
  drives.forEach((d, di) => {
    const plays = Array.isArray(d.plays) ? d.plays : [];
    plays.forEach((p, pi) => {
      const home = p.homeScore ?? prevHome;
      const away = p.awayScore ?? prevAway;
      out.push({
        providerPlayId: String(p.id),
        driveId: d.id == null ? null : String(d.id),
        driveNumber: di + 1,
        playNumber: pi + 1,
        period: p.period ?? null,
        clock: p.clock ?? null,
        down: p.down ?? null,
        distance: p.distance ?? null,
        yardsToGoal: p.yardsToGoal ?? null,
        yardsGained: p.yardsGained ?? null,
        offenseTeamId: teamMap.get(String(p.teamId)) ?? null,
        playType: p.playType ?? null,
        text: p.playText ?? null,
        homeScore: home,
        awayScore: away,
        // CFBD's live shape carries no `scoring` flag, so it is derived from the
        // scoreboard moving - never invented.
        scoring: home !== prevHome || away !== prevAway,
      });
      prevHome = home; prevAway = away;
    });
  });
  if (runSummary && !drives.length) noteUnmapped(runSummary, '(cfbd) no drives');
  return out;
}

/**
 * Drive envelopes for the chart, straight from CFBD - playCount, yards,
 * duration and result are the provider's own, not recomputed here.
 */
export function cfbdDriveSummaries(live, teamMap, runSummary = null) {
  return (Array.isArray(live?.drives) ? live.drives : []).map((d, i) => ({
    driveId: d.id == null ? null : String(d.id),
    driveNumber: i + 1,
    offenseTeamId: teamMap.get(String(d.offenseId)) ?? null,
    offenseName: d.offense ?? null,
    playCount: d.playCount ?? null,
    yards: d.yards ?? null,
    duration: d.duration ?? null,
    startPeriod: d.startPeriod ?? null,
    startClock: d.startClock ?? null,
    startYardsToGoal: d.startYardsToGoal ?? null,
    endPeriod: d.endPeriod ?? null,
    endClock: d.endClock ?? null,
    result: cfbdDriveResult(d.result, runSummary),
  }));
}

// ---------------------------------------------------------------- NFL / BDL

/**
 * BDL /nfl/v1/plays?game_id= - a flat, cursor-paginated list with NO drive id.
 * Drives are reconstructed here; see TRAP 2 at the top of the file for why the
 * naive "split whenever team changes" rule is wrong.
 *
 * `teamMap` maps a BDL team id to our teams.id.
 */
export function normalizeBdlPlays(rows, teamMap, runSummary = null) {
  const grouped = reconstructDrives(rows, runSummary);
  const driveOf = new Map();
  grouped.forEach((d, di) => {
    d.plays.forEach((p, pi) => driveOf.set(p.id, { driveId: d.driveId, driveNumber: di + 1, playNumber: pi + 1 }));
  });

  return rows.map((p, i) => {
    const g = driveOf.get(p.id) ?? { driveId: null, driveNumber: null, playNumber: i + 1 };
    const startYte = p.start_yards_to_endzone ?? null;
    const endYte = p.end_yards_to_endzone ?? null;
    // On a touchdown BDL leaves end_yards_to_endzone null: the ball left the
    // field of play. Gained is then the whole remaining distance, not zero -
    // the same null-is-missing-not-zero rule the VAL column learned.
    let gained = p.stat_yardage ?? null;
    if (gained == null && startYte != null) {
      gained = endYte == null
        ? (/touchdown$/.test(String(p.type_slug)) ? startYte : null)
        : startYte - endYte;
    }
    return {
      providerPlayId: String(p.id),
      driveId: g.driveId,
      driveNumber: g.driveNumber,
      playNumber: g.playNumber,
      period: p.period ?? null,
      clock: p.clock_display ?? null,
      down: p.start_down ?? null,
      distance: p.start_distance ?? null,
      yardsToGoal: startYte,
      yardsGained: gained,
      // On HANDOFF rows `team` is the receiving side, so the offense is taken
      // from the drive this play terminates rather than from the row itself.
      offenseTeamId: teamMap.get(String(offenseBdlTeamId(p, grouped, driveOf))) ?? null,
      playType: p.type_slug ?? null,
      text: p.text ?? null,
      homeScore: p.home_score ?? null,
      awayScore: p.away_score ?? null,
      scoring: Boolean(p.scoring_play),
    };
  });
}

function offenseBdlTeamId(play, drives, driveOf) {
  const t = String(play.type_slug ?? '');
  if (ADMIN_TYPES.has(t)) return null;
  if (!HANDOFF_TYPES.has(t)) return play.team?.id ?? null;
  const g = driveOf.get(play.id);
  if (!g) return null;
  const drive = drives[g.driveNumber - 1];
  return drive?.offenseBdlTeamId ?? null;
}

/**
 * The reconstruction rule, stated plainly:
 *   - administrative rows belong to no drive;
 *   - a change-of-possession row TERMINATES the drive it sits in;
 *   - any other row whose team differs from the running drive's team STARTS a
 *     new drive.
 * Drive ids are synthesised as `r<n>` - stable for a given feed, and marked so
 * nobody mistakes them for a provider's own key.
 */
export function reconstructDrives(rows, runSummary = null) {
  const drives = [];
  let cur = null;
  for (const p of rows ?? []) {
    const t = String(p.type_slug ?? '');
    if (ADMIN_TYPES.has(t)) continue;
    if (HANDOFF_TYPES.has(t)) { if (cur) cur.plays.push(p); continue; }
    const teamId = p.team?.id ?? null;
    if (!cur || cur.offenseBdlTeamId !== teamId) {
      cur = {
        driveId: `r${drives.length + 1}`,
        offenseBdlTeamId: teamId,
        offenseAbbr: p.team?.abbreviation ?? null,
        plays: [],
      };
      drives.push(cur);
    }
    cur.plays.push(p);
  }
  // Where each play sits in the original feed, so a drive can see what came
  // immediately after it without re-scanning the whole list.
  const posOf = new Map((rows ?? []).map((p, i) => [p.id, i]));
  for (const d of drives) {
    // Scan forward from the drive's last play over administrative rows only.
    // The first one that ends a half or the game IS this drive's result; a
    // scrimmage play means the drive simply ended some other way.
    d.followedBy = null;
    // Scan from the last SCRIMMAGE play, not the last play. A half-ending drive
    // has the NEXT half's kickoff appended to it (the kickoff is a handoff row
    // and `cur` is still this drive when it arrives), so starting after that
    // kickoff skips straight past the end-of-half row this is looking for.
    const lastScrimId = d.plays.filter((p) => !HANDOFF_TYPES.has(String(p.type_slug))).at(-1)?.id
      ?? d.plays.at(-1)?.id;
    for (let i = (posOf.get(lastScrimId) ?? -1) + 1; i > 0 && i < rows.length; i++) {
      const t = String(rows[i].type_slug ?? '');
      if (!ADMIN_TYPES.has(t)) break;
      if (t === 'end-of-half' || t === 'end-of-game' || t === 'end-of-regulation'
          || t === 'end-period') { d.followedBy = t; break; }
    }
    const scrimmage = d.plays.filter((p) => !HANDOFF_TYPES.has(String(p.type_slug)));
    const first = scrimmage[0] ?? d.plays[0];
    const last = d.plays.at(-1);
    d.playCount = scrimmage.length;
    d.startYardsToGoal = first?.start_yards_to_endzone ?? null;
    d.startPeriod = first?.period ?? null;
    d.startClock = first?.clock_display ?? null;
    d.endPeriod = last?.period ?? null;
    d.endClock = last?.clock_display ?? null;
    const endYte = scrimmage.at(-1)?.end_yards_to_endzone;
    d.yards = d.startYardsToGoal != null && endYte != null ? d.startYardsToGoal - endYte
      : (d.startYardsToGoal != null && /touchdown$/.test(String(scrimmage.at(-1)?.type_slug))
        ? d.startYardsToGoal : null);
    d.result = bdlDriveResult(d.plays, runSummary, d.followedBy);
  }
  return drives;
}
