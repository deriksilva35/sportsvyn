import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shortName, probablesLine, winningPitcher, batOfTheNight, decisions,
  pitcherLine, batterLine, decisionLine,
} from './cardLines.js';

test('the name a card prints', () => {
  assert.equal(shortName('Framber Valdez'), 'F. Valdez');
  assert.equal(shortName('Yordan Álvarez'), 'Y. Álvarez');
  assert.equal(shortName('Vladimir Guerrero Jr.'), 'V. Guerrero Jr.');
  // A ONE-WORD NAME IS LEFT WHOLE. "I." names nobody.
  assert.equal(shortName('Ichiro'), 'Ichiro');
  assert.equal(shortName(''), null);
  assert.equal(shortName(null), null);
});

test('the probables line, and TBA is a real answer', () => {
  assert.equal(
    probablesLine({ away: { name: 'Tarik Skubal' }, home: { name: 'Luis Castillo' } }),
    'T. Skubal vs L. Castillo');
  assert.equal(
    probablesLine({ away: { name: 'Tarik Skubal' }, home: null }),
    'T. Skubal vs TBA', 'a named starter against an unnamed one is still worth printing');
  assert.equal(probablesLine({ away: null, home: null }), null);
  assert.equal(probablesLine(null), null);
});

test("THE FINAL'S FOOT is the mock's line", () => {
  const rows = [
    { player_name: 'Framber Valdez', outs_recorded: 21, strikeouts_pitched: 9, earned_runs: 1, wins: 1 },
    { player_name: 'Tanner Bibee', outs_recorded: 15, strikeouts_pitched: 4, earned_runs: 4, losses: 1 },
    { player_name: 'Yordan Álvarez', at_bats: 4, hits: 2, home_runs: 1, rbi: 3, total_bases: 6 },
    { player_name: 'Jose Altuve', at_bats: 5, hits: 2, home_runs: 0, rbi: 0, total_bases: 2 },
  ];
  // docs/design/mocks/mlb-scores-v0_1.html, the FINAL card:
  //   <b>F. Valdez</b> 7 IP · 9 K · 1 ER  ·  <b>Y. Álvarez</b> 2-4 · HR · 3 RBI
  assert.equal(pitcherLine(winningPitcher(rows)), 'F. Valdez 7 IP · 9 K · 1 ER');
  assert.equal(batterLine(batOfTheNight(rows)), 'Y. Álvarez 2-4 · HR · 3 RBI');
  assert.equal(decisionLine(rows), 'F. Valdez 7 IP · 9 K · 1 ER  ·  Y. Álvarez 2-4 · HR · 3 RBI');
  assert.equal(winningPitcher(rows).player_name, 'Framber Valdez');
  assert.equal(batOfTheNight(rows).player_name, 'Yordan Álvarez',
    'total bases decides it, not hits - Altuve also went 2-for-N');
});

test('ZERO IS A NUMBER AND NULL IS NOT, once more', () => {
  // A SHUTOUT IS 0 ER and it is the best line on the card. Number(null) is
  // also 0, so the guard asks whether the column was sent before believing it.
  assert.equal(
    pitcherLine({ player_name: 'Framber Valdez', outs_recorded: 27, strikeouts_pitched: 12, earned_runs: 0, wins: 1 }),
    'F. Valdez 9 IP · 12 K · 0 ER');
  // No earned_runs column at all: the bit is dropped, not printed as 0.
  assert.equal(
    pitcherLine({ player_name: 'Framber Valdez', outs_recorded: 27, strikeouts_pitched: 12, wins: 1 }),
    'F. Valdez 9 IP · 12 K');
  assert.equal(
    pitcherLine({ player_name: 'Ryan Pressly', outs_recorded: 3, strikeouts_pitched: 0, earned_runs: 0 }),
    'R. Pressly 1 IP · 0 ER', 'nought strikeouts is not a stat line item');
});

test('A HITLESS GAME IS NOT A BAT OF THE NIGHT', () => {
  const rows = [
    { player_name: 'A Batter', at_bats: 4, hits: 0, rbi: 0, total_bases: 0 },
    { player_name: 'B Batter', at_bats: 3, hits: 0, rbi: 0, total_bases: 0 },
  ];
  assert.equal(batOfTheNight(rows), null, '0-4 tops the field and reads as praise');
  assert.equal(batterLine(null), null);
  assert.equal(decisionLine(rows), null, 'neither half, so no line at all');
  assert.equal(decisionLine([]), null);
  // The decision alone is still a line.
  assert.equal(
    decisionLine([{ player_name: 'Framber Valdez', outs_recorded: 21, strikeouts_pitched: 9, earned_runs: 0, wins: 1 }]),
    'F. Valdez 7 IP · 9 K · 0 ER');
});

test('"7 IP" on a card, "7.0" in a column - and every third survives', () => {
  // The mock writes "7 IP". outsToInnings is the BOX SCORE column's formatter
  // and prints 7.0 because that column is aligned thirds; a sentence is not.
  assert.equal(
    pitcherLine({ player_name: 'Framber Valdez', outs_recorded: 20, strikeouts_pitched: 9, earned_runs: 1, wins: 1 }),
    'F. Valdez 6.2 IP · 9 K · 1 ER', 'six and two thirds is not "6.7" and not "6"');
  assert.equal(
    pitcherLine({ player_name: 'Framber Valdez', outs_recorded: 19, strikeouts_pitched: 9, earned_runs: 1, wins: 1 }),
    'F. Valdez 6.1 IP · 9 K · 1 ER');
});

test('two home runs are "2 HR", one is "HR"', () => {
  assert.equal(batterLine({ player_name: 'Kyle Schwarber', at_bats: 4, hits: 3, home_runs: 2, rbi: 5, total_bases: 9 }),
    'K. Schwarber 3-4 · 2 HR · 5 RBI');
  assert.equal(batterLine({ player_name: 'Kyle Schwarber', at_bats: 4, hits: 1, home_runs: 0, rbi: 0, total_bases: 1 }),
    'K. Schwarber 1-4');
});

test('W / L / SV, and an absent save is absent', () => {
  const rows = [
    { player_name: 'Framber Valdez', wins: 1 },
    { player_name: 'Tanner Bibee', losses: 1 },
    { player_name: 'Josh Hader', saves: 1 },
  ];
  const d = decisions(rows);
  assert.equal(d.win.player_name, 'Framber Valdez');
  assert.equal(d.loss.player_name, 'Tanner Bibee');
  assert.equal(d.save.player_name, 'Josh Hader');
  // MOST GAMES HAVE NO SAVE. Null, so the page omits it - "SV —" reads as a
  // value we failed to fetch rather than as a fact about the game.
  assert.equal(decisions(rows.slice(0, 2)).save, null);
  assert.equal(decisions([]).win, null);
  // Number(null) IS 0 and 0 is not > 0, so a row with the column absent is
  // never mistaken for the decision.
  assert.equal(decisions([{ player_name: 'A Reliever', wins: null, saves: 0 }]).win, null);
});
