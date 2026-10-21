// lib/nba/pageFallback.test.mjs - the NBA page's early-season fallback (thu2-nba-page):
// pure selection in pagePre.js, then through nbaGameView with the feed injected. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seasonLabel, gamesPlayed, leadersSource, seasonLeadersFallback, last5Filled } from './pagePre.js';
import { nbaGameView } from './gamePageView.js';

const P = (id, last) => ({ id, first_name: 'F', last_name: last });
const avg = (id, last, pts, gp = 5) => ({ player: P(id, last), stats: { gp, pts, reb: 1, ast: 1, fg3m: 1 } });
const gm = (id, at, home, away, hs, as) => ({ key: String(id), bdlGameId: String(id), at, homeBdl: home, awayBdl: away, homeAbbr: `T${home}`, awayAbbr: `T${away}`, homeScore: hs, awayScore: as });

test('seasonLabel and gamesPlayed', () => {
  assert.equal(seasonLabel(2025), '2025-26');
  assert.equal(seasonLabel(2099), '2099-00');
  assert.equal(gamesPlayed([{ team: { id: 2 }, wins: 1, losses: 1 }], 2), 2);
  assert.equal(gamesPlayed([], 2), null);
});

test('leadersSource: < 3 games is last season, >= 3 is this season, unknown is this season', () => {
  assert.equal(leadersSource(0), 'prev');
  assert.equal(leadersSource(2), 'prev');
  assert.equal(leadersSource(3), 'this');
  assert.equal(leadersSource(null), 'this');
});

test('seasonLeadersFallback: each team takes its own source and carries its own label', () => {
  const side = (id) => ({ 1: 'away', 2: 'away', 3: 'home', 4: 'home' })[id] ?? null;
  const thisRows = [avg(1, 'AwayNow', 20), avg(3, 'HomeNow', 10)];
  const prevRows = [avg(2, 'AwayPrev', 25), avg(4, 'HomePrev', 12)];
  const r = seasonLeadersFallback({ thisRows, prevRows, rosterSide: side, src: { away: 'prev', home: 'this' }, season: 2026 });
  assert.deepEqual(r.from, { away: '2025-26', home: null });
  const pts = r.rows.find((x) => x.cat === 'PTS');
  assert.deepEqual(pts.away.map((p) => p.name), ['AwayPrev']);
  assert.deepEqual(pts.home.map((p) => p.name), ['HomeNow']);
  const both = seasonLeadersFallback({ thisRows, prevRows, rosterSide: side, src: { away: 'this', home: 'this' }, season: 2026 });
  assert.deepEqual(both.from, { away: null, home: null });
  assert.deepEqual(both.rows[0].away.map((p) => p.name), ['AwayNow']);
});

test('seasonLeadersFallback: a prev side with nobody qualifying stays on this season; nobody at all is null', () => {
  const side = (id) => (id === 1 ? 'away' : id === 3 ? 'home' : null);
  const r = seasonLeadersFallback({ thisRows: [avg(1, 'Now', 9)], prevRows: [], rosterSide: side, src: { away: 'prev', home: 'prev' }, season: 2026 });
  assert.deepEqual(r.from, { away: null, home: null });
  assert.equal(seasonLeadersFallback({ thisRows: [], prevRows: [], rosterSide: side, src: { away: 'prev', home: 'prev' }, season: 2026 }), null);
});

test('last5Filled: under five this season fills from last season after a divider label; five or more does not', () => {
  const cur = [gm(1, '2026-10-20T00:00Z', 7, 8, 100, 90), gm(2, '2026-10-22T00:00Z', 8, 7, 90, 95)];
  const prev = [1, 2, 3, 4, 5, 6].map((i) => gm(100 + i, `2026-04-0${i}T00:00Z`, 7, 8, 100 + i, 90));
  const r = last5Filled(cur, prev, 7, 2026);
  assert.equal(r.list.length, 5);
  assert.deepEqual(r.list.map((e) => !!e.prev), [false, false, true, true, true]);
  assert.equal(r.prevFrom, '2025-26');
  assert.equal(r.list[2].score, '106-90', 'newest last-season game first');
  const full = last5Filled([1, 2, 3, 4, 5].map((i) => gm(i, `2026-10-0${i}T00:00Z`, 7, 8, 100, 90)), prev, 7, 2026);
  assert.equal(full.list.length, 5);
  assert.equal(full.prevFrom, null);
  assert.ok(full.list.every((e) => !e.prev));
});

