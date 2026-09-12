// lib/gridiron/teamOrder.test.mjs - one rule for who goes first (TEAM ORDER relay).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
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
  for (const l of ['mls', 'nba', 'wnba', 'ncaab', '', null, undefined]) {
    assert.deepEqual(orderFor(l), ['away', 'home'], `${l} defaults to away-first`);
  }
  assert.ok(HOME_FIRST.has('epl') && HOME_FIRST.has('fifa-wc-2026'), 'every soccer league we carry is here');
  assert.ok(!HOME_FIRST.has('nfl') && !HOME_FIRST.has('cfb'), 'and no gridiron league is');
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

// ---------------------------------------------------------------------------
// TEAM ORDER GO rider 3: nothing in components/ or app/ decides the order or
// the connector for itself. The ordering pin is absolute. The connector pin
// carries an ENUMERATED exceptions list, so the surfaces this rule has not
// reached yet are named here rather than hiding, and a NEW literal fails.
// ---------------------------------------------------------------------------
const WALK_ROOTS = ['components', 'app'];
function walkJs(rel, out = []) {
  for (const e of readdirSync(path.join(REPO, rel))) {
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue;
    const p = path.join(rel, e);
    if (statSync(path.join(REPO, p)).isDirectory()) walkJs(p, out);
    else if (e.endsWith('.js')) out.push(p);
  }
  return out;
}

// Each entry: the file, and WHY it still renders one. A perspective word
// ("we host them" vs "we travel to them") is NOT a league connector and must
// never be routed; the rest are surfaces this relay did not name.
const CONNECTOR_EXCEPTIONS = Object.freeze({
  'components/team/Schedule.js': 'perspective, not a connector: the team page reads "us vs opponent"',
  'components/match/PreviewLeft.js': 'the World Cup preview headline - not named by the TEAM ORDER relay',
  'app/app/app-shell.js': 'the shell match card already renders "v" - not named by the relay',
});

test('NO SURFACE ORDERS THE TWO SIDES BY HAND - the ordering pin is absolute', () => {
  const offenders = [];
  for (const root of WALK_ROOTS) {
    for (const f of walkJs(root)) {
      if (f.endsWith('.test.mjs')) continue;
      if (/\[\s*'away'\s*,\s*'home'\s*\]|\[\s*'home'\s*,\s*'away'\s*\]/.test(strip(src(f)))) offenders.push(f);
    }
  }
  assert.deepEqual(offenders, [], 'these files order the sides themselves - route them through orderFor');
});

test('NO NEW CONNECTOR ELEMENT - every remaining one is named, with a reason', () => {
  // THE CONNECTOR IS THE ELEMENT A READER SEES BETWEEN THE TWO SIDES:
  // <span>at</span>, <div>v</div>. Prose inside an accessible name, a page
  // title or a market string ("TB at CIN · NFL") is NAMING, not the
  // connector, and routing it is its own relay - see the report.
  const RE = />\s*(at|vs|v)\s*<\//;
  const found = [];
  for (const root of WALK_ROOTS) {
    for (const f of walkJs(root)) {
      if (f.endsWith('.test.mjs')) continue;
      if (RE.test(strip(src(f)))) found.push(f);
    }
  }
  const unexpected = found.filter((f) => !(f in CONNECTOR_EXCEPTIONS));
  assert.deepEqual(unexpected, [], 'a new connector element - use connectorFor(leagueSlug)');
  // the named surfaces really do route it
  for (const rel of ['components/match/TeamsHeader.js', 'components/alerts/AlertBell.js', 'components/slate/SlateRow.js']) {
    const t = strip(src(rel));
    assert.match(t, /connectorFor\(/, `${rel} must take its connector from the rule`);
    assert.match(t, /orderFor\(/, `${rel} must take its order from the rule`);
    assert.doesNotMatch(t, RE, `${rel} still renders a literal connector`);
  }
  // the list cannot rot: every named file must still exist and still hold one
  for (const f of Object.keys(CONNECTOR_EXCEPTIONS)) {
    assert.ok(found.includes(f), `${f} no longer renders a connector element - drop it from the list`);
  }
});

test('every soccer league reads home-first, so the World Cup header did not flip', () => {
  for (const l of ['epl', 'fifa-wc-2026', 'international-friendlies', 'concacaf-gold-cup', 'africa-cup-of-nations']) {
    assert.deepEqual(orderFor(l), ['home', 'away'], l);
    assert.equal(connectorFor(l), 'v', l);
  }
  for (const l of ['nfl', 'cfb']) {
    assert.deepEqual(orderFor(l), ['away', 'home'], l);
    assert.equal(connectorFor(l), 'at', l);
  }
});
