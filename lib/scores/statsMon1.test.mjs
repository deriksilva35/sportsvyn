// lib/scores/statsMon1.test.mjs - the Stats tab, mon-1: the Filters state and pipeline,
// scoring formats, D/ST with points allowed, the NFL window rule, the stat-line
// tokens, position rank, Half / Final, the hidden chips, the empty state and the
// league / Six readers (injected data - no real account).
//
// EXPECTED VALUES ARE WORKED BY HAND from the rules in the comments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nflWindow } from './nflWindow.js';
import {
  nflPoints, nflPointsBy, shapeRows, statsView, statsSport, STATS_CHIPS, nflStatLine, liveWords, firstTipWords, emptyState,
} from './statsTab.js';
import {
  parseState, toQuery, awayCount, defaultState, applyState, filterRows, onlyOpts,
} from './statsFilter.js';
import { mineKeys, leagueKeeperNames, readMineKeys } from './statsMine.js';
import { dstPointsAllowedPts, fantasyPoints } from '../fantasy/scoring.js';

// ---- scoring formats --------------------------------------------------------

test('PPR / Half PPR / Standard / Weekly differ only by the reception, and K / D/ST are not in the Weekly', () => {
  // WR: 9 rec, 147 yds, 1 TD. yards 14.7 + TD 6 = 20.7 before receptions.
  const wr = { position: 'WR', tgt: 11, rec: 9, rec_yds: 147, rec_td: 1 };
  const by = nflPointsBy(wr);
  assert.equal(by.ppr, 29.7);   // + 9 x 1.0
  assert.equal(by.half, 25.2);  // + 9 x 0.5 = 4.5
  assert.equal(by.std, 20.7);   // + 0
  assert.equal(by.weekly, 29.7); // the Weekly is PPR (rules.js WEEKLY_FORMAT), WR is in its pool
  const k = nflPointsBy({ position: 'PK', fgm: 2, fga: 3, xp: 3 });
  assert.equal(k.ppr, 9);       // 2 x 3 + 3 x 1
  assert.equal(k.weekly, null); // no kicker in the Weekly's pool
});

// ---- D/ST: one hand-computed line --------------------------------------------

test('D/ST scores the points-allowed tier from the opponent score', () => {
  // 3 sacks x 1 + 1 INT x 2 + 1 FR x 2 + 0 TD = 7; the opponent scored 13 -> tier 7-13 = +4. Total 11.
  const dst = { position: 'DEF', sacks: '3', def_int: 1, fr: 1, def_td: 0, pts_allowed: 13 };
  assert.equal(nflPoints(dst), 11);
  // and without the opponent's score it is the old partial 7 (every other caller of scoring.js)
  assert.equal(nflPoints({ ...dst, pts_allowed: null }), 7);
  // the tiers: shutout +10, 1-6 +7, 7-13 +4, 14-20 +1, 21-27 0, 28-34 -1, 35+ -4
  assert.deepEqual([0, 6, 7, 13, 14, 20, 21, 27, 28, 34, 35, 52].map(dstPointsAllowedPts), [10, 7, 4, 4, 1, 1, 0, 0, -1, -1, -4, -4]);
  assert.equal(dstPointsAllowedPts(null), null);
  // an offensive line never carries a tier
  assert.equal(fantasyPoints({ rec: 1 }, 'ppr'), 1);
});

test('shapeRows derives points allowed from the match score, per side', () => {
  const games = [{ id: 1, status: 'final', homeId: 10, awayId: 11, homeAbbr: 'BUF', awayAbbr: 'MIA', homeName: 'Bills', awayName: 'Dolphins', homeScore: 24, awayScore: 13, kickoffAt: '2026-09-13T17:00:00Z', lineScore: null }];
  const stats = [
    { match_id: 1, team_id: 10, position: 'DEF', sacks: '3', def_int: 1, fr: 1, def_td: 0 }, // BUF D allowed MIA's 13
    { match_id: 1, team_id: 11, position: 'DEF', sacks: '1', def_int: 0, fr: 0, def_td: 0 }, // MIA D allowed BUF's 24
  ];
  const rows = shapeRows('nfl', games, stats);
  const buf = rows.find((r) => r.name === 'Bills D/ST');
  const mia = rows.find((r) => r.name === 'Dolphins D/ST');
  assert.equal(buf.p.ppr, 11);  // 3 + 2 + 2 + 4
  assert.equal(mia.p.ppr, 1);   // 1 sack + tier 21-27 = 0
  assert.match(buf.line, /13 pts allowed/);
  assert.equal(buf.window, 'early'); // 17:00Z = 1:00 PM ET
});

