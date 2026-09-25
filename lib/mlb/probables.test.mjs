// lib/mlb/probables.test.mjs - probable starters from BDL /mlb/v1/lineups, in
// the shape metadata.probables has always held, and PARITY with the statsapi
// answers the poller wrote on PROD for 43 games (22-24 Sep 2026, captured
// read-only into fixtures/probables-parity-2026-09-22-24.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { probablesFromLineupRows, probablesForGame, probablesByMatch, fetchLineupRows, matchKey, pickByKickoff } from './probables.js';

const FIX = JSON.parse(readFileSync(new URL('./fixtures/probables-parity-2026-09-22-24.json', import.meta.url), 'utf8'));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[^\p{L}]/gu, '').toLowerCase();
const row = (abbr, id, name, extra = {}) => ({ game_id: 1, is_probable_pitcher: true, team: { abbreviation: abbr }, player: { id, full_name: name }, ...extra });

test('PARITY: every starter statsapi announced on the 43 PROD games, BDL names the same - bar the one game it lacks', () => {
  assert.equal(FIX.games.length, 43);
  let same = 0; const differ = []; const bdlMissing = [];
  for (const g of FIX.games) {
    const p = probablesFromLineupRows(g.bdlRows, { awayAbbr: g.awayAbbr, homeAbbr: g.homeAbbr });
    for (const side of ['away', 'home']) {
      const want = g.statsapi[side]; const got = p?.[side]?.name ?? null;
      if (!want) continue;
      if (!got) bdlMissing.push(`${g.slug} ${side}`);
      else if (norm(got) === norm(want)) same += 1;
      else differ.push(`${g.slug} ${side}: ${want} vs ${got}`);
    }
  }
  assert.equal(same, 84, '84 starters identical');
  assert.deepEqual(differ, [], 'none named differently');
  assert.deepEqual(bdlMissing, ['mlb-2026-09-22-tor-bal away', 'mlb-2026-09-22-tor-bal home'], 'the one game BDL had no starters for');
});

test('the shape is the one metadata.probables holds: {away, home} of {id, name}, id a string', () => {
  const p = probablesFromLineupRows([row('TB', 208, 'Shane McClanahan'), row('NYY', 19, 'Gerrit Cole')], { awayAbbr: 'TB', homeAbbr: 'NYY' });
  assert.deepEqual(p, { away: { id: '208', name: 'Shane McClanahan' }, home: { id: '19', name: 'Gerrit Cole' } });
});

test('a partial announcement is kept, neither is null, and batters are never starters', () => {
  assert.deepEqual(probablesFromLineupRows([row('NYY', 19, 'Gerrit Cole')], { awayAbbr: 'TB', homeAbbr: 'NYY' }),
    { away: null, home: { id: '19', name: 'Gerrit Cole' } });
  assert.equal(probablesFromLineupRows([], { awayAbbr: 'TB', homeAbbr: 'NYY' }), null);
  assert.equal(probablesFromLineupRows(null, { awayAbbr: 'TB', homeAbbr: 'NYY' }), null);
  const batter = row('TB', 7, 'Yandy Diaz', { is_probable_pitcher: false, batting_order: 1 });
  assert.equal(probablesFromLineupRows([batter], { awayAbbr: 'TB', homeAbbr: 'NYY' }), null);
  assert.equal(probablesFromLineupRows([row('BOS', 1, 'Other Club')], { awayAbbr: 'TB', homeAbbr: 'NYY' }), null, 'another club on the row is not ours');
  assert.deepEqual(probablesFromLineupRows([{ ...row('TB', 5, null), player: { id: 5, first_name: 'A', last_name: 'B' } }], { awayAbbr: 'TB', homeAbbr: 'NYY' }).away,
    { id: '5', name: 'A B' }, 'a row with no full_name builds one');
});

// A fetch that answers from a table, so the network code runs with no network.
function fakeFetch(routes) {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    const hit = routes.find(([re]) => re.test(url));
    return { ok: Boolean(hit), status: hit ? 200 : 404, json: async () => (hit ? hit[1](url) : {}) };
  };
  return { f, calls };
}

test('fetchLineupRows walks the cursor and batches ids', async () => {
  const { f, calls } = fakeFetch([
    [/lineups.*cursor=9/, () => ({ data: [row('NYY', 2, 'B')], meta: {} })],
    [/lineups/, () => ({ data: [row('TB', 1, 'A')], meta: { next_cursor: 9 } })],
  ]);
  const rows = await fetchLineupRows([10, 11, 10], { key: 'k', fetchImpl: f });
  assert.equal(rows.length, 2);
  assert.match(calls[0], /game_ids\[\]=10&game_ids\[\]=11&per_page=100$/);
  assert.match(calls[1], /cursor=9/);
  assert.deepEqual(await probablesForGame(null, {}, { key: 'k', fetchImpl: f }), null, 'no id, no call');
});

test('probablesByMatch keys a UTC day by (day, away, home) and keeps a doubleheader as two candidates', async () => {
  const games = [
    { id: 1, date: '2026-09-25T17:05:00.000Z', away_team: { abbreviation: 'CHC' }, home_team: { abbreviation: 'BOS' } },
    { id: 2, date: '2026-09-25T22:00:00.000Z', away_team: { abbreviation: 'CHC' }, home_team: { abbreviation: 'BOS' } },
    { id: 3, date: '2026-09-26T01:40:00.000Z', away_team: { abbreviation: 'ARI' }, home_team: { abbreviation: 'SD' } },
  ];
  const lineups = [
    { ...row('CHC', 11, 'Game One Away'), game_id: 1 }, { ...row('BOS', 12, 'Game One Home'), game_id: 1 },
    { ...row('CHC', 21, 'Game Two Away'), game_id: 2 },
    { ...row('ARI', 31, 'Next Day'), game_id: 3 },
  ];
  const { f } = fakeFetch([[/\/games\?/, () => ({ data: games })], [/lineups/, () => ({ data: lineups, meta: {} })]]);
  const m = await probablesByMatch('2026-09-25', { key: 'k', fetchImpl: f });
  assert.deepEqual([...m.keys()], ['2026-09-25:CHC@BOS'], 'the 01:40Z game is the 26th in UTC and is not in the 25th');
  const list = m.get(matchKey('CHC', 'BOS', '2026-09-25'));
  assert.equal(list.length, 2);
  assert.equal(pickByKickoff(list, '2026-09-25T17:05:00Z').probables.away.name, 'Game One Away');
  assert.deepEqual(pickByKickoff(list, '2026-09-25T22:00:00Z').probables, { away: { id: '21', name: 'Game Two Away' }, home: null });
});

test('pickByKickoff: one candidate is the answer; an inseparable pair is refused', () => {
  assert.equal(pickByKickoff([{ gameDate: 'x' }], null).gameDate, 'x');
  assert.equal(pickByKickoff([], '2026-09-25T17:05:00Z'), null);
  const pair = [{ gameDate: '2026-09-25T17:05:00Z' }, { gameDate: '2026-09-25T17:35:00Z' }];
  assert.equal(pickByKickoff(pair, '2026-09-25T17:10:00Z'), null, 'thirty minutes apart is not separable');
  assert.equal(matchKey('CHC', null, '2026-09-25'), null);
});
