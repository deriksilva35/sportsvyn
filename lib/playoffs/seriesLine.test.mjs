// lib/playoffs/seriesLine.test.mjs - the series line (mon-17), every state,
// plus the MLB grouping and the surfaces that draw it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seriesLine } from './seriesLine.js';
import { linesFromRows } from './mlbSeriesLines.js';
import { roundLabel } from '../mlb/postseason.js';
import { teamRow } from '../widget/shape.js';
import { validate, TEAM } from '../widget/schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (p) => readFileSync(path.join(ROOT, p), 'utf8');

// NYY hosts, BOS visits; day n at 23:00Z.
const day = (n) => new Date(Date.UTC(2026, 9, n, 23)).toISOString();
const g = (id, n, status = 'scheduled', home = null, away = null, h = 'NYY', a = 'BOS') => ({
  id, kickoffAt: day(n), status, homeAbbr: h, awayAbbr: a, homeScore: home, awayScore: away,
});
const line = (game, series, bestOf = 5, round = 'ALDS') => seriesLine({ game, series, round, bestOf });

test('Game 1, no record yet: round, game, best of', () => {
  const g1 = g(1, 1);
  assert.equal(line(g1, [g1]), 'ALDS · Game 1 · best of 5');
  assert.equal(line(g1, [g1], 3, 'Wild Card'), 'Wild Card · Game 1 · best of 3');
});

test('a team leads: abbreviation, record leader-first, best of', () => {
  const s = [g(1, 1, 'final', 5, 2), g(2, 2, 'final', 1, 4, 'BOS', 'NYY'), g(3, 3)];
  // G1 NYY won at home; G2 at BOS, NYY (away) won 4-1 -> NYY leads 2-0, but 3 needed -> can clinch.
  assert.equal(line(s[2], s), 'ALDS · Game 3 · NYY can clinch');
  const s7 = [g(1, 1, 'final', 5, 2), g(2, 2)];
  assert.equal(line(s7[1], s7, 7, 'ALCS'), 'ALCS · Game 2 · NYY leads 1-0 · best of 7');
  const away = [g(1, 1, 'final', 2, 5), g(2, 2)];
  assert.equal(line(away[1], away, 7, 'ALCS'), 'ALCS · Game 2 · BOS leads 1-0 · best of 7');
});

test('tied: "Series tied 1-1"', () => {
  const s = [g(1, 1, 'final', 5, 2), g(2, 2, 'final', 2, 5), g(3, 3)];
  assert.equal(line(s[2], s), 'ALDS · Game 3 · Series tied 1-1');
});

test('can clinch: the leader is one win away, the other is not', () => {
  const s = [g(1, 1, 'final', 5, 2), g(2, 2, 'final', 2, 5), g(3, 3, 'final', 6, 1), g(4, 4)];
  assert.equal(line(s[3], s), 'ALDS · Game 4 · NYY can clinch');
  const wc = [g(1, 1, 'final', 3, 0), g(2, 2)];
  assert.equal(line(wc[1], wc, 3, 'Wild Card'), 'Wild Card · Game 2 · NYY can clinch');
});

test('elimination game: both one win away -> winner advances', () => {
  const s = [g(1, 1, 'final', 5, 2), g(2, 2, 'final', 2, 5), g(3, 3, 'final', 6, 1), g(4, 4, 'final', 0, 3), g(5, 5)];
  assert.equal(line(s[4], s), 'ALDS · Game 5 · winner advances');
  const wc = [g(1, 1, 'final', 3, 0), g(2, 2, 'final', 0, 3), g(3, 3, 'live', 1, 1)];
  assert.equal(line(wc[2], wc, 3, 'Wild Card'), 'Wild Card · Game 3 · winner advances');
});

test('the clinching final: "<TEAM> wins series X-Y", this game included', () => {
  const s = [g(1, 1, 'final', 5, 2), g(2, 2, 'final', 2, 5), g(3, 3, 'final', 6, 1), g(4, 4, 'final', 0, 3, 'BOS', 'NYY')];
  assert.equal(line(s[3], s), 'ALDS · NYY wins series 3-1');
  const sweep = [g(1, 1, 'final', 3, 0), g(2, 2, 'final', 4, 1)];
  assert.equal(line(sweep[1], sweep, 3, 'Wild Card'), 'Wild Card · NYY wins series 2-0');
});

test('a final that did not clinch keeps the record from before it', () => {
  const s = [g(1, 1, 'final', 5, 2), g(2, 2, 'final', 2, 5)];
  assert.equal(line(s[1], s), 'ALDS · Game 2 · NYY leads 1-0 · best of 5');
});