// ---- the NFL window rule ---------------------------------------------------------

test('nflWindow: early < 3 PM ET, late 3-6:59 PM, Sunday 7 PM+ is SNF, Monday is MNF', () => {
  // September: ET = UTC-4. 2026-09-13 is a Sunday.
  assert.equal(nflWindow('2026-09-13T14:30:00Z'), 'early'); // 10:30 AM
  assert.equal(nflWindow('2026-09-13T18:59:00Z'), 'early'); // 2:59 PM
  assert.equal(nflWindow('2026-09-13T19:00:00Z'), 'late');  // 3:00 PM
  assert.equal(nflWindow('2026-09-13T22:59:00Z'), 'late');  // 6:59 PM
  assert.equal(nflWindow('2026-09-13T23:00:00Z'), 'snf');   // 7:00 PM
  assert.equal(nflWindow('2026-09-14T00:20:00Z'), 'snf');   // 8:20 PM Sunday
  assert.equal(nflWindow('2026-09-14T14:00:00Z'), 'mnf');   // Monday, any time
  assert.equal(nflWindow('2026-09-15T00:15:00Z'), 'mnf');   // Monday 8:15 PM
  assert.equal(nflWindow('2026-09-10T00:20:00Z'), 'late');  // Wednesday 8:20 PM: by the clock
  assert.equal(nflWindow('nonsense'), null);
  assert.equal(nflWindow(null), null);
});

// ---- the stat-line tokens (item 6) ---------------------------------------------------

test('stat lines are whole tokens: rush att-yds, rec rec-yds, rec/targets', () => {
  assert.equal(nflStatLine({ position: 'RB', rush_att: 3, rush_yds: 12, rec: 3, rec_yds: 18, tgt: 4, rush_td: 1 }),
    'rush 3-12 · rec 3-18 · 3/4 tgt · 1 TD');
  assert.equal(nflStatLine({ position: 'WR', rec: 2, rec_yds: 18, tgt: 4 }), 'rec 2-18 · 2/4 tgt');
  assert.equal(nflStatLine({ position: 'WR', rush_att: 1, rush_yds: 7, rec: 5, rec_yds: 60, tgt: 6, rec_td: 2, fumbles_lost: 1 }),
    'rec 5-60 · 5/6 tgt · rush 1-7 · 2 TD · 1 FUM');
  assert.equal(nflStatLine({ position: 'QB', pass_cmp: 24, pass_att: 33, pass_yds: 312, pass_td: 3, pass_int: 1, rush_att: 5, rush_yds: 41 }),
    '24/33 · 312 yds · 3 TD · 1 INT · rush 5-41');
  // never an ellipsis in the middle of a stat
  for (const line of [nflStatLine({ position: 'RB', rush_att: 18, rush_yds: 192, rec: 8, rec_yds: 101, tgt: 9 })]) assert.ok(!line.includes('…'));
});

// ---- Half / Final (item 8) -------------------------------------------------------------

test('Q2 at 0:00 reads Half, a live quarter reads its clock', () => {
  assert.equal(liveWords('nfl', { period: 2, clock: '00:00' }), 'Half');
  assert.equal(liveWords('nfl', { period: 2, clock: '0:00' }), 'Half');
  assert.equal(liveWords('nba', { period: 2, clock: '0:00' }), 'Half');
  assert.equal(liveWords('nfl', { period: 3, clock: '12:31' }), 'Q3 · 12:31');
  assert.equal(liveWords('nfl', { period: 5, clock: '9:00' }), 'OT · 9:00');
  assert.equal(liveWords('nfl', null), 'Live');
});

test('the pill reads the MATCH status: a final game never shows Q4 0:00', () => {
  const g = (status) => [{ id: 1, status, ls: { period: 4, clock: '0:00' }, homeId: 10, awayId: 11, homeAbbr: 'BUF', awayAbbr: 'MIA', homeName: 'Bills', awayName: 'Dolphins', lineScore: null }];
  const s = [{ match_id: 1, team_id: 10, nfl_player_id: 1, name: 'A', position: 'WR', rec: 1, rec_yds: 5, tgt: 1 }];
  assert.equal(shapeRows('nfl', g('final'), s)[0].pill, 'Final');
  assert.equal(shapeRows('nfl', g('final'), s)[0].status, 'final');
  assert.equal(shapeRows('nfl', g('live'), s)[0].pill, 'Q4 · 0:00');
});

