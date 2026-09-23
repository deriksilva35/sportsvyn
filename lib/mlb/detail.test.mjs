import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mlbDetailOf, writeMlbDetail, writeMlbProbables } from './detail.js';
import { lineScoreOf } from './ingest.js';

const ROW = {
  id: 1,
  home_team_data: { runs: 2, hits: 5, errors: 1, inning_scores: [0, 0, 0, 2, 0, 0] },
  away_team_data: { runs: 3, hits: 7, errors: 0, inning_scores: [0, 1, 0, 0, 2, 0, 0] },
  scoring_summary: [
    { play: 'Judge homered to left (412 feet), Soto scored.', inning: 'bottom', period: '4th', home_score: 2, away_score: 0 },
    { play: 'Díaz singled to right, Lowe scored.', inning: 'top', period: '7th', home_score: 2, away_score: 3 },
  ],
};

test('the keys this writer owns, and only those', () => {
  const d = mlbDetailOf(ROW);
  assert.deepEqual(Object.keys(d).sort(), ['line_score', 'scoring_plays']);
  // NOT status, NOT a score, NOT live_state. Those are writeLive's, and a
  // second writer that could touch them would be a race with the first.
  for (const forbidden of ['status', 'home_score', 'away_score', 'live_state', 'detail']) {
    assert.ok(!(forbidden in d), `${forbidden} belongs to writeLive`);
  }
  assert.equal(d.line_score.away.runs, 3);
  assert.equal(d.line_score.away.innings.length, 7, 'the ragged edge survives');
  assert.equal(d.line_score.home.innings.length, 6);
  assert.equal(d.scoring_plays.length, 2);
  assert.equal(d.scoring_plays[1].awayScore, 3, 'the score AFTER the play, which the page prints');
});

test('AN EMPTY SUMMARY IS A FACT; A MISSING ONE IS NOT', () => {
  // A 0-0 game in the fourth has genuinely had no scoring plays, and refusing
  // to write [] is how a card keeps showing last night's home run.
  const d = mlbDetailOf({ ...ROW, scoring_summary: [] });
  assert.deepEqual(d.scoring_plays, []);
  // A row with NO scoring_summary field at all - a truncated payload, a shape
  // change - says nothing about the plays, so nothing is written. This is the
  // distinction scoringPlaysOf() cannot make on its own: it returns [] for
  // both, which is right for a parser and wrong for a writer.
  const missing = mlbDetailOf({ ...ROW, scoring_summary: undefined });
  assert.ok(!('scoring_plays' in missing), 'absent, not emptied');
  assert.ok(missing.line_score, 'and the line score still writes');
  // Nothing at all: nothing to write, so writeMlbDetail issues no statement
  // rather than an UPDATE that sets metadata to itself.
  assert.equal(mlbDetailOf({}), null);
  assert.equal(mlbDetailOf(null), null);
});

test('NOTHING TO WRITE ISSUES NO STATEMENT', async () => {
  let called = 0;
  const sql = () => { called += 1; return Promise.resolve([]); };
  assert.equal(await writeMlbDetail(sql, 1, null), false);
  assert.equal(await writeMlbDetail(sql, 1, {}), false);
  assert.equal(await writeMlbProbables(sql, 1, null), false);
  assert.equal(called, 0);
  assert.equal(await writeMlbDetail(sql, 1, { line_score: {} }), true);
  assert.equal(called, 1);
});

test('THE MERGE IS TOP-LEVEL BECAUSE THE KEYS ARE', () => {
  // The 14 Aug law read the right way round. `jsonb ||` is one level deep,
  // which is CORRECT for a top-level key and a disaster for a nested one -
  // the final_seen_at wipe was nested. Every key here is top-level, so the
  // merge is top-level and every sibling it does not name survives.
  const src = readFileSync(new URL('./detail.js', import.meta.url), 'utf8');
  // No key this file writes may contain a path separator or be nested under
  // another - if one ever is, this merge stops being the right depth.
  for (const key of ['line_score', 'scoring_plays', 'probables']) {
    assert.ok(src.includes(`'${key}'`) || src.includes(`out.${key}`),
      `${key} is one of this writer's keys`);
  }
  assert.ok(!/metadata->'[a-z_]+'\s*\|\|/.test(src),
    'a nested merge here would mean a key that is not top-level after all');
  // AND IT CANNOT TOUCH A SCORE. The guard is the statement itself.
  assert.ok(!/SET[\s\S]*?home_score|SET[\s\S]*?away_score|SET[\s\S]*?status\s*=/.test(src),
    'this writer sets metadata and updated_at, and nothing else');
});

