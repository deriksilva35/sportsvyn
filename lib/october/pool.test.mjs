// lib/october/pool.test.mjs - the picker's rows, and the two conversions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asGameRow, ipToOuts, ppgOf, kindOfPosition, poolRows } from './pool.js';
import { batPoints, armPoints } from '../mlb/fantasyPoints.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('INNINGS ARE THIRDS, NOT A FRACTION', () => {
  // season_stats sends 182.1 meaning 182 and a third. The scoring table pays
  // per OUT, so 182.1 is 547 outs - not 546.3, and not 182.1 * 3.
  assert.equal(ipToOuts(182.1), 547);
  assert.equal(ipToOuts(182.2), 548);
  assert.equal(ipToOuts(182), 546);
  assert.equal(ipToOuts(5.2), 17);
  assert.equal(ipToOuts(0), 0);
  // 5.2 ARRIVES FROM JSON AS 5.199999999999999 often enough to matter, which
  // is why the thirds are rounded rather than truncated.
  assert.equal(ipToOuts(5.199999999999999), 17);
  assert.equal(ipToOuts(null), null);
  assert.equal(ipToOuts('x'), null);
  assert.equal(ipToOuts(-1), null);
});

test('THE ADAPTER EXISTS SO THERE IS ONE SCORING TABLE', () => {
  // season_stats names its columns batting_h / pitching_k; the scoring
  // function speaks the game row's hits / strikeouts_pitched. If this mapping
  // were written as a second table it would drift.
  const s = {
    batting_ab: 500, batting_h: 150, batting_2b: 30, batting_3b: 2, batting_hr: 25,
    batting_rbi: 90, batting_r: 85, batting_bb: 60, batting_sb: 10,
    pitching_ip: 200.1, pitching_k: 220, pitching_w: 15, pitching_er: 60,
    pitching_h: 160, pitching_bb: 45,
  };
  const row = asGameRow(s);
  assert.equal(row.hits, 150);
  assert.equal(row.home_runs, 25);
  assert.equal(row.outs_recorded, 601);
  assert.equal(row.strikeouts_pitched, 220);
  // Singles derived from the same rule the game row uses: 150 - 30 - 2 - 25.
  assert.equal(batPoints(row), 93 * 3 + 30 * 5 + 2 * 8 + 25 * 10 + 90 * 2 + 85 * 2 + 60 * 2 + 10 * 5);
  assert.ok(armPoints(row) > 0);
});

test('THE KIND DECIDES THE DENOMINATOR as well as the table', () => {
  const arm = { pitching_ip: 200.1, pitching_k: 220, pitching_w: 15, pitching_er: 60,
    pitching_h: 160, pitching_bb: 45, pitching_gp: 32, batting_gp: 0 };
  const bat = { batting_ab: 500, batting_h: 150, batting_2b: 30, batting_hr: 25,
    batting_rbi: 90, batting_r: 85, batting_bb: 60, batting_sb: 10, batting_gp: 150 };
  // A STARTER'S VALUE IS PER START. Dividing a season's pitching by 162 would
  // rank every arm below every bat.
  assert.equal(ppgOf(arm, 'arm'), Math.round((armPoints(asGameRow(arm)) / 32) * 10) / 10);
  assert.ok(ppgOf(arm, 'arm') > 10, 'a good starter is worth more than a good bat');
  assert.ok(ppgOf(bat, 'bat') > 0 && ppgOf(bat, 'bat') < 15);
  // NO GAMES, NO NUMBER - null rather than a divide by zero or a zero that
  // would sort a call-up below a bench bat who has played.
  assert.equal(ppgOf({ batting_gp: 0 }, 'bat'), null);
  assert.equal(ppgOf({ pitching_gp: 0 }, 'arm'), null);
  assert.equal(ppgOf(null, 'bat'), null);
});

test('pitchers are arms and everybody else is a bat', () => {
  for (const p of ['SP', 'RP', 'P', 'sp']) assert.equal(kindOfPosition(p), 'arm', p);
  for (const p of ['C', '1B', 'SS', 'CF', 'DH', 'LF', null, '']) assert.equal(kindOfPosition(p), 'bat', String(p));
});

