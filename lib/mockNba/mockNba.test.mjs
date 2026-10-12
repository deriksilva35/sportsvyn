// lib/mockNba/mockNba.test.mjs - the NBA mock draft, pure (sun-5, sun-7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fppg, fppgWith, svValue, GAMES, POINTS_LEAGUE, SCORING_PRESETS } from './scoring.js';
import { eligible, SLOTS, ROUNDS, TEAMS, emptyRoster, place, rosterFromIds, slotsFromCounts, checkFillable, ROSTER_PRESETS } from './roster.js';
import { createMock, runBots, applyPick, legalFor, isDone, onClock, bestFor, totalPicks, autoPickOnExpiry, autoDraftRest, botPick } from './draft.js';
import { gradeMock } from './grade.js';
import { encodeShare, decodeShare } from './share.js';
import { shapeNbaMockPool, POOL_MIN } from './pool.js';
import { rankPool, projection, ageFactor, ageOf, ROOKIE_BASE, MIN_GP } from './rank.js';
import { DEFAULT_SETTINGS, normalizeSettings, serializeSettings, parseSettings, slotsOf, weightsOf } from './settings.js';
import { parseAdpList, matchAdp, withAdp, adpEnabled, normName, feedTeam } from './adp.js';
import { cleanMockRecord } from './record.js';

// A synthetic pool shaped like the real one: per-game lines, coarse positions, some list positions.
const POS = ['G', 'G', 'F', 'F', 'G', 'F', 'C', 'G-F', 'F-C', 'G', 'F', 'C-F'];
const LISTED = [['PG'], ['SG', 'PG'], ['SF'], ['PF', 'SF'], null, null, ['C'], null, ['PF', 'C'], ['PG', 'SG'], null, ['C', 'PF']];
const line = (i) => ({ gp: 70, pts: 30 - i * 0.08, reb: POS[i % 12].includes('C') ? 10 : 4, ast: 4, stl: 1, blk: POS[i % 12].includes('C') ? 2.5 : 0.3, fg3m: 2, fgm: 9, fga: 18, ftm: 4, fta: 5, tov: 2, fg_pct: 0.5, ft_pct: 0.8 });
const raw = (n = 300) => Array.from({ length: n }, (_, i) => ({
  id: 1000 + i, name: `Player ${i}`, pos: POS[i % 12], team: 'AAA', s: line(i), rookie: false,
  ...(LISTED[i % 12] ? { positions: LISTED[i % 12] } : {}),
}));
const pool = (n = 300, w) => rankPool(raw(n), w).map((p, i) => ({ ...p, adp: (i * 7) % n + 1 }));

const playOut = (st, pickIx = () => 0) => {
  let s = runBots(st);
  while (!isDone(s)) { const legal = legalFor(s, s.userSeat); s = runBots(applyPick(s, legal[pickIx(s, legal) % legal.length].id, 'user')); }
  return s;
};
const assertLegal = (st) => {
  for (const r of st.rosters) {
    assert.equal(r.filter((x) => x.player).length, st.slots.length, 'every slot filled');
    for (const x of r) if (x.slot !== 'BN') assert.ok(eligible(x.player).has(x.slot), `${x.player.name} (${x.player.positions ?? x.player.pos}) in ${x.slot}`);
  }
  assert.equal(new Set(st.picks.map((x) => x.id)).size, totalPicks(st), 'nobody taken twice');
};

test('scoring: the points presets as ruled; FP/G under any weights; 75 games for everyone', () => {
  assert.deepEqual(POINTS_LEAGUE, { pts: 1, fg3m: 1, fga: -1, fgm: 2, fta: -1, ftm: 1, reb: 1, ast: 2, stl: 4, blk: 4, tov: -2 });
  assert.equal(SCORING_PRESETS.standard.weights, POINTS_LEAGUE);
  const s = { gp: 70, pts: 25, fg3m: 2, fga: 18, fgm: 9, fta: 6, ftm: 5, reb: 8, ast: 6, stl: 1, blk: 1, tov: 3 };
  assert.equal(fppg(s), 25 + 2 - 18 + 18 - 6 + 5 + 8 + 12 + 4 + 4 - 6);
  assert.equal(fppg({ ...s, tov: undefined, turnover: 3 }), fppg(s), 'the feed\'s turnover key reads too');
  assert.equal(fppgWith(s, SCORING_PRESETS.simple.weights), Math.round((25 + 8 * 1.2 + 6 * 1.5 + 3 + 3 - 3) * 10) / 10);
  assert.equal(GAMES, 75);
  assert.equal(svValue(fppg(s)), Math.round(fppg(s) * 75), 'no games-played term: last season\'s absences carry no penalty');
  assert.equal(fppg({ gp: 0, pts: 10 }), null);
});

