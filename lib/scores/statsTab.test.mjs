// lib/scores/statsTab.test.mjs - the Stats tab's pure half (sun-1).
//
// EXPECTED VALUES ARE WORKED BY HAND FROM THE RULES, in the comments, and the
// function under test never appears on the right-hand side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nflPoints, nbaPoints, shapeRows, statsView, filterRows, posChips, tilesOf, tagMine,
  wantTab, tabCookieString, TAB_COOKIE, gameTag, nflStatLine, nbaStatLine, statsSport, liveWords,
} from './statsTab.js';
import { mineKeys } from './statsMine.js';

// ---- the calculators ---------------------------------------------------

// Weekly rule (lib/weekly/rules.js -> scoring.js, PPR): pass yd 1/25, pass TD 4,
// INT -2, rush yd 1/10, rush TD 6, rec yd 1/10, rec TD 6, reception 1, fumble lost -2.
test('NFL points are the Weekly PPR calc: a QB line', () => {
  // 312 pass yds = 12.48; 3 pass TD = 12; 1 INT = -2; 41 rush yds = 4.1; 0 rush TD.
  // 12.48 + 12 - 2 + 4.1 = 26.58 -> 26.6
  const qb = { position: 'QB', pass_cmp: 24, pass_att: 33, pass_yds: 312, pass_td: 3, pass_int: 1, rush_att: 5, rush_yds: 41, rush_td: 0, fumbles_lost: 0 };
  assert.equal(nflPoints(qb), 26.6);
});

test('NFL points are the Weekly PPR calc: a WR line (the reception is a full point)', () => {
  // 9 rec = 9; 147 rec yds = 14.7; 1 rec TD = 6; -> 29.7
  const wr = { position: 'WR', tgt: 11, rec: 9, rec_yds: 147, rec_td: 1 };
  assert.equal(nflPoints(wr), 29.7);
});

test('NFL: a kicker and a defense are scored by scoring.js terms', () => {
  // K: 2 FG x 3 + 3 XP x 1 = 9
  assert.equal(nflPoints({ position: 'PK', fgm: 2, fga: 3, xp: 3 }), 9);
  // DST: 3 sacks x 1 + 1 INT x 2 + 1 fumble recovery x 2 + 0 TD = 7
  assert.equal(nflPoints({ position: 'DEF', sacks: '3', def_int: 1, fr: 1, def_td: 0 }), 7);
});

// NBA Nightly (ESPN points): PTS 1, 3PM 1, FGM 2, FGA -1, FTM 1, FTA -1, REB 1, AST 2, STL 4, BLK 4, TOV -2.
test('NBA points are the Nightly ESPN calc', () => {
  // 28 pts + 2 3PM(2) + 10 FGM(20) - 20 FGA + 6 FTM(6) - 8 FTA + 14 reb + 9 ast(18) + 1 stl(4) + 0 blk - 3 tov(6)
  // = 28 + 2 + 20 - 20 + 6 - 8 + 14 + 18 + 4 - 6 = 58
  const row = { pts: 28, fg3m: 2, fgm: 10, fga: 20, ftm: 6, fta: 8, reb: 14, ast: 9, stl: 1, blk: 0, turnovers: 3 };
  assert.equal(nbaPoints(row), 58);
});

// ---- fixtures: one NFL day ----------------------------------------------

const games = [
  { id: 1, status: 'live', ls: { period: 4, clock: '3:12' }, homeId: 10, awayId: 11, homeAbbr: 'BUF', awayAbbr: 'MIA', homeName: 'Bills', awayName: 'Dolphins', homeC1: '#00338D', homeC2: '#C60C30', awayC1: '#008E97', awayC2: '#FC4C02' },
  { id: 2, status: 'final', ls: null, homeId: 12, awayId: 13, homeAbbr: 'KC', awayAbbr: 'SF', homeName: 'Chiefs', awayName: '49ers', homeC1: '#E31837', homeC2: '#FFB81C', awayC1: '#AA0000', awayC2: '#B3995D' },
];
const stats = [
  { match_id: 1, team_id: 10, nfl_player_id: 100, name: 'Josh Allen', position: 'QB', pass_cmp: 24, pass_att: 33, pass_yds: 312, pass_td: 3, pass_int: 1, rush_att: 5, rush_yds: 41, rush_td: 0 },
  { match_id: 1, team_id: 11, nfl_player_id: 101, name: 'Tyreek Hill', position: 'WR', tgt: 9, rec: 7, rec_yds: 118, rec_td: 1 },
  { match_id: 2, team_id: 12, nfl_player_id: 102, name: 'Travis Kelce', position: 'TE', tgt: 10, rec: 8, rec_yds: 92, rec_td: 1 },
  { match_id: 2, team_id: 13, nfl_player_id: 103, name: 'Backup Qb', position: 'QB' }, // rostered, no line: has not played
  { match_id: 1, team_id: 10, position: 'DEF', sacks: '3', def_int: 1, fr: 0, def_td: 0 },
];