test("THE PANEL'S ORDER IS THE MOCK'S: arm first, then bats by PPG", () => {
  const roster = [
    { id: 1, full_name: 'Bryce Harper', position: '1B', active: true },
    { id: 2, full_name: 'Zack Wheeler', position: 'SP', active: true },
    { id: 3, full_name: 'Kyle Schwarber', position: 'DH', active: true },
    { id: 4, full_name: 'Ranger Suarez', position: 'SP', active: true },
    { id: 5, full_name: 'Rookie Callup', position: 'CF', active: true },
  ];
  const seasonStats = [
    { player: { id: 1 }, batting_gp: 150, batting_ab: 500, batting_h: 140, batting_hr: 30, batting_rbi: 95, batting_r: 90, batting_bb: 70 },
    { player: { id: 2 }, pitching_gp: 32, pitching_ip: 200.0, pitching_k: 224, pitching_w: 16, pitching_er: 55, pitching_h: 150, pitching_bb: 40 },
    { player: { id: 3 }, batting_gp: 150, batting_ab: 520, batting_h: 130, batting_hr: 38, batting_rbi: 100, batting_r: 95, batting_bb: 100 },
    { player: { id: 4 }, pitching_gp: 30, pitching_ip: 160.0, pitching_k: 140, pitching_w: 9, pitching_er: 70, pitching_h: 160, pitching_bb: 50 },
  ];
  const rows = poolRows({ roster, seasonStats, matchId: 7, teamAbbr: 'PHI', probableId: 2 });
  assert.deepEqual(rows.map((r) => r.kind), ['arm', 'arm', 'bat', 'bat', 'bat']);
  // THE PROBABLE IS THE ARM WORTH OFFERING FIRST - a bullpen arm may not
  // appear at all, and the card's arm slot is a start.
  assert.equal(rows[0].name, 'Zack Wheeler');
  assert.equal(rows[0].probable, true);
  // Then bats by descending PPG.
  const bats = rows.filter((r) => r.kind === 'bat');
  assert.deepEqual(bats.map((b) => b.name), ['Kyle Schwarber', 'Bryce Harper', 'Rookie Callup']);
  // A CALL-UP WITH NO SEASON LINE IS PICKABLE, sorted last, ppg null - not
  // dropped, and not a zero that would outrank a real number below it.
  assert.equal(bats.at(-1).ppg, null);
  assert.equal(rows[0].short, 'Z. Wheeler');
  assert.equal(rows.every((r) => r.matchId === 7 && r.team === 'PHI'), true);
});

// ------------------------------------------------ the burn, and where it lives

test('OCTOBER NEVER READS A PRIOR ENTRY, AND THE RUN ALWAYS DOES', () => {
  // THE LINE BETWEEN THE TWO GAMES, pinned in source rather than in behaviour,
  // because "no burn" is the ABSENCE of a query and an absence cannot be
  // asserted by calling something. What can be asserted is that no October
  // module reaches for one - and that the Run's still does, so a future tidy-up
  // cannot take the burn out of the game it belongs to by deleting a shared
  // helper.
  const read = (rel) => stripComments(readFileSync(path.join(REPO, rel), 'utf8'));

  // OCTOBER: no usedPlayers, no burn read, and nothing that joins this reader's
  // OTHER contests. The tell is `contest_entries` in a query that is not scoped
  // to one contest_id.
  for (const f of ['lib/october/pool.js', 'lib/october/entry.js', 'lib/october/rules.js', 'lib/october/board.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /usedPlayers/, `${f} must not read a burn list`);
    assert.doesNotMatch(src, /\bused\b\s*[:.]/, `${f} must not carry a used map`);
  }
  // refuseReason takes no `used` option at all - the option is how the rule
  // would come back.
  assert.doesNotMatch(read('lib/october/rules.js'), /used = new Set/);

  // THE RUN KEEPS ALL OF IT.
  const runPool = read('lib/run/pool.js');
  assert.match(runPool, /export async function usedPlayers/, "the Run's burn read");
  assert.match(runPool, /FROM contest_entries/, 'and it reads prior entries');
  assert.match(read('lib/run/rules.js'), /used\.has\(String\(player\.playerId\)\)/, "the Run's burn rule");
  assert.match(read('lib/run/entry.js'), /usedPlayers\(/, "the Run's door consults it");
});