test('SVP v2: 65/35 blend, one season used alone, thin seasons skipped, age curve on the per-game number', () => {
  const line = (pts, gp, age) => ({ gp, pts, age });
  const flat = { ...Object.fromEntries(Object.keys(POINTS_LEAGUE).map((k) => [k, 0])), pts: 1 };
  assert.equal(projection({ s: line(40, 70, 27), s2: line(20, 70, 26) }, flat).fppg, 33, '0.65 x 40 + 0.35 x 20');
  assert.equal(projection({ s: line(40, 70, 27), s2: null }, flat).fppg, 40, 'one season: use it');
  assert.equal(projection({ s: line(40, MIN_GP - 1, 27), s2: line(20, 70, 26) }, flat).fppg, 20, 'a thin last season does not count; the full one stands');
  assert.equal(projection({ s: line(30, 60, 25), s2: null, prior: true }, flat).age, 27, 'a prior-only line is two seasons old');
  assert.equal(projection({ s: line(40, 70, 21), s2: null }, flat).fppg, 43.2, 'age 22 in the new season: +8%');
  assert.deepEqual([18, 22, 23, 25, 26, 30, 31, 33, 34, 40, null].map(ageFactor), [1.08, 1.08, 1.04, 1.04, 1, 1, 0.96, 0.96, 0.92, 0.92, 1]);
  assert.equal(ageOf({ s: { age: 30 } }), 31); assert.equal(ageOf({ s: { age: null } }), null); assert.equal(ageOf({}), null);
  // Ranks follow the projection: a 33-year-old and a 22-year-old with the same line part ways.
  const r = rankPool([{ id: 1, name: 'old', s: line(40, 70, 33) }, { id: 2, name: 'young', s: line(40, 70, 21) }], flat);
  assert.deepEqual(r.map((x) => [x.name, x.svp, x.sv]), [['young', 1, Math.round(43.2 * 75)], ['old', 2, Math.round(36.8 * 75)]]);
});

test('CUSTOM SCORING CHANGES RANKS: score points only and the big men fall', () => {
  const base = rankPool(raw());
  const blocky = rankPool(raw(), Object.fromEntries(Object.keys(POINTS_LEAGUE).map((k) => [k, k === 'pts' ? 1 : 0])));
  const cTop = (r) => r.slice(0, 30).filter((p) => eligible(p).has('C')).length;
  assert.ok(cTop(blocky) < cTop(base), `centers in the top 30: ${cTop(base)} -> ${cTop(blocky)}`);
  assert.notDeepEqual(base.slice(0, 20).map((p) => p.id), blocky.slice(0, 20).map((p) => p.id));
  assert.ok(blocky.every((r, i) => r.svp === i + 1));
});

test('positions: the list\'s eligibility when present, else G/F/C; UTIL for all', () => {
  assert.deepEqual([...eligible('G')].sort(), ['G', 'PG', 'SG', 'UTIL']);
  assert.deepEqual([...eligible('F-C')].sort(), ['C', 'F', 'PF', 'SF', 'UTIL']);
  assert.deepEqual([...eligible({ pos: 'G', positions: ['PG'] })].sort(), ['G', 'PG', 'UTIL'], 'a listed PG is not an SG');
  assert.deepEqual([...eligible({ pos: 'F', positions: ['C', 'PF'] })].sort(), ['C', 'F', 'PF', 'UTIL']);
  assert.deepEqual([...eligible({ pos: 'C', positions: [] })].sort(), ['C', 'UTIL'], 'an empty list falls back');
  assert.deepEqual(SLOTS, ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'UTIL', 'UTIL', 'BN', 'BN', 'BN'], 'the standard roster (sun-6)');
  assert.deepEqual(slotsFromCounts(ROSTER_PRESETS.twoc.counts), ['PG', 'SG', 'SF', 'PF', 'C', 'C', 'G', 'F', 'UTIL', 'UTIL', 'BN', 'BN', 'BN']);
  assert.equal(ROUNDS, 13); assert.equal(TEAMS, 12);
  let r = emptyRoster();
  for (const id of [1, 2, 3]) r = place(r, { id, pos: 'G', name: String(id) });
  assert.deepEqual(r.filter((x) => x.player).map((x) => x.slot), ['PG', 'SG', 'G'], 'most specific first, then G');
});

