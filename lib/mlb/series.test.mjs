// lib/mlb/series.test.mjs - a series is a grouping, and the grouping is right.
//
// THE FIXTURE IS REAL AND WAS NOT TYPED. lib/mlb/fixtures/postseason2025.json
// is the 2025 postseason as this database holds it after the importer ran -
// 47 games, captured from DEV. A bracket typed from memory would have agreed
// with whatever this test expected, which is the defect
// [[a-test-must-not-compare-a-value-to-itself]] is named after.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shapeSeries, seriesKey } from './series.js';
import { BEST_OF, clinch, stagesByBacktrack, stageFromGameType, SERIES_IN_ROUND, STAGES } from './postseason.js';

const ROWS = JSON.parse(readFileSync(new URL('./fixtures/postseason2025.json', import.meta.url), 'utf8'));

test('THE KEY IS THE UNORDERED PAIR PLUS THE STAGE', () => {
  // A series is the same series whoever is at home, and MLB alternates hosts
  // inside one - so the key must not depend on which row was read first.
  assert.equal(seriesKey('division', 'LAD', 'PHI'), 'division:LAD-PHI');
  assert.equal(seriesKey('division', 'PHI', 'LAD'), 'division:LAD-PHI');
  assert.equal(seriesKey('division', 'phi', 'lad'), 'division:LAD-PHI');
  // THE STAGE IS PART OF IT because two clubs meet twice in one October: LAD
  // and MIL played the NLCS in 2025 having been in different division series.
  assert.notEqual(seriesKey('championship', 'LAD', 'MIL'), seriesKey('division', 'LAD', 'MIL'));
  assert.equal(seriesKey(null, 'LAD', 'PHI'), null);
  assert.equal(seriesKey('division', 'LAD', ''), null);
});

test('THE 2025 BRACKET, grouped: 47 games, 11 series, 4 rounds', () => {
  const all = shapeSeries(ROWS);
  assert.equal(ROWS.length, 47);
  assert.equal(all.length, 11);
  // Every round has exactly the number of series the competition gives it.
  for (const st of STAGES) {
    assert.equal(all.filter((s) => s.stage === st).length, SERIES_IN_ROUND[st], st);
  }
  // IN BRACKET ORDER, which is by first pitch. This sort used to compare
  // String(Date) - "Tue Oct 14 2025 ..." - and put the LCS above the wild
  // card, alphabetically and confidently.
  assert.deepEqual(all.map((s) => s.stage), [
    'wild_card', 'wild_card', 'wild_card', 'wild_card',
    'division', 'division', 'division', 'division',
    'championship', 'championship', 'world_series',
  ]);
  // Every game is in exactly one series and none was dropped.
  assert.equal(all.reduce((a, s) => a + s.gameCount, 0), 47);
});

test('WINS, RECORD AND WINNER come out of the games and nothing else', () => {
  const by = new Map(shapeSeries(ROWS).map((s) => [s.key, s]));

  // The 2025 World Series: Los Angeles beat Toronto in seven.
  const ws = by.get('world_series:LAD-TOR');
  assert.equal(ws.bestOf, 7);
  assert.equal(ws.clinch, 4);
  assert.equal(ws.gameCount, 7);
  assert.equal(ws.record, '4-3');
  assert.equal(ws.status, 'final');
  assert.equal(ws.teams.find((t) => t.id === ws.winner).abbreviation, 'LAD');
  assert.equal(ws.nextGame, null, 'a decided series has no next game');

  // A SWEEP IS STILL A BEST-OF-SEVEN. LAD took the NLCS 4-0 and the series is
  // four games long; bestOf is a rule of the competition, not a game count.
  const lcs = by.get('championship:LAD-MIL');
  assert.equal(lcs.bestOf, 7);
  assert.equal(lcs.gameCount, 4);
  assert.equal(lcs.record, '4-0');
  assert.equal(lcs.teams.find((t) => t.id === lcs.winner).abbreviation, 'LAD');

  // THE RECORD IS LEADER-FIRST, always - "2-1", never "1-2".
  for (const s of by.values()) {
    const [a, b] = s.record.split('-').map(Number);
    assert.ok(a >= b, `${s.key} reads ${s.record}`);
  }

  // GAME 1'S HOST IS THE HIGHER SEED, and that is the order the teams come in.
  const wc = by.get('wild_card:CIN-LAD');
  assert.equal(wc.teams[0].abbreviation, 'LAD', 'the 2025 NL 3-seed hosted all of it');
  assert.equal(wc.record, '2-0');
  assert.equal(wc.bestOf, 3);
  assert.equal(wc.clinch, 2);
});

