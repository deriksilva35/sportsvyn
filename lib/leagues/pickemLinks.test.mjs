// lib/leagues/pickemLinks.test.mjs - the league page links its Pick'em boards,
// filtered to the league (/pickem/<sport>?league=<id>), one per Pick'em sport.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickemBoardLinks } from './nav.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('a Pick\'em league links each Pick\'em sport\'s board, filtered to the league', () => {
  assert.deepEqual(pickemBoardLinks(42, ['pickem', 'weekly']), [
    { sport: 'nfl', label: "Pick'em NFL", href: '/pickem/nfl?league=42' },
    { sport: 'cfb', label: "Pick'em CFB", href: '/pickem/cfb?league=42' },
  ]);
});

test('a league without Pick\'em links none', () => {
  assert.deepEqual(pickemBoardLinks(42, ['weekly', 'daily']), []);
  assert.deepEqual(pickemBoardLinks(42), []);
});

test('the league board draws the links from the one helper', () => {
  const t = src('components/leagues/LeagueBoard.js');
  assert.match(t, /pickemBoardLinks\(league\.id, league\.games\)/);
  assert.match(t, /<Link href=\{l\.href\}>\{l\.label\}<\/Link>/);
});