test('rows: only players who played, sorted by points, ranked from 1', () => {
  const rows = shapeRows('nfl', games, stats);
  // Allen 26.6 (above). Hill: 7 + 11.8 + 6 = 24.8. Kelce: 8 + 9.2 + 6 = 23.2. BUF D/ST: 3 + 2 = 5.
  assert.deepEqual(rows.map((r) => [r.rank, r.name, r.pts]), [
    [1, 'Josh Allen', 26.6], [2, 'Tyreek Hill', 24.8], [3, 'Travis Kelce', 23.2], [4, 'Bills D/ST', 5],
  ]);
  assert.equal(rows.find((r) => r.name === 'Backup Qb'), undefined);
});

test('rows: the team + opp tag, and the pill', () => {
  const rows = shapeRows('nfl', games, stats);
  const allen = rows.find((r) => r.name === 'Josh Allen');
  const hill = rows.find((r) => r.name === 'Tyreek Hill');
  assert.equal(allen.tag, 'BUF v MIA');
  assert.equal(hill.tag, 'MIA @ BUF');
  assert.equal(allen.pill, 'Q4 · 3:12');
  assert.equal(allen.status, 'live');
  assert.equal(rows.find((r) => r.name === 'Travis Kelce').pill, 'Final');
  assert.equal(gameTag('KC', 'SF', true), 'KC v SF');
});

test('stat lines read on one line, with middots', () => {
  assert.equal(nflStatLine(stats[1]), '7/9 · 118 yds · 1 TD');
  assert.equal(nbaStatLine({ pts: 28, reb: 14, ast: 9, stl: 1, blk: 0, fg3m: 2 }), '28 pts · 14 reb · 9 ast · 1 stl · 2 3pm');
});

// ---- the tiles ------------------------------------------------------------

test('tiles: top scorer, your players, biggest game by total points', () => {
  const mine = new Set(['n:100', 'n:102']);
  const v = statsView({ league: 'nfl', games, stats, mine, signedIn: true });
  assert.deepEqual(v.tiles.top, { name: 'Josh Allen', pts: 26.6 });
  // Allen 26.6 + Bills D/ST 5 + Hill 24.8 = 56.4 for MIA @ BUF; Kelce 23.2 alone for SF @ KC.
  assert.deepEqual(v.tiles.biggest, { tag: 'MIA @ BUF', pts: 56.4 });
  assert.deepEqual(v.tiles.yours, { count: 2, pts: 49.8 }); // 26.6 + 23.2
  assert.equal(v.showMine, true);
  assert.equal(v.rows.filter((r) => r.inMine).length, 2);
});

// ---- signed out -------------------------------------------------------------

test('signed out: no tag on any row, no My players chip, no your-players tile', () => {
  // even if a caller handed keys through, a signed-out view ignores them
  const v = statsView({ league: 'nfl', games, stats, mine: new Set(['n:100']), signedIn: false });
  assert.equal(v.showMine, false);
  assert.equal(v.tiles.yours, null);
  assert.equal(v.rows.some((r) => r.inMine), false);
  assert.equal(tilesOf(v.rows, { signedIn: false }).yours, null);
});

// ---- empty day ----------------------------------------------------------------

test('empty day: a clear message, not a blank board', () => {
  const none = statsView({ league: 'nfl', games: [], stats: [], signedIn: false });
  assert.equal(none.empty, 'No NFL games on this day.');
  assert.deepEqual(none.rows, []);
  const noStats = statsView({ league: 'nba', games: [games[0]], stats: [], signedIn: true, mine: new Set() });
  assert.match(noStats.empty, /No player stats yet/);
});

test('other sports say coming soon', () => {
  assert.equal(statsView({ league: 'cfb', games: [], stats: [] }).soon, 'Stats for CFB coming soon');
  assert.equal(statsView({ league: 'epl', games: [], stats: [] }).supported, false);
  assert.equal(statsSport('all'), 'nfl');
  assert.equal(statsSport('nba'), 'nba');
});

// ---- the filters ---------------------------------------------------------------