// ---- hidden chips (item 9) -----------------------------------------------------------------

test('the Stats tab shows only the sports that are built', () => {
  assert.deepEqual(STATS_CHIPS.map(([k]) => k), ['nfl', 'nba']);
  assert.equal(statsSport('cfb'), 'nfl');
  assert.equal(statsSport('mlb'), 'nfl');
  assert.equal(statsSport('epl'), 'nfl');
  assert.equal(statsSport('nba'), 'nba');
});

// ---- empty state -------------------------------------------------------------------------------

test('empty state: first tip / first kickoff before the slate starts, "No NBA games today" only for an empty day', () => {
  assert.deepEqual(firstTipWords('nba', 5), { lead: 'First tip', tail: '5 games tonight' });
  assert.deepEqual(firstTipWords('nfl', 9), { lead: 'First kickoff', tail: '9 games today' });
  assert.deepEqual(firstTipWords('nba', 1), { lead: 'First tip', tail: '1 game tonight' });
  const v = statsView({ league: 'nba', games: [], stats: [], total: 5, firstKickoff: '2026-10-26T23:30:00.000Z' });
  assert.equal(v.empty, null);
  assert.deepEqual(v.firstTip, { lead: 'First tip', tail: '5 games tonight', iso: '2026-10-26T23:30:00.000Z' });
  const none = statsView({ league: 'nba', games: [], stats: [], total: 0 });
  assert.equal(none.empty, 'No NBA games today');
  assert.equal(none.firstTip, null);
  assert.equal(emptyState({ league: 'nba', rows: [], games: [], slate: 0, today: false }).text, 'No NBA games on this day');
  // a game under way with no lines yet is not "first tip"
  assert.match(emptyState({ league: 'nba', rows: [], games: [{ id: 1 }], slate: 3, firstKickoff: 'x' }).text, /No player stats yet/);
});

// ---- the filter state (the URL) ----------------------------------------------------------------

test('state round-trips through the query, defaults omitted, junk ignored', () => {
  const st = parseState('nfl', { sc: 'half', pos: 'WR', win: 'snf', min: '12', only: 'weekly', sort: 'yds', st: 'live', tg: 'buf' });
  assert.deepEqual(st, { sc: 'half', sort: 'yds', st: 'live', win: 'snf', q: '', tg: 'buf', pos: 'WR', only: 'weekly', min: 12 });
  assert.equal(awayCount('nfl', st), 8);
  const back = parseState('nfl', Object.fromEntries(toQuery('nfl', st)));
  assert.deepEqual(back, st);
  assert.deepEqual(toQuery('nfl', defaultState('nfl')), []);
  assert.equal(awayCount('nfl', defaultState('nfl')), 0);
  // junk and out-of-range
  const junk = parseState('nfl', { sc: 'bogus', sort: 'bogus', win: 'x', min: '999', only: 'x', pos: 'lower' });
  assert.deepEqual(junk, { ...defaultState('nfl'), min: 40 });
  // NBA: no windows, no PPR scorings; raw moves the points sort to a stat
  assert.equal(parseState('nba', { win: 'snf', sc: 'ppr' }).win, 'all');
  assert.equal(parseState('nba', { win: 'snf', sc: 'ppr' }).sc, 'espn');
  assert.equal(parseState('nba', { sc: 'raw' }).sort, 'pts');
  assert.equal(parseState('nfl', { sc: 'raw' }).sort, 'yds');
  // the search box is not a "filter away from default"
  assert.equal(awayCount('nfl', parseState('nfl', { q: 'allen' })), 0);
  // URLSearchParams works too
  assert.equal(parseState('nfl', new URLSearchParams('sc=std')).sc, 'std');
});