// --- A SCHEDULE ROW IS NOT A RESULT ----------------------------------------

test('a scheduled row carries NO line score and NO summary', () => {
  // The exact shape BDL sends for an unplayed game - measured on 2026-09-23,
  // where all fifteen scheduled rows were `scheduled | 0 innings | 0 summary`.
  const pre = {
    status: 'STATUS_SCHEDULED', status_state: 'scheduled',
    home_team_data: { hits: 0, runs: 0, errors: 0, inning_scores: [] },
    away_team_data: { hits: 0, runs: 0, errors: 0, inning_scores: [] },
    scoring_summary: [],
  };
  // IT IS A WELL-FORMED LINE SCORE OF NOTHING, which is why it was written:
  // lineScoreOf() happily returns { home, away } for it.
  assert.ok(lineScoreOf(pre), 'the parser still reads it - the refusal is here');
  assert.equal(mlbDetailOf(pre), null,
    'writing it stamped a 0-0 grid over every game on the board four hours early');
  assert.equal(mlbDetailOf({ ...pre, status_state: 'pre' }), null);
  assert.equal(mlbDetailOf({ ...pre, status_state: 'postponed' }), null);
});

test('a started game with no closed inning yet is still not a line score', () => {
  const firstPitch = {
    status_state: 'in_progress',
    home_team_data: { hits: 0, runs: 0, errors: 0, inning_scores: [] },
    away_team_data: { hits: 0, runs: 0, errors: 0, inning_scores: [] },
    scoring_summary: [],
  };
  const d = mlbDetailOf(firstPitch);
  assert.equal(d?.line_score, undefined, 'an empty grid by another route');
  // THE EMPTY SUMMARY IS STILL A FACT once the game has started - a 0-0 game in
  // the fourth has genuinely had no scoring plays, and refusing to write []
  // there is how a card keeps showing last night's home run.
  assert.deepEqual(d, { scoring_plays: [] });
});

test('a real in-progress row writes both, innings and all', () => {
  const live = {
    status_state: 'in_progress',
    home_team_data: { hits: 8, runs: 6, errors: 0, inning_scores: [0, 2, 1, 0, 0, 0, 0, 3] },
    away_team_data: { hits: 6, runs: 4, errors: 2, inning_scores: [0, 0, 0, 1, 0, 2, 0, 0, 1] },
    // THE REAL FIELD NAMES, off 2026-09-22's MIL @ PHI: `play`, `inning`
    // ("top"/"bottom"), `period` ("2nd"), and the score AFTER the play.
    scoring_summary: [
      { play: 'Marsh homered to right (390 feet), Stott scored.', inning: 'bottom', period: '2nd', away_score: 0, home_score: 2 },
      { play: 'Lara singled to center, Yelich scored.', inning: 'top', period: '9th', away_score: 4, home_score: 6 },
    ],
  };
  const d = mlbDetailOf(live);
  assert.equal(d.line_score.away.innings.length, 9);
  assert.equal(d.line_score.home.runs, 6);
  assert.equal(d.line_score.away.errors, 2);
  assert.equal(d.scoring_plays.length, 2);
  assert.deepEqual(d.scoring_plays[0], {
    text: 'Marsh homered to right (390 feet), Stott scored.',
    half: 'bottom', inning: '2nd', homeScore: 2, awayScore: 0,
  });
});

test('the poller writes the detail BEFORE the scoreline, not behind its gate', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../services/live-poller/poll.mjs', import.meta.url), 'utf8');
  const loop = src.slice(src.indexOf('for (const m of candidates)'));
  const d = loop.indexOf('writeMlbDetail');
  const after = loop.indexOf('const after = await writeLive');
  assert.ok(d > -1 && after > -1);
  // writeLive returns null when nothing about the SCORE changed, and a line
  // score advances when an INNING passes. Behind that gate it froze between
  // runs, and a final row is not a candidate at all - so the last reading it
  // ever took was whatever the poll that flipped it happened to hold.
  assert.ok(d < after, 'the line score is hung off a score change again');
});
