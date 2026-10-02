// components/games/seasonBoard.test.mjs - frame 3's laws.
//
// The movement derivation is pure and tested as math; the component and its
// two consumers are pinned as source, because the podium's shape and the
// one-definition law are structural facts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seasonStandings, annotateMovement } from '../../lib/daily/standings.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const row = (userId, tier) => ({ userId, handle: `u${userId}`, tier, score: 100, perfect: 150 });

test('movement is prevRank minus rank: climbed, fell, held, and the new entrant', () => {
  // Yesterday: u1 led, u2 second. Today u2 overtakes and u3 debuts.
  const prev = seasonStandings([row(1, 'MVP'), row(2, 'PRO BOWLER')], 1);
  const today = seasonStandings([
    row(1, 'MVP'), row(2, 'PRO BOWLER'),
    row(2, 'HALL OF FAME'), row(3, 'STARTER'),
  ], 2);
  annotateMovement(today, prev);
  const by = new Map(today.map((e) => [e.userId, e]));
  assert.equal(by.get(2).move, 1, 'u2 climbed one');
  assert.equal(by.get(1).move, -1, 'u1 fell one');
  assert.equal(by.get(3).move, null, 'the debut has no arrow to earn');
});

test('a one-day season moves nobody - every arrow is the flat dash', () => {
  const today = seasonStandings([row(1, 'MVP'), row(2, 'STARTER')], 1);
  annotateMovement(today, []);
  assert.ok(today.every((e) => e.move === null));
});

test('the derivation is a second pure pass over the SAME rows - no new SQL', () => {
  const t = src('lib/daily/boards.js');
  assert.match(t, /const prevRows = inSeason\.filter\(\(r\) => r\.d !== through\)/);
  assert.match(t, /annotateMovement\(table, prevRows\.length \? seasonStandings\(prevRows\.map\(mapRow\)/);
  // Still exactly the revealed-only queries it always had - the pin the
  // arrows must not have loosened.
  assert.equal((t.match(/AND dd\.revealed/g) ?? []).length, 2, 'both member branches stay revealed-only');
});

test('the podium takes what exists - three, two, or one, never a ghost card', () => {
  const t = src('components/games/SeasonBoard.js');
  assert.match(t, /const podium = table\.top\.slice\(0, 3\)/);
  assert.match(t, /\[podium\[1\], podium\[0\], podium\[2\]\]\.filter\(Boolean\)/,
    'second-first-third order, missing slots dropped');
  assert.match(t, /const rest = table\.top\.slice\(3\)/);
});

test('the viewer pins at the bottom AND stays in the list - the ratified lean', () => {
  const t = src('components/games/SeasonBoard.js');
  assert.match(t, /table\.top\.find\(\(r\) => r\.userId === uid\) \?\? table\.self \?\? null/);
  assert.match(t, /mine && uid != null && <Row r=\{mine\} me pinned \/>/);
  assert.match(src('components/games/season.css'), /\.sb-row\.you \{[^}]*position: sticky; bottom: 8px;/);
});

test('tier colors come from config, and this surface writes none of its own', () => {
  const board = src('components/games/SeasonBoard.js');
  assert.match(board, /import \{ tierClass \} from '@\/lib\/daily\/reveal'/);
  assert.match(board, /tierClass\(best\)/);
  const css = src('components/games/season.css');
  assert.ok(!/tier--\w+ \{[^}]*color/.test(css), 'no hand-written tier colors in season.css');
});

test('ONE definition: the lobby renders it (the league page has its own derived table since Leagues V1)', () => {
  // GAMES v3: the lobby's half moved from the page into the pane, because the
  // page no longer renders panes - the Boards chip's SEASON tab draws it.
  // Same component, same props, one definition.
  assert.match(src('components/games/LobbyV3.js'), /import SeasonBoard from '@\/components\/games\/SeasonBoard'/);
  assert.match(src('components/games/LobbyV3.js'), /<SeasonBoard table=\{sec\.table\} userId=\{userId\} \/>/);
  // LEAGUES V1 (P2): /leagues/[id] no longer draws the v1 Daily season board -
  // its table is lib/leagues/table.js across every game the league plays,
  // rendered by components/leagues/LeagueBoard.js.
  assert.match(src('app/leagues/[id]/page.js'), /<LeagueBoard /);
});

test('points keep the numcols discipline - fixed ch, right-aligned, tabular', () => {
  assert.match(src('components/games/season.css'),
    /\.sb-pts \{[^}]*width: 7ch; text-align: right; font-variant-numeric: tabular-nums;/);
});
