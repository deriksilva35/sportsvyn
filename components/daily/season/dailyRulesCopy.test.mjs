// components/daily/season/dailyRulesCopy.test.mjs - sat-5 Y2-Y8.
//
// Everywhere The Daily is described, the words match what the code does:
// nothing dropped, cards of 4 to 6, a board at midnight ET, one attempt,
// picks held on the device until lock-in, a 3-minute clock, the tie order,
// kicker scoring and no fumble penalty. Source pins on each surface (the
// how-it-works page has its own, with the code facts, in howItWorks.test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME_META } from '../../../lib/games/lobby.js';
import { dailyCard } from '../../../lib/games/lobbyV2Shape.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

test('the in-game rules card states the house rules', () => {
  const sb = src('components/daily/season/SeasonBoard.js');
  const card = sb.slice(sb.indexOf('function RulesCard('));
  for (const s of [
    'Twelve team cards, 4 to 6 players each.',
    'Tap a filled slot to clear it and get the team back.',
    'nothing is dropped: kickers get 3 per field goal and 1 per extra point, and there is no fumble penalty.',
    'Same score, same place; within a tie, the earliest lock-in lists first.',
    'Your picks stay on this device until you lock in; close the tab and they are lost.',
    'A new board opens at midnight ET.',
    'Three minutes from Start. The clock is on the server.',
  ]) assert.ok(card.includes(s), `rules card is missing: ${s}`);
  assert.doesNotMatch(card, /drop(ped)? worst|worst pick/i);
});

test('the board note no longer promises six players a card', () => {
  const sb = src('components/daily/season/SeasonBoard.js');
  assert.ok(!sb.includes('to see its six'), 'cards hold 4 to 6, not six');
  assert.ok(!sb.includes('>Six from the <b>'), 'cards hold 4 to 6, not six');
});

test('GamesBand and the Practice band do not say drop worst or best six for the Daily', () => {
  const band = src('components/today/GamesBand.js');
  assert.ok(band.includes("'One board a day · eight slots, three minutes'"));
  assert.doesNotMatch(band, /drop worst/);
  const sim = src('app/sim/page.js');
  assert.ok(sim.includes('Today&rsquo;s board is live. Three minutes, eight slots.'));
  assert.ok(!sim.includes('best six'));
});

test('the lobby lines: three minutes, no commit-on-open, a hidden season', () => {
  assert.equal(GAME_META.daily.blurb, 'Twelve teams. Eight slots. Three minutes.');
  assert.doesNotMatch(GAME_META.daily.hook, /must|spent/);
  assert.equal(GAME_META.daily.chips[0], '3 min');
  assert.equal(dailyCard({}).description,
    'Eight slots, twelve teams, one hidden NFL season. Three minutes. Same board for everyone.');
});

test('the home page feeds its Daily card from the season board, not v1', () => {
  const home = src('app/page.js');
  assert.match(home, /dailyV2Band\(/);
  assert.doesNotMatch(home, /getDailyHome\(|getYesterday\(/);
  const band = src('lib/daily/seasonBoardHome.js');
  assert.doesNotMatch(band, /puzzle_days|puzzle_entries/);
  assert.match(band, /WHERE now\(\) >= b\.closes_at/, 'scores come only from a closed edition');
});
