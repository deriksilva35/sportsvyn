// lib/gridiron/playsHandoff.test.mjs - whose ball a change-of-possession row
// is, on a real game (relay fri-4 a/b).
//
// THE FIXTURE IS RECORDED, NOT TYPED: lib/gridiron/fixtures/phi-chi-2026-w3.json
// holds PHI@CHI 2026 week 3 (match 21586) - BDL's raw feed for the game
// (trimmed to the fields the normaliser reads), the plays rows the pre-fix
// importer wrote to PROD, the drive envelopes it stored, and three PROD
// winprob_log rows that logged the wrong side's ball:
//   11198  "A.Dalton ... INTERCEPTED by D.Thieneman ... Touchback"
//          pass-interception-return, logged CHI with 3rd & 2 at the 2 -> 67.8%
//   11182  "C.Keenum pass incomplete" on 4th & 3 - a turnover on downs,
//          logged PHI's ball
//   11291  "J.Hurts pass incomplete" on 4th & 22 - the same, logged CHI's
// nflverse's convention, which the model was trained on: posteam on these
// rows is the ORIGINAL offense.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeBdlPlays, reconstructDrives, isTurnoverOnDowns, bdlEndState,
  HANDOFF_TYPES, DRIVE_RESULTS,
} from './plays.js';
import { buildDriveChart } from './driveStrip.js';
import { nflPlaysAndDrives } from './playsImport.js';
import { modelState } from '../winprob/live.js';
import { predict } from '../winprob/predict.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const F = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'phi-chi-2026-w3.json'), 'utf8'));
const TMAP = new Map(Object.entries(F.teamMap));
const CHI = F.match.home_team_id; const PHI = F.match.away_team_id;
const ABBR = new Map(Object.entries(F.abbr).map(([k, v]) => [Number(k), v]));

const plays = normalizeBdlPlays(F.bdl, TMAP);
const byProvider = new Map(plays.map((p) => [p.providerPlayId, p]));
const storedBySeq = new Map(F.stored.map((s) => [s.id, s]));
const storedByProvider = new Map(F.stored.map((s) => [s.provider_play_id, s]));
const wpRow = (id) => F.winprob.find((w) => w.id === id);
const playFor = (wpId) => byProvider.get(storedBySeq.get(wpRow(wpId).play_seq).provider_play_id);

/** The logged row re-run through the REAL modelState + predict with the corrected play. */
function rePredict(wpId) {
  const w = wpRow(wpId); const p = playFor(wpId); const i = w.inputs;
  const state = modelState({
    period: p.period, clock: p.clock, homeScore: i.score_diff, awayScore: 0,
    play: { down: p.down, distance: p.distance, yards_to_goal: p.yardsToGoal, offense_team_id: p.offenseTeamId, play_type: p.playType, text: p.text },
    homeTeamId: CHI, season: F.match.season_year, sport: 'nfl', homeAbbr: 'CHI', awayAbbr: 'PHI',
  });
  return { state, p: predict('nfl', state, i.prior_logit) };
}

test('the three slugs BDL actually sends are handoffs', () => {
  for (const t of ['pass-interception-return', 'field-goal-missed', 'sack-opp-fumble-recovery']) {
    assert.ok(HANDOFF_TYPES.has(t), t);
  }
});

test('11198: the goal-line interception is PHI\'s snap and prices at ~53.4, not 67.8', () => {
  const p = playFor(11198);
  assert.equal(p.playType, 'pass-interception-return');
  assert.match(p.text, /INTERCEPTED by D\.Thieneman/);
  assert.equal(storedBySeq.get(wpRow(11198).play_seq).offense_team_id, CHI, 'the pre-fix row said CHI');
  assert.equal(p.offenseTeamId, PHI, 'the original offense');
  assert.equal(wpRow(11198).inputs.posteam_is_home, 1);
  assert.ok(Math.abs(wpRow(11198).p_home - 0.678) < 0.001, 'logged 67.8');
  const { state, p: wp } = rePredict(11198);
  assert.equal(state.posteam_is_home, 0);
  assert.equal(state.down_f, 3); assert.equal(state.ydstogo_f, 2); assert.equal(state.yards_to_goal, 2);
  assert.ok(Math.abs(wp - 0.534) < 0.005, `PHI 3rd & 2 at the CHI 2: ${wp}`);
});

test('11182 and 11291: a failed fourth down belongs to the side that snapped it', () => {
  const keenum = playFor(11182);
  assert.match(keenum.text, /C\.Keenum pass incomplete/);
  assert.equal(keenum.down, 4);
  assert.equal(storedBySeq.get(wpRow(11182).play_seq).offense_team_id, PHI, 'pre-fix: PHI');
  assert.equal(keenum.offenseTeamId, CHI);
  assert.equal(rePredict(11182).state.posteam_is_home, 1);

  const hurts = playFor(11291);
  assert.match(hurts.text, /J\.Hurts pass incomplete/);
  assert.equal(hurts.down, 4); assert.equal(hurts.distance, 22);
  assert.equal(storedBySeq.get(wpRow(11291).play_seq).offense_team_id, CHI, 'pre-fix: CHI');
  assert.equal(hurts.offenseTeamId, PHI);
  assert.equal(rePredict(11291).state.posteam_is_home, 0);
});

