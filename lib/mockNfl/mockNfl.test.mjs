// lib/mockNfl/mockNfl.test.mjs - the NFL mock draft, pure (mon-3): the roster kit on
// the shared engine (presets fill legally: FLEX, D/ST, K; custom rosters fill or
// are refused; no stall), scoring + the SVP projection, the share payload, the pool shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as KIT from './roster.js';
import { SCORING_PRESETS, PPR, fppgOf, cleanWeight } from './scoring.js';
import { projection, rankPool } from './rank.js';
import { encodeShare, decodeShare } from './share.js';
import { shapeNflMockPool, normName } from './pool.js';
import { normalizeSettings, parseSettings, serializeSettings, slotsOf, DEFAULT_SETTINGS } from './settings.js';
import { createMock, runBots, applyPick, legalFor, isDone, totalPicks, autoDraftRest, botPick } from '../mockNba/draft.js';
import { gradeMock } from '../mockNba/grade.js';
import { applyChoice, currentChoice } from '../mockNba/setupChoice.js';

const { eligible, slotsFromCounts, checkFillable, ROSTER_PRESETS, SLOTS } = KIT;

// A synthetic pool shaped like the real one (249 players; the real one is 75 WR, 54 RB, 26 QB,
// 18 TE, 19 DST, 17 K plus the rest of the board - the extra skill players here keep it at 249).
const MIX = [['WR', 95], ['RB', 74], ['QB', 26], ['TE', 18], ['DST', 19], ['K', 17]];
function rawPool() {
  const out = []; let i = 0;
  for (const [pos, n] of MIX) {
    for (let k = 0; k < n; k += 1, i += 1) {
      const gp = 5;
      const t = pos === 'QB' ? { passYds: 1200 - k * 20, passTd: 9 - k * 0.2, int: 3, rushYds: 100 }
        : pos === 'K' ? { fgm: 10 - k * 0.3, xp: 12 }
          : pos === 'DST' ? { sacks: 14 - k * 0.4, defInt: 5, fr: 3, defTd: 1 }
            : { rec: 30 - k * 0.3, recYds: 400 - k * 4, recTd: 3, rushYds: pos === 'RB' ? 400 - k * 5 : 10, rushTd: pos === 'RB' ? 3 : 0 };
      out.push({ id: String(10000 + i), name: `${pos} ${k}`, pos, team: 'AAA', adp: 1 + ((i * 37) % 249), s: { gp, t }, s2: { gp: 17, t: Object.fromEntries(Object.entries(t).map(([kk, v]) => [kk, v * 3])) }, rem: 12 });
    }
  }
  return out;
}
const pool = (w = PPR) => rankPool(rawPool(), w);
const assertLegal = (st) => {
  for (const r of st.rosters) {
    assert.equal(r.filter((x) => x.player).length, st.slots.length, 'every slot filled');
    for (const x of r) if (x.slot !== 'BN') assert.ok(eligible(x.player).has(x.slot), `${x.player.pos} in ${x.slot}`);
  }
  assert.equal(new Set(st.picks.map((x) => x.id)).size, totalPicks(st), 'nobody taken twice');
};
const playOut = (st, ix = () => 0) => {
  let s = runBots(st);
  while (!isDone(s)) { const legal = legalFor(s, s.userSeat); s = runBots(applyPick(s, legal[ix(s, legal) % legal.length].id, 'user')); }
  return s;
};

test('presets as ruled: ESPN QB 2RB 2WR TE FLEX D/ST K + 7 BN; Yahoo QB 2RB 3WR TE W/R/T K DEF + 6 BN', () => {
  assert.deepEqual(SLOTS, ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DST', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN']);
  assert.deepEqual(slotsFromCounts(ROSTER_PRESETS.yahoo.counts), ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DST', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN']);
  assert.deepEqual([...eligible('RB')].sort(), ['FLEX', 'RB', 'SFLX']);
  assert.deepEqual([...eligible('K')], ['K']); assert.deepEqual([...eligible('DST')], ['DST']);
  assert.deepEqual([...eligible('QB')].sort(), ['QB', 'SFLX'], 'no QB in FLEX; a QB plays SFLX (tue-0)');
});

