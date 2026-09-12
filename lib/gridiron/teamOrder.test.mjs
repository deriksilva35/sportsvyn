// lib/gridiron/teamOrder.test.mjs - one rule for who goes first (TEAM ORDER relay).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { orderFor, connectorFor, sidesFor, HOME_FIRST } from './teamOrder.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

test('gridiron is away-first, soccer is home-first, and an unruled league is football-shaped', () => {
  assert.deepEqual(orderFor('nfl'), ['away', 'home']);
  assert.deepEqual(orderFor('cfb'), ['away', 'home']);
  assert.deepEqual(orderFor('epl'), ['home', 'away']);
  // the default: anything not named reads away-first rather than blank or arbitrary
  for (const l of ['mls', 'nba', 'wnba', 'fifa-wc-2026', '', null, undefined]) {
    assert.deepEqual(orderFor(l), ['away', 'home'], `${l} defaults to away-first`);
  }
  assert.deepEqual([...HOME_FIRST], ['epl'], 'adding a soccer league is one entry here');
});

test('the connector: football "at", soccer "v"', () => {
  assert.equal(connectorFor('nfl'), 'at');
  assert.equal(connectorFor('cfb'), 'at');
  assert.equal(connectorFor('epl'), 'v');
  assert.equal(connectorFor('mls'), 'at', 'unruled leagues take the default too');
  assert.equal(connectorFor(undefined), 'at');
});

test('sidesFor pairs the order with the teams', () => {
  const home = { id: 1, abbreviation: 'ARS' }, away = { id: 2, abbreviation: 'CHE' };
  assert.deepEqual(sidesFor('epl', { home, away }), [{ side: 'home', team: home }, { side: 'away', team: away }]);
  assert.deepEqual(sidesFor('nfl', { home, away }), [{ side: 'away', team: away }, { side: 'home', team: home }]);
});

test('EVERY SURFACE THAT STACKS TWO TEAM ROWS ROUTES THROUGH orderFor - no second rule in the tree', () => {
  const SURFACES = [
    'components/scores/ScoresV2.js',              // the Scores tab cards
    'components/games/LobbyV2.js',                // the lobby's Tonight strip
    'components/gridiron/Scoreboard.js',          // the old board: football Card AND SoccerCard
    'components/pickem/PickemBoard.js',           // the Pick'em rows
    'app/nfl/game/[slug]/page.js',                // the game page headers
    'app/cfb/game/[slug]/page.js',
  ];
  for (const rel of SURFACES) {
    const t = strip(src(rel));
    assert.match(t, /from '@\/lib\/gridiron\/teamOrder'/, `${rel} must import the rule`);
    assert.match(t, /orderFor\(/, `${rel} must call orderFor`);
    // and must not stack the two sides by hand any more
    assert.doesNotMatch(t, /\[\s*'away'\s*,\s*'home'\s*\]|\[\s*'home'\s*,\s*'away'\s*\]/, `${rel} still hardcodes an order`);
  }
  // the old board routes BOTH its cards - football and soccer
  const board = strip(src('components/gridiron/Scoreboard.js'));
  assert.equal((board.match(/orderFor\(g\.leagueSlug\)/g) ?? []).length, 2, 'the football card and the soccer card');
  // the Pick'em row takes its connector from the rule as well
  assert.match(strip(src('components/pickem/PickemBoard.js')), /connectorFor\(contest\?\.sport\)/);
});