test('pool: last season ranks the vets; a player who missed it ranks on the season before; first-round rookies by slot', () => {
  const roster = [
    ...Array.from({ length: 90 }, (_, i) => ({ id: i + 1, first_name: 'V', last_name: String(i), position: 'G', team: { abbreviation: 'AAA' } })),
    { id: 900, first_name: 'Top', last_name: 'Rookie', position: 'F', draft_year: 2026, draft_round: 1, draft_number: 1, team: { abbreviation: 'BBB' } },
    { id: 901, first_name: 'Late', last_name: 'Second', position: 'G', draft_year: 2026, draft_round: 2, draft_number: 45, team: {} },
    { id: 902, first_name: 'No', last_name: 'Line', position: 'C', draft_year: 2019, draft_round: 1, draft_number: 9, team: {} },
    { id: 903, first_name: 'Hurt', last_name: 'Star', position: 'G', draft_year: 2020, draft_round: 1, draft_number: 12, team: { abbreviation: 'IND' } },
  ];
  const averages = new Map(Array.from({ length: 90 }, (_, i) => [String(i + 1), { gp: 70, pts: 30 - i * 0.3, reb: 5, ast: 3 }]));
  const prior = new Map([['903', { gp: 73, pts: 40, reb: 6, ast: 10, turnover: 3, age: 25 }], ['1', { gp: 70, pts: 20, reb: 5, ast: 3, age: 28 }]]);
  const rows = shapeNbaMockPool(roster, averages, { prior, out: new Set(['2']) });
  assert.equal(rows.length, 92, '90 vets + the rookie + the injured star');
  assert.ok(rows.every((r, i) => r.svp === i + 1 && r.rank === i + 1));
  const star = rows.find((r) => r.id === 903);
  assert.equal(star.prior, true); assert.equal(star.s.season, 2024); assert.equal(star.svp, 1);
  assert.equal(rows.find((r) => r.id === 1).s.season, 2025);
  assert.equal(rows.find((r) => r.id === 1).s2.season, 2024, 'the season before is kept for the blend');
  assert.equal(rows.find((r) => r.id === 2).out, true, 'Out on the injury report: flagged');
  assert.equal(rows.find((r) => r.id === 3).out, undefined);
  assert.equal(star.s.age, 25);
  const rk = rows.find((r) => r.id === 900);
  assert.equal(rk.rookie, true);
  assert.equal(rk.svp, ROOKIE_BASE + 1, 'the #1 pick slots in just below the vet ranked ROOKIE_BASE');
  assert.ok(!rows.some((r) => r.id === 901 || r.id === 902));
  // A row stored before sun-7 (no line) keeps its stored value rather than becoming a "rookie".
  const old = rankPool([{ id: 1, name: 'a', sv: 100 }, { id: 2, name: 'b', sv: 300 }]);
  assert.deepEqual(old.map((r) => [r.id, r.svp]), [[2, 1], [1, 2]]);
});

test('bots never stall and every team fills legally - every seat, many seeds, both bot keys', () => {
  const p = pool();
  for (const botKey of ['adp', 'svp']) {
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const userSeat of [0, 5, 11]) {
        const st = playOut(createMock(p, { userSeat, seed, botKey }), (s) => seed * 7 + s.picks.length);
        assert.equal(st.picks.length, 156);
        assertLegal(st);
      }
    }
  }
});