test('PRESETS FILL LEGALLY (FLEX, D/ST, K) - every seat, many seeds, both bot keys, 8 to 14 teams', () => {
  const p = pool();
  for (const preset of ['espn', 'yahoo']) {
    const slots = slotsFromCounts(ROSTER_PRESETS[preset].counts);
    for (const [teams, seed] of [[8, 1], [10, 2], [12, 3], [14, 4], [12, 5]]) {
      for (const botKey of ['adp', 'svp']) {
        const st = playOut(createMock(p, { userSeat: seed % teams, seed, teams, slots, botKey, kit: KIT }), (s) => s.picks.length * 7);
        assertLegal(st);
        for (const r of st.rosters) {
          assert.equal(r.find((x) => x.slot === 'K').player.pos, 'K');
          assert.equal(r.find((x) => x.slot === 'DST').player.pos, 'DST');
          assert.ok(['RB', 'WR', 'TE'].includes(r.find((x) => x.slot === 'FLEX').player.pos));
        }
      }
    }
  }
});

test('CUSTOM ROSTERS fill or are refused with a clear message - never a stall', () => {
  const p = pool();
  assert.match(checkFillable(p, [], 12).message, /at least one roster spot/);
  assert.match(checkFillable(p, ['BN'], 12).message, /starting spot/);
  assert.match(checkFillable(p, slotsFromCounts({ K: 2, QB: 1 }), 12).message, /Not enough kickers: 12 teams need 24 and the pool has 17\./);
  assert.match(checkFillable(p, slotsFromCounts({ DST: 2 }), 10).message, /Not enough defenses: 10 teams need 20 and the pool has 19\./);
  assert.match(checkFillable(p, slotsFromCounts({ QB: 3 }), 12).message, /Not enough quarterbacks/);
  assert.match(checkFillable(p, slotsFromCounts({ ...ROSTER_PRESETS.espn.counts, BN: 10 }), 14).message, /more than the pool can supply/);
  let passed = 0;
  for (let k = 0; k < 30; k += 1) {
    const counts = Object.fromEntries(KIT.SLOT_KEYS.map((s, j) => [s, s === 'BN' ? (k + j) % 8 : ['K', 'DST'].includes(s) ? (k + j) % 2 : (k * 3 + j) % 4]));
    const slots = slotsFromCounts(counts); const teams = 8 + (k % 7);
    const chk = checkFillable(p, slots, teams);
    if (!chk.ok) { assert.ok(chk.message.length > 10); continue; }
    passed += 1;
    assertLegal(playOut(createMock(p, { userSeat: k % teams, seed: k + 1, teams, slots, kit: KIT })));
  }
  assert.ok(passed >= 6, `${passed} fillable rosters drafted`);
});

test('scoring presets; CUSTOM SCORING CHANGES SVP', () => {
  assert.equal(SCORING_PRESETS.ppr.weights.rec, 1); assert.equal(SCORING_PRESETS.half.weights.rec, 0.5); assert.equal(SCORING_PRESETS.standard.weights.rec, 0);
  assert.equal(SCORING_PRESETS.ppr.weights.passYds, 0.04);
  const line = { gp: 2, t: { passYds: 500, passTd: 4, int: 2, rushYds: 40, rec: 0 } };
  assert.equal(fppgOf(line, PPR), Math.round(((500 * 0.04 + 16 - 4 + 4) / 2) * 10) / 10);
  assert.equal(fppgOf({ gp: 0, t: {} }), null);
  assert.equal(cleanWeight('0.044'), 0.04); assert.equal(cleanWeight(99), 10);
  const base = pool(PPR); const qbHeavy = pool({ ...PPR, passTd: 10, passYds: 0.1 });
  const qbTop = (r) => r.slice(0, 24).filter((x) => x.pos === 'QB').length;
  assert.ok(qbTop(qbHeavy) > qbTop(base), `QBs in the top 24: ${qbTop(base)} -> ${qbTop(qbHeavy)}`);
  // A slot receiver (10 catches, 90 yards a game) and a goal-line back (90 yards, a TD a game):
  // PPR ranks the receiver first, Standard the back.
  const pair = [{ id: 'wr', name: 'wr', pos: 'WR', s: { gp: 4, t: { rec: 40, recYds: 360 } }, rem: 12 },
    { id: 'rb', name: 'rb', pos: 'RB', s: { gp: 4, t: { rushYds: 360, rushTd: 4 } }, rem: 12 }];
  assert.deepEqual(rankPool(pair, PPR).map((x) => x.id), ['wr', 'rb']);
  assert.deepEqual(rankPool(pair, SCORING_PRESETS.standard.weights).map((x) => x.id), ['rb', 'wr']);
});