test('a series that has not started, one in progress, and one with a blank final', () => {
  const key = 'division:AAA-BBB';
  const g = (id, status, hs, as, day) => ({
    id, slug: `g${id}`, stage: 'division', kickoff_at: `2026-10-0${day}T00:00:00Z`,
    status, home_score: hs, away_score: as,
    home_team_id: 1, away_team_id: 2, home_abbr: 'AAA', away_abbr: 'BBB',
    home_name: 'A', away_name: 'B', home_league: 'American', away_league: 'American',
  });
  const notStarted = shapeSeries([g(1, 'scheduled', null, null, 4), g(2, 'scheduled', null, null, 5)])[0];
  assert.equal(notStarted.status, 'scheduled');
  assert.equal(notStarted.record, '0-0');
  assert.equal(notStarted.winner, null);
  assert.equal(notStarted.nextGame, 1, 'Game 1 is next');

  const running = shapeSeries([g(1, 'final', 5, 2, 4), g(2, 'live', 1, 1, 5)])[0];
  assert.equal(running.status, 'live');
  assert.equal(running.record, '1-0');
  assert.equal(running.winner, null, 'one win is not three');
  assert.equal(running.nextGame, 2);

  // A FINAL WITH NO SCORE IS NOT A WIN FOR ANYBODY. It happens - a row marked
  // final before the box lands - and Number(null) is 0, which would make it a
  // tie and then, in a careless reader, a win for the home side.
  const blank = shapeSeries([g(1, 'final', null, null, 4)])[0];
  assert.equal(blank.record, '0-0');
  assert.equal(blank.winner, null);
  assert.equal(blank.status, 'live', 'it counts as played, but nobody won it');
});

test('THE BACKWARDS WALK places a finished bracket and REFUSES a live one', () => {
  // Rebuilt from the fixture in the importer's own input shape.
  const groups = [...new Map(ROWS.map((r) => {
    const pair = [r.away_abbr, r.home_abbr].sort().join('-');
    return [pair, pair];
  })).keys()].map((pair) => {
    const rows = ROWS.filter((r) => [r.away_abbr, r.home_abbr].sort().join('-') === pair)
      .sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at));
    return {
      key: pair, firstDate: rows[0].kickoff_at,
      teams: [
        { id: rows[0].away_abbr, league: rows[0].away_league },
        { id: rows[0].home_abbr, league: rows[0].home_league },
      ],
    };
  });
  const stages = stagesByBacktrack(groups);
  assert.ok(stages, 'a finished bracket places');
  assert.equal(stages.size, 11);
  assert.equal(stages.get('LAD-TOR'), 'world_series', 'the one cross-league series');
  assert.equal(stages.get('LAD-MIL'), 'championship');
  assert.equal(stages.get('SEA-TOR'), 'championship');
  assert.equal(stages.get('LAD-PHI'), 'division');
  assert.equal(stages.get('CIN-LAD'), 'wild_card');
  // It agrees with the stage the importer actually wrote, for all eleven.
  for (const g of groups) {
    const row = ROWS.find((r) => [r.away_abbr, r.home_abbr].sort().join('-') === g.key);
    assert.equal(stages.get(g.key), row.stage, g.key);
  }

  // A BYE FALLS OUT FOR FREE. Milwaukee were the NL 1-seed and played no wild
  // card round; an index into each club's series list would have called their
  // division series a wild card.
  assert.equal([...stages].filter(([k, v]) => v === 'wild_card' && k.includes('MIL')).length, 0);

  // AND IT REFUSES A BRACKET STILL BEING PLAYED - no cross-league series means
  // no World Series means we cannot walk backwards from anything.
  const live = groups.filter((g) => g.teams[0].league === g.teams[1].league);
  assert.equal(stagesByBacktrack(live), null);
  assert.equal(stagesByBacktrack([]), null);
});

test('the round comes from the second provider on the live path', () => {
  assert.equal(stageFromGameType('F'), 'wild_card');
  assert.equal(stageFromGameType('D'), 'division');
  assert.equal(stageFromGameType('L'), 'championship');
  assert.equal(stageFromGameType('W'), 'world_series');
  assert.equal(stageFromGameType('w'), 'world_series');
  // NOT POSTSEASON IS NOT A ROUND. Spring, Regular, All-Star and Exhibition
  // must not be filed under one.
  for (const t of ['R', 'S', 'A', 'E', '', null, undefined]) {
    assert.equal(stageFromGameType(t), null, String(t));
  }
});

test('best-of and clinch are the competition\'s rules', () => {
  assert.deepEqual(BEST_OF, { wild_card: 3, division: 5, championship: 7, world_series: 7 });
  assert.equal(clinch(3), 2);
  assert.equal(clinch(5), 3);
  assert.equal(clinch(7), 4);
  // 'final' IS NOT ONE OF OUR STAGE NAMES. matches.stage already carries a
  // World Cup vocabulary where 'final' means the World Cup final, and a
  // reader of either sport must never have to ask which tournament it is.
  assert.ok(!STAGES.includes('final'));
  assert.ok(!STAGES.includes('semi'));
  assert.ok(!STAGES.includes('group'));
});