test('last5Filled: nothing at all is null; opening night is all last season', () => {
  assert.equal(last5Filled([], [], 7, 2026), null);
  const r = last5Filled([], [gm(1, '2026-04-01T00:00Z', 7, 8, 100, 90)], 7, 2026);
  assert.equal(r.list.length, 1);
  assert.ok(r.list[0].prev && r.prevFrom === '2025-26');
});

// ---- through the view
const game = () => ({
  id: -4243, bdlGameId: '901', slug: 'nba-test-fb', leagueSlug: 'nba', status: 'scheduled', kickoffAt: '2099-01-01T00:00:00Z',
  seasonYear: 2026, seasonPhase: 'regular', week: null, homeScore: null, awayScore: null, liveState: null, detail: {}, marketPrior: null,
  home: { id: 2, bdlId: '9', abbreviation: 'DET', name: 'Pistons', shortName: 'Pistons', colors: null },
  away: { id: 1, bdlId: '2', abbreviation: 'BOS', name: 'Celtics', shortName: 'Celtics', colors: null },
});
const pl = (id, team) => ({ id, first_name: 'F', last_name: 'Q', position: 'G', team_id: team });
const FINAL = { key: 'f1', bdlGameId: '800', at: '2026-10-20T19:00:00Z', homeBdl: '9', awayBdl: '2', homeAbbr: 'DET', awayAbbr: 'BOS', homeScore: 121, awayScore: 113 };

test('view: <3 games reads last season for that team\'s current roster, labelled; >= 3 reads this season; per team', async () => {
  const calls = [];
  const feed = {
    readOdds: async () => [], readInjuries: async () => ({ rows: [], fetchedAt: new Date() }), readLineups: async () => [],
    readStandings: async () => [{ team: { id: 2 }, wins: 1, losses: 0 }, { team: { id: 9 }, wins: 3, losses: 2 }],
    readRoster: async (t) => [pl(t === '2' ? 21 : 22, Number(t))],
    readSeasonAverages: async (season, ids) => {
      calls.push([season, [...ids].sort()]);
      return ids.map((id) => ({ player: pl(id, 0), stats: { gp: 5, pts: season === 2025 ? 30 : 20, reb: 1, ast: 1, fg3m: 1 } }));
    },
    readTeamGames: async (id, season) => (season === 2025
      ? [{ id: 5, status: 'Final', datetime: '2026-04-10T00:00:00Z', home_team: { id: Number(id), abbreviation: 'X' }, visitor_team: { id: 30, abbreviation: 'Y' }, home_team_score: 100, visitor_team_score: 90 }]
      : []),
  };
  const v = await nbaGameView({ game: game(), feed, finalsFn: async () => [FINAL] });
  assert.deepEqual(v.seasonLeadersFrom, { away: '2025-26', home: null });
  assert.deepEqual(calls.find(([s]) => s === 2025), [2025, [21]], 'only the early team, only its current roster');
  assert.equal(v.seasonLeaders[0].away[0].line, '30.0');
  assert.equal(v.seasonLeaders[0].home[0].line, '20.0');
  assert.equal(v.last5.away.length, 2, 'one this season + one filled');
  assert.equal(v.last5.away[1].prev, true);
  assert.equal(v.last5.prevFrom.away, '2025-26');
  assert.equal(v.last5.prevFrom.home, '2025-26', 'one final this season for the home side too');
});

test('view: a team with no games this season has no starters drawn (never last season\'s)', async () => {
  const feed = {
    readOdds: async () => [], readInjuries: async () => ({ rows: [], fetchedAt: new Date() }), readLineups: async () => [],
    readStandings: async () => [], readRoster: async () => [], readSeasonAverages: async () => [], readTeamGames: async () => [],
  };
  const v = await nbaGameView({ game: game(), feed, finalsFn: async () => [] });
  assert.equal(v.lineups, null);
});