test('SVP = projected FP/G x games left; under 4 games 50/50, else 80/20; one season alone; unknowns last by ADP', () => {
  const flat = Object.fromEntries(Object.keys(PPR).map((k) => [k, 0])); flat.rec = 1;
  const r = (gp, now, last, rem = 10) => ({ s: now == null ? null : { gp, t: { rec: now * gp } }, s2: last == null ? null : { gp: 17, t: { rec: last * 17 } }, rem });
  assert.equal(projection(r(3, 20, 10), flat).fppg, 15, 'three games: 50/50');
  assert.equal(projection(r(4, 20, 10), flat).fppg, 18, 'four games: 80/20');
  assert.equal(projection(r(5, 20, null), flat).fppg, 20, 'this season only');
  assert.equal(projection(r(0, null, 10), flat).fppg, 10, 'last season only (no games yet)');
  assert.equal(projection(r(5, 20, 10, 12), flat).games, 12);
  const ranked = rankPool([
    { id: 'a', name: 'a', ...r(5, 10, 10, 10), adp: 50 }, { id: 'b', name: 'b', ...r(5, 10, 10, 13), adp: 60 },
    { id: 'c', name: 'c', s: null, s2: null, rem: 13, adp: 2 }, { id: 'd', name: 'd', s: null, s2: null, rem: 13, adp: 1 },
  ], flat);
  assert.deepEqual(ranked.map((x) => [x.id, x.svp, x.sv]), [['b', 1, 130], ['a', 2, 100], ['d', 3, 0], ['c', 4, 0]], 'more games left ranks higher; unknowns by ADP');
});

test('AUTO-DRAFT grades spread and fills legally; bots keep FLEX/K/D/ST legal', () => {
  const p = pool(); const grades = {};
  for (let k = 0; k < 20; k += 1) {
    const st = autoDraftRest(createMock(p, { userSeat: k % 12, seed: 900 + k, botKey: 'adp', kit: KIT }));
    assertLegal(st);
    const g = gradeMock(st).grade; grades[g] = (grades[g] ?? 0) + 1;
  }
  assert.ok(Object.keys(grades).length >= 3, JSON.stringify(grades));
  assert.ok(botPick(createMock(p, { userSeat: 3, seed: 1, kit: KIT }), 0) != null);
});

test('settings + setup dropdown, NFL edition: round-trip; presets set scoring + roster', () => {
  const s = normalizeSettings({ ...DEFAULT_SETTINGS, teams: 10, seat: 4, scoring: 'custom', customWeights: { ...PPR, rec: 0.75, passYds: 0.05 }, roster: 'custom', customCounts: { ...ROSTER_PRESETS.espn.counts, WR: 3, BN: 9 }, clock: 60 });
  assert.deepEqual(parseSettings(serializeSettings(s)), s);
  assert.equal(slotsOf(s).length, 19);
  assert.equal(normalizeSettings({ scoring: 'simple', roster: 'twoc' }).scoring, 'ppr', 'NBA keys are not NFL keys');
  const y = applyChoice(normalizeSettings(DEFAULT_SETTINGS), 'preset:yahoo', [], 'nfl');
  assert.deepEqual([y.scoring, y.roster], ['half', 'yahoo']);
  assert.equal(currentChoice(normalizeSettings(DEFAULT_SETTINGS), [], null, 'nfl').value, 'preset:espn');
});

test('share payload round-trips (bench to 10, string ids); the pool shape maps K/DST, games left, injuries', () => {
  const counts = { ...ROSTER_PRESETS.espn.counts, SFLX: 0, BN: 10 };
  const d = encodeShare({ grade: 'B+', seat: 9, ids: ['18047', '19400'], counts, teams: 10 });
  // A card shared before SFLX existed (eight two-digit counts) still opens.
  const legacy = Buffer.from('A|3|1.2|0102020101010107|12').toString('base64url');
  assert.deepEqual(decodeShare(legacy).counts, { ...ROSTER_PRESETS.espn.counts, SFLX: 0 });
  assert.deepEqual(decodeShare(d), { grade: 'B+', seat: 9, ids: ['18047', '19400'], counts, teams: 10 });
  for (const bad of ['', encodeShare({ grade: 'Z', seat: 1, ids: ['1'] }), encodeShare({ grade: 'A', seat: 11, ids: ['1'], teams: 10 })]) assert.equal(decodeShare(bad), null);
  const rows = shapeNflMockPool({ ppr: [
    { ffcPlayerId: 1, name: "Ja'Marr Chase", position: 'WR', team: 'CIN', adp: 2.5, bye: 10 },
    { ffcPlayerId: 2, name: 'Brandon Aubrey', position: 'PK', team: 'DAL', adp: 140 },
    { ffcPlayerId: 3, name: 'Denver Defense', position: 'DEF', team: 'DEN', adp: 150 },
  ] }, { now: { 1: { games: 5, totals: { rec: 40 } } }, last: {}, rem: new Map([['CIN', 12], ['DAL', 11]]), injuries: new Map([['jamarr chase|CIN', 'Out']]) });
  assert.deepEqual(rows.map((r) => [r.id, r.pos, r.rem, r.inj ?? null, r.adp]), [['1', 'WR', 12, 'Out', 2.5], ['2', 'K', 11, null, 140], ['3', 'DST', 0, null, 150]]);
  assert.deepEqual(rows[0].s, { gp: 5, t: { rec: 40 } }); assert.equal(rows[0].s2, null);
  assert.equal(normName("Ja'Marr Chase Jr."), 'jamarr chase');
});