const rowsFixture = () => {
  const mk = (name, pos, p, sv, extra = {}) => ({ key: name, gameId: 1, name, pos, team: 'BUF', opp: 'MIA', tag: 'BUF v MIA', status: 'final', window: 'early', inMine: false, mineSrc: [], p, sv, ...extra });
  return [
    mk('Wide A', 'WR', { ppr: 30, half: 25, std: 20, weekly: 30 }, { yds: 150, td: 1, tgt: 11, att: 0 }),
    mk('Quarterback', 'QB', { ppr: 25, half: 25, std: 25, weekly: 25 }, { yds: 320, td: 3, tgt: 0, att: 2 }, { inMine: true, mineSrc: ['weekly'] }),
    mk('Wide B', 'WR', { ppr: 20, half: 16, std: 12, weekly: 20 }, { yds: 90, td: 0, tgt: 8, att: 0 }, { window: 'late' }),
    mk('Wide C', 'WR', { ppr: 10, half: 8, std: 6, weekly: 10 }, { yds: 40, td: 0, tgt: 3, att: 0 }, { status: 'live', window: 'snf', inMine: true, mineSrc: ['league'] }),
    mk('Kicker', 'K', { ppr: 9, half: 9, std: 9, weekly: null }, { yds: 0, td: 0, tgt: 0, att: 0 }),
  ];
};

test('position rank: with a position on, "WR2" big and the overall "#3" small; with none, the overall rank', () => {
  const none = applyState(rowsFixture(), defaultState('nfl'));
  assert.deepEqual(none.list.map((r) => [r.name, r.rank, r.posRank]), [
    ['Wide A', 1, null], ['Quarterback', 2, null], ['Wide B', 3, null], ['Wide C', 4, null], ['Kicker', 5, null],
  ]);
  const wr = applyState(rowsFixture(), { ...defaultState('nfl'), pos: 'WR' });
  // PPR order: Wide A 30, QB 25, Wide B 20, Wide C 10. Among WRs: A is WR1 (#1), B is WR2 (#3), C is WR3 (#4).
  assert.deepEqual(wr.list.map((r) => [r.name, r.posRank, r.rank]), [['Wide A', 1, 1], ['Wide B', 2, 3], ['Wide C', 3, 4]]);
});

test('scoring re-scores the list: Half PPR reorders, Sportsvyn Weekly drops the kicker, Raw shows no points', () => {
  const half = applyState(rowsFixture(), { ...defaultState('nfl'), sc: 'half' });
  assert.deepEqual(half.list.map((r) => [r.name, r.pts]), [['Quarterback', 25], ['Wide A', 25], ['Wide B', 16], ['Kicker', 9], ['Wide C', 8]]);
  const weekly = applyState(rowsFixture(), { ...defaultState('nfl'), sc: 'weekly' });
  assert.equal(weekly.list.some((r) => r.pos === 'K'), false);
  const raw = applyState(rowsFixture(), { ...defaultState('nfl'), sc: 'raw', sort: 'yds' });
  assert.deepEqual(raw.list.map((r) => r.name).slice(0, 3), ['Quarterback', 'Wide A', 'Wide B']);
  assert.ok(raw.list.every((r) => r.pts === null));
});

test('sort chips, status, window, only, min points and team text narrow the list', () => {
  const base = defaultState('nfl');
  const names = (o) => applyState(rowsFixture(), { ...base, ...o }).list.map((r) => r.name);
  assert.deepEqual(names({ sort: 'tgt' }).slice(0, 2), ['Wide A', 'Wide B']);
  assert.deepEqual(names({ st: 'live' }), ['Wide C']);
  assert.deepEqual(names({ st: 'pending' }), []); // not started: nothing to list
  assert.deepEqual(names({ win: 'late' }), ['Wide B']);
  assert.deepEqual(names({ win: 'snf' }), ['Wide C']);
  assert.deepEqual(names({ only: 'mine' }), ['Quarterback', 'Wide C']);
  assert.deepEqual(names({ only: 'weekly' }), ['Quarterback']);
  assert.deepEqual(names({ only: 'league' }), ['Wide C']);
  assert.deepEqual(names({ min: 20 }), ['Wide A', 'Quarterback', 'Wide B']);
  assert.deepEqual(names({ tg: 'mia @ buf' }).length, 5);
  assert.deepEqual(names({ tg: 'kc' }), []);
  assert.deepEqual(filterRows([{ name: 'X', pos: 'WR', team: 'A', opp: 'B', tag: 'A v B' }], { q: 'x' }).length, 1);
});

