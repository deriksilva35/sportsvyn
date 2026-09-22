import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mlbDetailOf, writeMlbDetail, writeMlbProbables } from './detail.js';

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