test('IN SEASON (mon-5): bots and auto-draft pick by SVP + need; ADP is labelled as the preseason board', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../components/mockNfl/MockNflDraft.js', import.meta.url), 'utf8');
  assert.match(src, /const inSeason = pool\.some\(\(p\) => Number\(p\.s\?\.gp\) > 0\);/);
  assert.match(src, /botKey: adpOn && !inSeason \? 'adp' : 'svp'/, 'the bots (and so auto-draft and the clock) draft by SVP in season');
  assert.match(src, /`Preseason ADP \(\$\{shortDate\(adpAsOf\)\}\)`/, 'the column names the board: "Preseason ADP (Sep 9)"');
});

test('tue-0 PARITY: SFLX (QB/RB/WR/TE), the 2QB / Superflex and The Draft presets fill legally; a short SFLX supply is refused', () => {
  const p = pool();
  for (const preset of ['superflex', 'thedraft']) {
    const slots = slotsFromCounts(ROSTER_PRESETS[preset].counts);
    for (const [teams, seed] of [[8, 1], [12, 2], [14, 3]]) {
      for (const botKey of ['adp', 'svp']) {
        const st = playOut(createMock(p, { userSeat: seed % teams, seed, teams, slots, botKey, kit: KIT }), (s) => s.picks.length * 5);
        assertLegal(st);
        if (preset === 'superflex') for (const r of st.rosters) assert.ok(['QB', 'RB', 'WR', 'TE'].includes(r.find((x) => x.slot === 'SFLX').player.pos));
      }
    }
  }
  assert.deepEqual(slotsFromCounts(ROSTER_PRESETS.thedraft.counts), ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX'], 'the weekly Draft\'s eight (lib/draft/contest.js DRAFT_CONFIG)');
  assert.match(checkFillable(p.filter((x) => ['QB', 'K', 'DST'].includes(x.pos)).concat(p.filter((x) => x.pos === 'RB').slice(0, 5)), slotsFromCounts({ QB: 1, SFLX: 2 }), 12).message, /Not enough quarterbacks, running backs, receivers and tight ends/);
});

test('tue-0: "The Draft practice" is 12 teams, PPR and the weekly eight; FULL AUTO plays every pick to the result', async () => {
  const { stepOne } = await import('../mockNba/draft.js');
  const t = applyChoice(normalizeSettings({ ...DEFAULT_SETTINGS, teams: 10, scoring: 'half' }), 'preset:thedraft', [], 'nfl');
  assert.deepEqual([t.teams, t.scoring, t.roster, slotsOf(t).length], [12, 'ppr', 'thedraft', 8]);
  assert.equal(currentChoice(t, [], null, 'nfl').value, 'preset:thedraft');
  assert.equal(normalizeSettings({ fullAuto: true }).fullAuto, true);
  assert.equal(normalizeSettings({ fullAuto: 'yes' }).fullAuto, false);
  let st = createMock(pool(), { userSeat: 4, seed: 11, teams: 12, slots: slotsOf(t), botKey: 'svp', kit: KIT });
  let steps = 0;
  while (!isDone(st)) { st = stepOne(st); steps += 1; }
  assert.equal(steps, 96, 'one pick per step, 12 x 8');
  assertLegal(st);
  assert.ok(st.picks.filter((x) => x.seat === 4).every((x) => x.by === 'auto'), 'every one of the reader\'s picks was automatic');
});