test('the Only choices need a signed-in reader; NBA calls its Weekly Tonight\'s Six', () => {
  assert.deepEqual(onlyOpts('nfl', false), []);
  assert.deepEqual(onlyOpts('nfl', true).map(([k]) => k), ['mine', 'weekly', 'draft', 'league']);
  assert.deepEqual(onlyOpts('nba', true).map(([k]) => k), ['mine', 'six', 'draft']);
});

// ---- "In your games": Six and fantasy leagues ---------------------------------------------------------

test('Tonight\'s Six lineup tags its players by BDL id, with the source', () => {
  const contests = [{ id: 9, game_type: 'six' }];
  const entries = [{ contest_id: 9, lineup: { G1: { matchId: 7, playerId: '55', name: 'A', team: 'DEN' }, F1: { matchId: 7, playerId: 66 }, C: null } }];
  const m = mineKeys({ league: 'nba', contests, entries });
  assert.deepEqual([...m.keys()].sort(), ['b:55', 'b:66']);
  assert.deepEqual([...m.get('b:55')], ['six']);
  // a Six lineup means nothing to the NFL board
  assert.equal(mineKeys({ league: 'nfl', contests, entries }).size, 0);
});

test('league rosters: a claimed franchise (or the owner\'s own) keepers, no one else\'s', () => {
  const memberships = [
    { config_id: 1, fantrax_team_id: 'ft2', role: 'member', teams: [] },
    { config_id: 2, fantrax_team_id: null, role: 'owner', teams: [{ fantraxTeamId: 'a', isMine: false }, { fantraxTeamId: 'b', isMine: true }] },
    { config_id: 3, fantrax_team_id: null, role: 'member', teams: [] }, // an unclaimed member has no franchise
  ];
  const keepers = [
    { config_id: 1, fantrax_team_id: 'ft2', player_name: 'Cam Ward' },
    { config_id: 1, fantrax_team_id: 'ft3', player_name: 'Not Mine' },
    { config_id: 2, fantrax_team_id: 'b', player_name: "Ja'Marr Chase" },
    { config_id: 2, fantrax_team_id: 'a', player_name: 'Other Owner' },
    { config_id: 3, fantrax_team_id: 'z', player_name: 'Unclaimed' },
  ];
  assert.deepEqual(leagueKeeperNames(memberships, keepers).sort(), ['cam ward', 'jamarr chase']);
  const m = mineKeys({ league: 'nfl', leagueKeys: ['n:5'] });
  assert.deepEqual([...m.get('n:5')], ['league']);
});

test('readMineKeys: contests, entries, memberships and keepers, one Map; signed out is null', async () => {
  const seen = [];
  const sql = (strings) => {
    const q = strings.join('?');
    seen.push(q);
    if (/FROM contests c/.test(q)) return Promise.resolve([{ id: 1, game_type: 'weekly' }, { id: 2, game_type: 'draft' }]);
    if (/FROM contest_entries/.test(q)) return Promise.resolve([{ contest_id: 1, lineup: { QB: 100, WR: 101 } }, { contest_id: 2, lineup: {}, meta: { roster: [{ id: 102 }] } }]);
    if (/draft_config_members/.test(q)) return Promise.resolve([{ config_id: 1, fantrax_team_id: 'ft2', role: 'member', teams: [] }]);
    if (/draft_config_keepers/.test(q)) return Promise.resolve([{ config_id: 1, fantrax_team_id: 'ft2', player_name: 'Cam Ward' }]);
    if (/FROM nfl_players/.test(q)) return Promise.resolve([{ id: 777, full_name: 'Cam Ward' }, { id: 778, full_name: 'Cam Warder' }]);
    return Promise.resolve([]);
  };
  const m = await readMineKeys({ userId: 5, league: 'nfl', date: '2026-09-13', games: [{ id: 1 }], sql });
  assert.deepEqual([...m.keys()].sort(), ['n:100', 'n:101', 'n:102', 'n:777']);
  assert.deepEqual([...m.get('n:100')], ['weekly']);
  assert.deepEqual([...m.get('n:102')], ['draft']);
  assert.deepEqual([...m.get('n:777')], ['league']);
  assert.equal(await readMineKeys({ userId: null, league: 'nfl', date: '2026-09-13', games: [{ id: 1 }], sql }), null);
  assert.equal((await readMineKeys({ userId: 5, league: 'nfl', date: '2026-09-13', games: [], sql })).size, 0);
});