test('filters: search by name, team and game; position; status; mine', () => {
  const rows = tagMine(shapeRows('nfl', games, stats), new Set(['n:102']));
  const names = (o) => filterRows(rows, o).map((r) => r.name);
  assert.deepEqual(names({ q: 'allen' }), ['Josh Allen']);
  assert.deepEqual(names({ q: 'kc' }), ['Travis Kelce']);
  assert.deepEqual(names({ q: 'mia @ buf' }).sort(), ['Bills D/ST', 'Josh Allen', 'Tyreek Hill']);
  assert.deepEqual(names({ pos: 'TE' }), ['Travis Kelce']);
  assert.deepEqual(names({ status: 'final' }), ['Travis Kelce']);
  assert.deepEqual(names({ mine: true }), ['Travis Kelce']);
  assert.equal(filterRows(rows, {})[0].rank, 1);
});

test('position chips are only the positions the data holds', () => {
  assert.deepEqual(posChips('nfl', shapeRows('nfl', games, stats)), ['All', 'QB', 'WR', 'TE', 'DST']);
  assert.deepEqual(posChips('nba', [{ pos: 'G' }, { pos: 'F-C' }]), ['All', 'G', 'F', 'C']);
});

// ---- NBA rows ----------------------------------------------------------------------

test('NBA rows: ESPN points, live pill, G-F matches the G and F chips', () => {
  const g = [{ id: 7, status: 'live', ls: { period: 3, clock: '6:02' }, homeId: 1, awayId: 2, homeAbbr: 'DEN', awayAbbr: 'OKC', homeName: 'Nuggets', awayName: 'Thunder', lineScore: [] }];
  const s = [{ match_id: 7, team_id: 2, bdl_player_id: '55', player_name: 'Guard Forward', position: 'G-F', seconds: 1500, dnp: false, pts: 10, fgm: 4, fga: 8, fg3m: 0, ftm: 2, fta: 2, reb: 3, ast: 3, stl: 0, blk: 0, turnovers: 1 }];
  const rows = shapeRows('nba', g, s);
  // 10 + 0 + 8 - 8 + 2 - 2 + 3 + 6 + 0 + 0 - 2 = 17
  assert.equal(rows[0].pts, 17);
  assert.equal(rows[0].tag, 'OKC @ DEN');
  assert.equal(rows[0].pill, liveWords('nba', { period: 3, clock: '6:02' }));
  assert.equal(rows[0].key, 'b:55');
  assert.equal(filterRows(rows, { pos: 'F' }).length, 1);
  assert.equal(filterRows(rows, { pos: 'C' }).length, 0);
});

// ---- the cookie -----------------------------------------------------------------------

test('the tab cookie: Games by default, the query wins, the cookie remembers', () => {
  assert.equal(wantTab(undefined, null), 'games');
  assert.equal(wantTab(undefined, 'stats'), 'stats');
  assert.equal(wantTab('games', 'stats'), 'games');
  assert.equal(wantTab('stats', 'games'), 'stats');
  assert.equal(wantTab('nonsense', 'nonsense'), 'games');
  assert.equal(TAB_COOKIE, 'sv_scores_tab');
  assert.equal(tabCookieString('stats'), 'sv_scores_tab=stats; Path=/; Max-Age=31536000; SameSite=Lax');
  assert.equal(tabCookieString('games'), 'sv_scores_tab=games; Path=/; Max-Age=31536000; SameSite=Lax');
});

// ---- "in your games" (pure, injected data; no real account) ----------------------------

test('in your games: Weekly, Draft, Game Drafts and the NBA Nightly each tag their players', () => {
  const contests = [
    { id: 1, game_type: 'weekly' }, { id: 2, game_type: 'draft' }, { id: 3, game_type: 'draft_game' }, { id: 4, game_type: 'draft_game' },
  ];
  const entries = [
    { contest_id: 1, lineup: { QB1: 100, WR1: 101, RB1: null } },
    { contest_id: 2, lineup: {}, meta: { roster: [{ id: 102, name: 'x' }] } },
    // seat 2 is the reader; seat 1's pick (999) is a bot's
    { contest_id: 3, lineup: {}, meta: { room: { seat: 2, picks: [{ n: 1, seat: 1, id: 999 }, { n: 2, seat: 2, id: 103 }] } } },
    { contest_id: 4, lineup: {}, meta: {} }, // no room started
  ];
  assert.deepEqual([...mineKeys({ league: 'nfl', contests, entries })].sort(), ['n:100', 'n:101', 'n:102', 'n:103']);
  // NBA: only draft_game counts, keyed on the BDL id
  assert.deepEqual([...mineKeys({ league: 'nba', contests, entries })], ['b:103']);
  assert.deepEqual([...mineKeys({ league: 'nfl' })], []);
});