test('cancelled and not-needed games are not games of the series', () => {
  const s = [g(1, 1, 'final', 5, 2), g(9, 1, 'cancelled'), g(8, 2, 'not_needed'), g(2, 3)];
  assert.equal(line(s[3], s, 7, 'ALCS'), 'ALCS · Game 2 · NYY leads 1-0 · best of 7');
});

test('NFL single game: the round alone', () => {
  assert.equal(seriesLine({ game: g(1, 1), series: [], round: 'Divisional Round', bestOf: 1 }), 'Divisional Round');
  assert.equal(seriesLine({ game: g(1, 1), round: 'Wild Card Round' }), 'Wild Card Round');
  assert.equal(seriesLine({ game: g(1, 1), series: [], round: null, bestOf: 5 }), null);
});

test('roundLabel: ALDS/NLCS within a league, STAGE_LABEL otherwise', () => {
  assert.equal(roundLabel('division', 'American'), 'ALDS');
  assert.equal(roundLabel('division', 'National'), 'NLDS');
  assert.equal(roundLabel('championship', 'American'), 'ALCS');
  assert.equal(roundLabel('championship', 'National'), 'NLCS');
  assert.equal(roundLabel('wild_card', 'American'), 'Wild Card');
  assert.equal(roundLabel('world_series', null), 'World Series');
  assert.equal(roundLabel('division', null), 'Division Series');
});

test('linesFromRows: one read, grouped by unordered pair + stage + season', () => {
  const team = (abbreviation, conference = 'American') => ({ abbreviation, conference });
  const rows = [
    { id: 1, stage: 'division', season_year: 2026, kickoff_at: day(1), status: 'final', home_abbr: 'NYY', away_abbr: 'BOS', home_score: 5, away_score: 2 },
    { id: 2, stage: 'division', season_year: 2026, kickoff_at: day(2), status: 'scheduled', home_abbr: 'BOS', away_abbr: 'NYY', home_score: null, away_score: null },
    // another series, and the same pair last year - neither counts
    { id: 3, stage: 'division', season_year: 2026, kickoff_at: day(1), status: 'final', home_abbr: 'HOU', away_abbr: 'SEA', home_score: 1, away_score: 0 },
    { id: 4, stage: 'division', season_year: 2025, kickoff_at: day(1), status: 'final', home_abbr: 'BOS', away_abbr: 'NYY', home_score: 9, away_score: 0 },
  ];
  const games = [
    { id: 2, leagueSlug: 'mlb', stage: 'division', seasonYear: 2026, kickoffAt: day(2), status: 'scheduled', home: team('BOS'), away: team('NYY'), homeScore: null, awayScore: null },
    { id: 50, leagueSlug: 'mlb', stage: null, seasonYear: 2026, kickoffAt: day(2), status: 'scheduled', home: team('TOR'), away: team('TB') },
    { id: 51, leagueSlug: 'nfl', stage: 'division', seasonYear: 2026, kickoffAt: day(2), status: 'scheduled', home: team('BUF'), away: team('MIA') },
  ];
  const out = linesFromRows(games, rows);
  assert.equal(out.get(2), 'ALDS · Game 2 · NYY leads 1-0 · best of 5');
  assert.equal(out.has(50), false, 'regular season: no line');
  assert.equal(out.has(51), false, 'not MLB: no line');
});

test('widget teams[] row: series is optional and additive', () => {
  const base = { teamId: 1, teamAbbr: 'NYY', teamName: 'Yankees', leagueSlug: 'mlb', gameId: 9, gameSlug: 'x', status: 'scheduled',
    kickoffAt: day(2), homeTeamId: 1, oppId: 2, oppAbbr: 'BOS', oppName: 'Red Sox' };
  const now = new Date(day(1));
  const without = teamRow(base, { now });
  assert.equal('series' in without, false);
  assert.deepEqual(validate(without, TEAM), []);
  const withIt = teamRow({ ...base, series: 'ALDS · Game 2 · NYY leads 1-0 · best of 5' }, { now });
  assert.equal(withIt.series, 'ALDS · Game 2 · NYY leads 1-0 · best of 5');
  assert.deepEqual(validate(withIt, TEAM), []);
});

test('surfaces: scoreboard card, MLB game page, Your teams, widget all draw it', () => {
  assert.match(src('components/scores/ScoreboardV4.js'), /x\.series \? <p className="sv4-series" data-series="1">\{x\.series\}<\/p>/);
  assert.match(src('lib/gridiron/scoresV2.js'), /series: seriesLines\.get\(g\.id\) \?\? null/);
  assert.match(src('app/mlb/game/[slug]/page.js'), /className="mg-series" data-series="1"/);
  assert.match(src('components/gridiron/TodayV2.js'), /className="tv-series" data-series="1"/);
  assert.match(src('lib/widget/reads.js'), /series: r\.game_id != null \? series\.get/);
});
