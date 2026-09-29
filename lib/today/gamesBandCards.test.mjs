// lib/today/gamesBandCards.test.mjs - the front page's game cards say what is true (tue-3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickemLockLine, seasonGameCard, openDay } from './gamesBandCards.js';
import { lockLabel } from '../pickem/read.js';

test('lockLabel never prints the epoch: no date, no label', () => {
  assert.equal(lockLabel(null), null);
  assert.equal(lockLabel(undefined), null);
  assert.equal(lockLabel('not a date'), null);
  assert.match(lockLabel('2026-10-02T00:15:00Z'), /^Thu Oct 1, 8:15 PM ET$/);
});

test('Pick\'em: "locks <next>" while a game is ahead; "all games kicked" once none is - never Wed Dec 31', () => {
  assert.equal(pickemLockLine({ nextKickoff: '2026-10-04T17:00:00Z' }), 'locks Sun Oct 4, 1:00 PM ET');
  assert.equal(pickemLockLine({ nextKickoff: null }), 'all games kicked', 'the lobby row\'s words for the same state');
  assert.equal(pickemLockLine({}), 'all games kicked');
  assert.doesNotMatch(pickemLockLine({ nextKickoff: null }), /Dec 31/);
});

test('Weekly: every home state gets its own words and a link; nothing reads "Opens Sep 8"', () => {
  const v = (o) => ({ week: 3, href: '/weekly', ...o });
  assert.deepEqual(seasonGameCard('weekly', v({ state: 'play' })), { sub: 'Week 3 · open', cta: 'Set your six', open: true, href: '/weekly' });
  assert.deepEqual(seasonGameCard('weekly', v({ state: 'building', filled: 4, remaining: 2 })), { sub: 'Week 3 · 2 to fill', cta: 'Finish lineup · 4/6', open: true, href: '/weekly' });
  assert.deepEqual(seasonGameCard('weekly', v({ state: 'locked', filled: 6, entered: true })), { sub: 'Week 3 · locked', cta: 'Live · 6/6', open: true, href: '/weekly' });
  assert.equal(seasonGameCard('weekly', v({ state: 'locked', filled: 0, entered: false })).cta, 'Locked');
  assert.deepEqual(seasonGameCard('weekly', v({ state: 'settled', played: true, score: 112.4 })), { sub: 'Week 3 · 112.4 pts', cta: 'See results', open: true, href: '/weekly' });
  assert.equal(seasonGameCard('weekly', v({ state: 'settled', played: false })).sub, 'Week 3 · settled');
});

test('Draft: its states', () => {
  const v = (o) => ({ week: 3, href: '/draft', ...o });
  assert.equal(seasonGameCard('draft', v({ state: 'rules' })).cta, 'Start the draft');
  assert.equal(seasonGameCard('draft', v({ state: 'drafting' })).cta, 'Your pick is up');
  assert.deepEqual(seasonGameCard('draft', v({ state: 'waiting', picks: 5 })), { sub: 'Week 3 · 5 picked', cta: 'Back to the draft', open: true, href: '/draft' });
  assert.equal(seasonGameCard('draft', v({ state: 'locked', entered: true })).cta, 'Your team is set');
  assert.equal(seasonGameCard('draft', v({ state: 'settled', played: false })).cta, 'See results');
});

test('no board open: "Opens <the next board\'s real date>", ghosted; with no next board, "Opens soon"', () => {
  assert.deepEqual(seasonGameCard('weekly', null, { nextOpensAt: '2026-09-29T13:00:00Z' }),
    { sub: 'Six NFL players, best five count', cta: 'Opens Sep 29', open: false, href: null });
  assert.deepEqual(seasonGameCard('draft', null, {}), { sub: 'Eight picks feed a best six', cta: 'Opens soon', open: false, href: null });
  assert.equal(openDay('2026-09-08T03:00:00Z'), 'Sep 7', 'the ET day');
});

test('GamesBand reads the cards from here and types no date', () => {
  const src = readFileSync(new URL('../../components/today/GamesBand.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.doesNotMatch(code, /Opens Sep|'Opens [A-Z][a-z]{2} \d/);
  assert.match(src, /seasonGameCard\('weekly', weekly, \{ nextOpensAt: weeklyNextOpensAt \}\)/);
  assert.match(src, /seasonGameCard\('draft', draft, \{ nextOpensAt: draftNextOpensAt \}\)/);
  assert.match(src, /pickemLockLine\(pickem\)/);
  const page = readFileSync(new URL('../../app/page.js', import.meta.url), 'utf8');
  assert.match(page, /weeklyNextOpensAt=\{weeklyNextOpensAt\} draftNextOpensAt=\{draftNextOpensAt\}/);
});