test('only those rows move: punts, kickoffs and fumble recoveries keep the offense they had', () => {
  const changed = {};
  for (const p of plays) {
    const s = storedByProvider.get(p.providerPlayId);
    if (!s) continue;
    if (s.offense_team_id !== p.offenseTeamId) changed[p.playType] = (changed[p.playType] ?? 0) + 1;
  }
  assert.deepEqual(changed, { 'pass-incompletion': 2, 'pass-interception-return': 2 });
  for (const t of ['punt', 'kickoff', 'fumble-recovery-opponent']) {
    const rows = plays.filter((p) => p.playType === t && storedByProvider.has(p.providerPlayId));
    assert.ok(rows.length > 0, `the game has ${t} rows`);
    for (const p of rows) assert.equal(p.offenseTeamId, storedByProvider.get(p.providerPlayId).offense_team_id, `${t} ${p.providerPlayId}`);
  }
});

test('the turnover-on-downs rule: fourth down, a different team, the drive\'s own snap before it', () => {
  const row = { type_slug: 'rush', start_down: 4, team: { id: 2 } };
  assert.equal(isTurnoverOnDowns(row, 1, false), true);
  assert.equal(isTurnoverOnDowns(row, 2, false), false, 'same team: a conversion, not a turnover');
  assert.equal(isTurnoverOnDowns({ ...row, start_down: 3 }, 1, false), false, 'third down never is');
  assert.equal(isTurnoverOnDowns(row, 1, true), false, 'after a handoff the possession has already changed');
  assert.equal(isTurnoverOnDowns({ ...row, type_slug: 'punt' }, 1, false), false, 'a punt has its own slug');
  assert.equal(isTurnoverOnDowns({ ...row, team: null }, 1, false), false, 'no team, no claim');
  assert.equal(isTurnoverOnDowns(row, null, false), false);
});

test('the drive strip: the interception ends PHI\'s drive instead of starting CHI\'s', () => {
  const findDrive = (list, providerId) => list.find((d) => d.plays.some((p) => p.providerPlayId === providerId));
  const intId = storedBySeq.get(wpRow(11198).play_seq).provider_play_id;

  // BEFORE: as stored on PROD by the pre-fix importer.
  const beforePlays = F.stored.map((s) => ({ providerPlayId: s.provider_play_id, driveId: s.drive_id, driveNumber: s.drive_number, offenseTeamId: s.offense_team_id, playType: s.play_type }));
  const before = buildDriveChart(beforePlays, { drives: F.storedDrives, homeTeamId: CHI, teamAbbr: ABBR });
  const b = findDrive(before, intId);
  assert.equal(b.offenseAbbr, 'CHI', 'pre-fix: the interception opened a CHI drive');
  assert.equal(b.plays.at(-1).providerPlayId, intId, 'as its first play');
  const bPrev = before.find((d) => d.driveNumber === b.driveNumber - 1);
  assert.equal(bPrev.offenseAbbr, 'PHI');
  assert.equal(bPrev.result, null, 'and PHI\'s drive had no result');
  assert.equal(bPrev.yards, 1, 'and 1 yard, its first row being CHI\'s failed 4th down at the PHI 3');

  // AFTER: the same feed through the fixed importer.
  const { plays: after, drives } = nflPlaysAndDrives(F.bdl, TMAP);
  const chart = buildDriveChart(after, { drives, homeTeamId: CHI, teamAbbr: ABBR });
  const a = findDrive(chart, intId);
  assert.equal(a.offenseAbbr, 'PHI');
  assert.equal(a.plays[0].providerPlayId, intId, 'the interception is the drive\'s last row');
  assert.equal(a.result, DRIVE_RESULTS.TURNOVER);
  assert.equal(a.playCount, 14);
  assert.equal(a.yards, 95, 'PHI 3 to CHI 2');
  const next = chart.find((d) => d.driveNumber === a.driveNumber + 1);
  assert.equal(next.offenseAbbr, 'CHI');
  assert.equal(next.result, DRIVE_RESULTS.FG);
  assert.equal(next.startYardsToGoal, 80, 'CHI\'s drive starts at its own 20 after the touchback');

  // Both failed fourth downs now end their drives on downs.
  const keenumId = storedBySeq.get(wpRow(11182).play_seq).provider_play_id;
  const hurtsId = storedBySeq.get(wpRow(11291).play_seq).provider_play_id;
  assert.equal(findDrive(chart, keenumId).result, DRIVE_RESULTS.DOWNS);
  assert.equal(findDrive(chart, keenumId).offenseAbbr, 'CHI');
  assert.equal(findDrive(chart, hurtsId).result, DRIVE_RESULTS.DOWNS);
  assert.equal(findDrive(chart, hurtsId).offenseAbbr, 'PHI');
  assert.equal(reconstructDrives(F.bdl).length, F.storedDrives.length, 'same drive count - the boundaries moved, none appeared');
});

test('the end-of-play state is stored as the feed states it, sentinels as null', () => {
  const p = playFor(11198);
  assert.deepEqual([p.endDown, p.endDistance, p.endYardsToGoal], [1, 10, 80], 'CHI 1st & 10 at its own 20 - the next snap\'s frame');
  assert.deepEqual(bdlEndState({ end_down: -1, end_distance: 10, end_yards_to_endzone: 0 }), { endDown: null, endDistance: null, endYardsToGoal: null });
  assert.deepEqual(bdlEndState({ end_down: 0, end_distance: 0, end_yards_to_endzone: 65 }), { endDown: null, endDistance: null, endYardsToGoal: null });
  assert.deepEqual(bdlEndState({}), { endDown: null, endDistance: null, endYardsToGoal: null });
  assert.deepEqual(bdlEndState({ end_down: 3, end_distance: 2, end_yards_to_endzone: 2 }), { endDown: 3, endDistance: 2, endYardsToGoal: 2 });
  const td = plays.find((x) => x.playType === 'passing-touchdown');
  assert.equal(td.endDown, null, 'after a score no snap is pending');
});
