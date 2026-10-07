// lib/mlb/boxOrder.test.mjs - the batting table in batting order (tue-9 D). PURE.
// Fixture: 6 Oct 2026 LAD@ATL as PROD held it at 23:50Z (read-only snapshot):
// the box rows alphabetised as the page used to read them, with roster-default
// positions (two Braves LF, no DH), and BDL /lineups as posted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderHitters, parseSubs } from './boxOrder.js';

const FX = {"awayId":60573,"homeId":60561,"lineups":{"away":[{"id":"118","order":1,"position":"SS"},{"id":"130","order":2,"position":"1B"},{"id":"1098","order":3,"position":"LF"},{"id":"103","order":4,"position":"C"},{"id":"208","order":5,"position":"DH"},{"id":"156","order":6,"position":"2B"},{"id":"176","order":7,"position":"CF"},{"id":"678","order":8,"position":"RF"},{"id":"1101","order":9,"position":"3B"}],"home":[{"id":"114368","order":1,"position":"C"},{"id":"1835","order":2,"position":"DH"},{"id":"856","order":3,"position":"1B"},{"id":"825","order":4,"position":"2B"},{"id":"874","order":5,"position":"CF"},{"id":"628","order":6,"position":"LF"},{"id":"1048","order":7,"position":"RF"},{"id":"863","order":8,"position":"3B"},{"id":"406","order":9,"position":"SS"}]},"hitters":[{"team_id":60561,"bdl_player_id":"863","player_name":"Austin Riley","position":"3B"},{"team_id":60561,"bdl_player_id":"114368","player_name":"Drake Baldwin","position":"C"},{"team_id":60561,"bdl_player_id":"406","player_name":"Ha-Seong Kim","position":"SS"},{"team_id":60561,"bdl_player_id":"1048","player_name":"Lane Thomas","position":"LF"},{"team_id":60561,"bdl_player_id":"856","player_name":"Matt Olson","position":"1B"},{"team_id":60561,"bdl_player_id":"628","player_name":"Mauricio Dubon","position":"LF"},{"team_id":60561,"bdl_player_id":"874","player_name":"Michael Harris II","position":"CF"},{"team_id":60561,"bdl_player_id":"825","player_name":"Ozzie Albies","position":"2B"},{"team_id":60561,"bdl_player_id":"1835","player_name":"Ronald Acuna Jr.","position":"RF"},{"team_id":60573,"bdl_player_id":"176","player_name":"Andy Pages","position":"CF"},{"team_id":60573,"bdl_player_id":"1101","player_name":"Enrique Hernandez","position":"3B"},{"team_id":60573,"bdl_player_id":"130","player_name":"Freddie Freeman","position":"1B"},{"team_id":60573,"bdl_player_id":"678","player_name":"Kyle Tucker","position":"RF"},{"team_id":60573,"bdl_player_id":"156","player_name":"Miguel Rojas","position":"2B"},{"team_id":60573,"bdl_player_id":"118","player_name":"Mookie Betts","position":"SS"},{"team_id":60573,"bdl_player_id":"208","player_name":"Shohei Ohtani","position":"DH"},{"team_id":60573,"bdl_player_id":"1098","player_name":"Teoscar Hernandez","position":"LF"},{"team_id":60573,"bdl_player_id":"103","player_name":"Will Smith","position":"C"}]};
const T = { awayId: FX.awayId, homeId: FX.homeId };
const club = (rows, id) => rows.filter((r) => r.team_id === id);

test('LAD@ATL: hitters in batting order 1-9, not by first name', () => {
  const out = orderHitters(FX.hitters, FX.lineups, [], T);
  assert.deepEqual(club(out, FX.awayId).map((r) => r.player_name).slice(0, 3), ['Mookie Betts', 'Freddie Freeman', 'Teoscar Hernandez']);
  assert.deepEqual(club(out, FX.awayId).map((r) => r.order), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(club(out, FX.homeId).map((r) => r.order), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(out.length, FX.hitters.length);
});

test('LAD@ATL: positions are THIS game\'s - one Braves LF, a DH, Thomas in RF', () => {
  const atl = club(orderHitters(FX.hitters, FX.lineups, [], T), FX.homeId);
  assert.equal(atl.filter((r) => r.position === 'LF').length, 1);
  assert.equal(atl.find((r) => r.player_name === 'Lane Thomas').position, 'RF');
  assert.equal(atl.find((r) => r.player_name === 'Ronald Acuna Jr.').position, 'DH');
});

test('a pinch hitter sits directly under the man he replaced, a PH for a PH under him, as PH/PR', () => {
  const extra = [
    { team_id: FX.homeId, bdl_player_id: 'x1', player_name: 'Eli White', position: 'OF' },
    { team_id: FX.homeId, bdl_player_id: 'x2', player_name: 'Jarred Kelenic', position: 'OF' },
    { team_id: FX.homeId, bdl_player_id: 'x3', player_name: 'Sandy Leon', position: 'C' },
  ];
  const texts = ['Riley grounded out to second.', 'White hit for Dubon', 'Kelenic ran for White', 'Leon hit for Kim.'];
  const atl = club(orderHitters([...FX.hitters, ...extra], FX.lineups, texts, T), FX.homeId);
  const names = atl.map((r) => r.player_name);
  const i = names.indexOf('Mauricio Dubon');
  assert.deepEqual(names.slice(i, i + 3), ['Mauricio Dubon', 'Eli White', 'Jarred Kelenic']);
  assert.equal(atl[i + 1].sub, true); assert.equal(atl[i + 1].position, 'PH'); assert.equal(atl[i + 1].order, 6);
  assert.equal(atl[i + 2].position, 'PR');
  assert.deepEqual(names.slice(-2), ['Ha-Seong Kim', 'Sandy Leon']);
});

test('a sub the plays never name (BDL sends no defensive replacement) goes to the foot of his club, labelled sub', () => {
  const extra = [{ team_id: FX.awayId, bdl_player_id: 'y1', player_name: 'Hyeseong Kim', position: '2B' }];
  const lad = club(orderHitters([...FX.hitters, ...extra], FX.lineups, [], T), FX.awayId);
  assert.equal(lad.at(-1).player_name, 'Hyeseong Kim');
  assert.equal(lad.at(-1).sub, true); assert.equal(lad.at(-1).position, 'sub');
});

test('no posted lineup: the rows are kept as they came, none dropped', () => {
  const out = orderHitters(FX.hitters, null, [], T);
  for (const id of [FX.awayId, FX.homeId]) {
    assert.deepEqual(club(out, id).map((r) => r.bdl_player_id), club(FX.hitters, id).map((r) => r.bdl_player_id));
  }
  assert.equal(out.length, FX.hitters.length);
});

test('parseSubs reads hit for / ran for and nothing else', () => {
  assert.deepEqual(parseSubs(['Peters hit for B. Montgomery', 'McCray ran for Davidson', 'Ohtani singled to left.']),
    [{ sub: 'Peters', replaced: 'B. Montgomery', kind: 'PH' }, { sub: 'McCray', replaced: 'Davidson', kind: 'PR' }]);
});