test('A CUSTOM ROSTER IS FILLABLE OR BLOCKED WITH A CLEAR MESSAGE - never a stall', () => {
  const p = pool();
  assert.match(checkFillable(p, [], 12).message, /at least one roster spot/);
  assert.match(checkFillable(p, ['BN', 'BN'], 12).message, /starting spot/);
  assert.match(checkFillable(p, slotsFromCounts({ PG: 4, SG: 4, SF: 4, PF: 4, C: 4, G: 4, F: 4, UTIL: 4, BN: 4 }), 14).message, /more than the pool can supply\. Use \d+ spots or fewer/);
  const noC = p.filter((x) => !eligible(x).has('C'));
  assert.match(checkFillable(noC.concat(p.filter((x) => eligible(x).has('C')).slice(0, 10)), slotsFromCounts({ C: 2, UTIL: 1 }), 12).message, /Not enough centers: 12 teams need 24 and the pool has 10\./);
  assert.match(checkFillable(p.filter((x) => !eligible(x).has('G')).concat(p.filter((x) => eligible(x).has('G')).slice(0, 20)), slotsFromCounts({ PG: 1, G: 1, UTIL: 1 }), 12).message, /Not enough guards: 12 teams need 24 and the pool has 20\./);
  // Every roster the checker passes drafts to the end, legally (seeded sweep).
  let passed = 0;
  for (let k = 0; k < 40; k += 1) {
    const counts = Object.fromEntries(['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'BN'].map((s, j) => [s, (k * 7 + j * 3) % 5]));
    const slots = slotsFromCounts(counts); const teams = 8 + (k % 7);
    const chk = checkFillable(p, slots, teams);
    if (!chk.ok) { assert.ok(chk.message.length > 10); continue; }
    passed += 1;
    const st = playOut(createMock(p, { userSeat: k % teams, seed: k + 1, teams, slots }));
    assert.equal(st.picks.length, teams * slots.length); assertLegal(st);
  }
  assert.ok(passed >= 8, `the sweep exercised ${passed} fillable rosters`);
});

test('AUTO-DRAFT THE REST fills legally from any point; THE CLOCK auto-picks on expiry', () => {
  const p = pool();
  let st = runBots(createMock(p, { userSeat: 4, seed: 77 }));
  st = runBots(applyPick(st, legalFor(st, 4)[2].id, 'user'));
  const done = autoDraftRest(st);
  assert.ok(isDone(done)); assertLegal(done);
  assert.ok(done.picks.filter((x) => x.seat === 4).slice(1).every((x) => x.by === 'auto'));
  // Clock: on expiry the user's pick is the bots' pick for that seat, marked auto, and the bots run on.
  const s0 = runBots(createMock(p, { userSeat: 6, seed: 5, teams: 10, botKey: 'adp' }));
  const asBot = botPick(s0, 6);
  const s1 = autoPickOnExpiry(s0);
  assert.equal(s1.picks.find((x) => x.seat === 6).id, asBot.id);
  assert.equal(s1.picks.find((x) => x.seat === 6).by, 'auto');
  assert.equal(onClock(s1), 6, 'the bots ran to the user\'s next pick');
  assert.equal(autoPickOnExpiry(autoDraftRest(s1)).picks.length, 130, 'a finished draft is left alone');
});

test('AUTO-DRAFT GRADES SPREAD: 20 auto-drafts land on more than one grade, not all A+', () => {
  const p = pool();
  const grades = [];
  for (let k = 0; k < 20; k += 1) {
    const st = autoDraftRest(createMock(p, { userSeat: k % 12, seed: 1000 + k, botKey: 'adp' }));
    assertLegal(st);
    grades.push(gradeMock(st).grade);
  }
  const by = grades.reduce((m, g) => ({ ...m, [g]: (m[g] ?? 0) + 1 }), {});
  assert.ok(Object.keys(by).length >= 4, `grades ${JSON.stringify(by)}`);
  assert.ok((by['A+'] ?? 0) <= 10, `A+ ${by['A+'] ?? 0} of 20`);
});

test('KILL SWITCH MOCK_ADP_SOURCE: on shows ADP and the bots use it; off hides it and the bots use SVP', () => {
  assert.equal(adpEnabled({}), true); assert.equal(adpEnabled({ MOCK_ADP_SOURCE: 'on' }), true);
  assert.equal(adpEnabled({ MOCK_ADP_SOURCE: 'off' }), false); assert.equal(adpEnabled({ MOCK_ADP_SOURCE: ' OFF ' }), false);
  const rows = rankPool(raw(40));
  const map = new Map([[rows[30].id, { adp: 1, positions: ['C'] }]]);
  const on = withAdp(rows, map, { on: true }); const off = withAdp(rows, map, { on: false });
  assert.equal(on.find((r) => r.id === rows[30].id).adp, 1);
  assert.deepEqual(on.find((r) => r.id === rows[30].id).positions, ['C']);
  assert.ok(off.every((r) => r.adp === undefined), 'off: no ADP anywhere in the rows');
  assert.ok(withAdp(on, map, { on: false }).every((r) => r.adp === undefined && r.positions === undefined), 'off strips a stale column too');
  // The first bot (seat 0, userSeat 5) takes the ADP 1 player with ADP on; SVP 1 with it off.
  const bOn = botPick(createMock(on, { userSeat: 5, seed: 3, botKey: 'adp' }), 0);
  const bOff = botPick(createMock(off, { userSeat: 5, seed: 3, botKey: 'svp' }), 0);
  assert.ok([rows[30].id].includes(bOn.id) || bOn.adp == null || bOn.adp <= 1, `adp bot took ${bOn.name}`);
  assert.ok(bOff.svp <= 3, `svp bot took SVP ${bOff.svp}`);
  // Players with no ADP sort after every ranked one for an ADP bot.
  const st = runBots(createMock(on, { userSeat: 11, seed: 9, teams: 8, slots: ['UTIL'], botKey: 'adp' }));
  assert.equal(st.picks[0].id, rows[30].id);
});

test('ADP import: the list file carries rank, name, team, positions and NOTHING else', () => {
  const text = readFileSync(new URL('./data/adp-2026-10-11.tsv', import.meta.url), 'utf8');
  const lines = text.trim().split('\n');
  assert.ok(lines.every((l) => l.split('\t').length === 4), 'four fields per row - no stats, no projected points');
  const list = parseAdpList(text);
  assert.equal(list.length, 500);
  assert.deepEqual(list.map((x) => x.rank), Array.from({ length: 500 }, (_, i) => i + 1));
  assert.ok(list.every((x) => x.positions.every((p) => ['PG', 'SG', 'SF', 'PF', 'C'].includes(p))));
});

test('ADP match: normalised names, short names, team tie-break, team differences reported (ours kept), unmatched listed', () => {
  assert.equal(normName('Luka Dončić'), 'luka doncic');
  assert.equal(normName("Jaren Jackson Jr."), 'jaren jackson');
  assert.equal(normName("D'Angelo Russell"), 'dangelo russell');
  assert.equal(feedTeam('UTAH'), 'UTA'); assert.equal(feedTeam('WSH'), 'WAS'); assert.equal(feedTeam('FA'), null); assert.equal(feedTeam('BOS'), 'BOS');
  const ourPool = [
    { id: 1, name: 'Luka Doncic', team: 'LAL' }, { id: 2, name: 'Alexandre Sarr', team: 'WAS' },
    { id: 3, name: 'Jalen Williams', team: 'OKC' }, { id: 4, name: 'Jalen Williams', team: 'NYK' },
    { id: 5, name: 'Trae Young', team: 'WAS' },
  ];
  const list = parseAdpList('1\tLuka Dončić\tLAL\tPG,SG\n2\tAlex Sarr\tWSH\tC\n3\tJalen Williams\tOKC\tSG,SF\n4\tTrae Young\tATL\tPG\n5\tNobody Here\tFA\t\n');
  const { matched, unmatched, staleTeams } = matchAdp(list, ourPool);
  assert.deepEqual(matched.map((m) => [m.player_id, m.adp_rank]), [[1, 1], [2, 2], [3, 3], [5, 4]]);
  assert.deepEqual(matched[0].positions, ['PG', 'SG']);
  assert.deepEqual(unmatched, [{ rank: 5, name: 'Nobody Here', team: 'FA' }]);
  assert.deepEqual(staleTeams, [{ rank: 4, name: 'Trae Young', listTeam: 'ATL', ourTeam: 'WAS' }]);
});

test('SAVED SETTINGS ROUND-TRIP; anything malformed falls back field by field', () => {
  const s = normalizeSettings({ ...DEFAULT_SETTINGS, teams: 10, seat: 7, scoring: 'custom', customWeights: { ...POINTS_LEAGUE, blk: 6.5 }, roster: 'custom', customCounts: { ...ROSTER_PRESETS.standard.counts, C: 2, BN: 4 }, clock: 30 });
  assert.deepEqual(parseSettings(serializeSettings(s)), s);
  assert.equal(weightsOf(s).blk, 6.5);
  assert.equal(slotsOf(s).length, 15);
  assert.deepEqual(parseSettings('not json'), normalizeSettings(DEFAULT_SETTINGS));
  const bad = normalizeSettings({ teams: 99, seat: 13, scoring: 'x', customWeights: { pts: 999 }, roster: 'y', customCounts: { C: 9 }, clock: 45 });
  assert.equal(bad.teams, 12); assert.equal(bad.seat, 'random'); assert.equal(bad.scoring, 'standard'); assert.equal(bad.customWeights.pts, 10);
  assert.equal(bad.roster, 'standard'); assert.equal(bad.customCounts.C, 1); assert.equal(bad.clock, 0);
  assert.equal(normalizeSettings({ teams: 8, seat: 12 }).seat, 'random', 'a seat past the field is not kept');
  assert.equal(DEFAULT_SETTINGS.teams, 12); assert.equal(DEFAULT_SETTINGS.clock, 0); assert.equal(slotsOf(DEFAULT_SETTINGS).length, 13);
});

test('recording: a finished mock is kept only when it is whole; nothing names the reader', () => {
  const ok = { teams: 8, rounds: 2, scoring: 'standard', roster: 'custom', userSeat: 3, grade: 'B-', picks: Array.from({ length: 16 }, (_, i) => i + 1) };
  assert.deepEqual(Object.keys(cleanMockRecord({ ...ok, userId: 5, ip: '1.2.3.4' })).sort(), ['grade', 'picks', 'roster', 'rounds', 'scoring', 'teams', 'userSeat']);
  for (const bad of [{ ...ok, teams: 7 }, { ...ok, picks: ok.picks.slice(1) }, { ...ok, picks: [...ok.picks.slice(1), 2] }, { ...ok, userSeat: 9 }, { ...ok, scoring: 'x' }, null]) {
    assert.equal(cleanMockRecord(bad), null);
  }
  assert.equal(cleanMockRecord({ ...ok, grade: 'Z' }).grade, null);
});

test('the grade: a place in any field, a steal by SVP', () => {
  for (const teams of [8, 12, 14]) {
    const st = playOut(createMock(pool(), { userSeat: 0, seed: 9, teams }), () => 0);
    const g = gradeMock(st);
    assert.ok(g.place >= 1 && g.place <= teams);
    assert.match(g.grade, /^(A\+|A-|A|B\+|B-|B|C\+|C|D)$/);
    assert.ok(g.value > 0);
  }
});

test('the share card payload round-trips with roster and teams; anything malformed is refused; the roster rebuilds', () => {
  const counts = { ...ROSTER_PRESETS.standard.counts, C: 2 };
  const d = encodeShare({ grade: 'B-', seat: 7, ids: [1003, 1010, 1020], counts, teams: 10 });
  assert.match(d, /^[A-Za-z0-9_-]+$/, 'url-safe');
  assert.deepEqual(decodeShare(d), { grade: 'B-', seat: 7, ids: [1003, 1010, 1020], counts, teams: 10 });
  const legacy = Buffer.from('A-|7|1003.1010').toString('base64url');
  assert.deepEqual(decodeShare(legacy), { grade: 'A-', seat: 7, ids: [1003, 1010], counts: ROSTER_PRESETS.standard.counts, teams: 12 }, 'a sun-6 card still opens');
  for (const bad of ['', 'xx', encodeShare({ grade: 'Z', seat: 1, ids: [1] }), encodeShare({ grade: 'A', seat: 15, ids: [1] }), encodeShare({ grade: 'A', seat: 9, ids: [1], teams: 8 })]) {
    assert.equal(decodeShare(bad), null, String(bad));
  }
  const r = rosterFromIds([1000, 1006, 1001], raw());
  assert.deepEqual(r.filter((x) => x.player).map((x) => [x.slot, x.player.id]), [['PG', 1000], ['SG', 1001], ['C', 1006]]);
});

test('a seed replays exactly; an illegal or taken pick is refused; POOL_MIN leaves a choice', () => {
  const p = pool();
  const play = () => playOut(createMock(p, { userSeat: 3, seed: 42, botKey: 'adp' })).picks.map((x) => x.id).join(',');
  assert.equal(play(), play());
  const st = runBots(createMock(p, { userSeat: 0, seed: 1 }));
  const after = applyPick(st, legalFor(st, 0)[0].id, 'user');
  assert.throws(() => applyPick(after, legalFor(st, 0)[0].id, 'bot'), /not available/);
  assert.ok(POOL_MIN > 156);
});
