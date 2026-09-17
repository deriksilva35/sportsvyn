// components/draft/draftLiveCardV2.test.mjs - the Draft's in-flight card in
// every state it has (docs/design/mocks/draft-v2.html, screen 2).
//
// THE CARD HAD EVERY FACT AND PRINTED st.label ALONE. slotState hands it the
// opponent, the side of it, shortOf's period, the clock and the final score;
// these tests pin that each one reaches the screen, and that the two rows that
// drop are marked as such while the six that count are marked as such too.
//
// jsdom, the real component, every root unmounted in afterEach.

import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { transformSync } from '@babel/core';
import { install } from '../../lib/testing/nextResolve.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let React; let createRoot; let act; let Card; let dom; let tmp;
const roots = new Set();

const HOUR = 3600_000;
const future = (h = 3) => new Date(Date.now() + h * HOUR).toISOString();

/** slotState's own output shape, for each of the four states. */
const stFinal = (pts, team, opp, home, score, oppScore) => ({
  kind: 'final', label: 'final', started: true, points: pts, kickoffAt: null,
  period: null, clock: null, opp, home, score, oppScore,
});
const stLive = (pts, opp, home, period, clock) => ({
  kind: 'live', label: `${period}${clock ? ` ${clock}` : ''}`, started: true, points: pts,
  kickoffAt: null, period, clock, opp, home, score: 10, oppScore: 7,
});
const stSched = (opp, home, iso) => ({
  kind: 'scheduled', label: null, started: false, points: null, kickoffAt: iso,
  period: null, clock: null, opp, home, score: null, oppScore: null,
});
const stBye = () => ({
  kind: 'bye', label: 'bye', started: false, points: null, kickoffAt: null,
  period: null, clock: null, opp: null, home: false, score: null, oppScore: null,
});

/** draftLiveRows' own output: eight rows, six marked counting. */
function card() {
  const rows = [
    { key: 1, round: 1, pos: 'QB', name: 'Josh Allen', team: 'BUF', points: 28.4, counting: true, state: stFinal(28.4, 'BUF', 'DET', true, 31, 24) },
    { key: 2, round: 2, pos: 'RB', name: 'Jahmyr Gibbs', team: 'DET', points: 19.8, counting: true, state: stFinal(19.8, 'DET', 'BUF', false, 24, 31) },
    { key: 3, round: 3, pos: 'WR', name: 'CeeDee Lamb', team: 'DAL', points: 16.3, counting: true, state: stLive(16.3, 'WSH', true, 'Q3', '4:12') },
    { key: 4, round: 4, pos: 'RB', name: 'Kenneth Walker', team: 'SEA', points: 14.9, counting: true, state: stFinal(14.9, 'SEA', 'NE', true, 20, 17) },
    { key: 5, round: 5, pos: 'WR', name: 'Puka Nacua', team: 'LAR', points: 0, counting: true, state: stSched('NYG', true, future(28)) },
    { key: 6, round: 6, pos: 'TE', name: 'George Kittle', team: 'SF', points: 9.1, counting: true, state: stLive(9.1, 'MIA', true, 'Q2', null) },
    { key: 7, round: 7, pos: 'WR', name: 'Khalil Shakir', team: 'BUF', points: 7.4, counting: false, state: stFinal(7.4, 'BUF', 'DET', true, 31, 24) },
    { key: 8, round: 8, pos: 'RB', name: 'Chuba Hubbard', team: 'CAR', points: 8.0, counting: false, state: stBye() },
  ];
  return { rows, total: 88.5, startedCount: 5, counting: 6 };
}

before(async () => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/draft' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  global.fetch = async () => { throw new Error('this card must not fetch'); };
  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  const src = path.join(__dirname, 'DraftLiveCard.js');
  const out = transformSync(readFileSync(src, 'utf8'), {
    filename: src, presets: [['@babel/preset-react', { runtime: 'automatic' }]], configFile: false, babelrc: false,
  }).code;
  tmp = path.join(__dirname, `__dvg_${process.pid}.mjs`);
  writeFileSync(tmp, out.replace(/^'use client';\s*/m, ''));
  Card = (await import(pathToFileURL(tmp).href)).default;
});
afterEach(() => { for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } } roots.clear(); });
after(() => { try { unlinkSync(tmp); } catch { /* gone */ } });

function render(props = {}) {
  const c = document.getElementById('root');
  const root = createRoot(c); roots.add(root);
  act(() => root.render(React.createElement(Card, { card: card(), roster: [], seatLine: null, ...props })));
  return c;
}
const rows = (c) => [...c.querySelectorAll('.dvg-rr')];
const t = (c, s) => c.querySelector(s)?.textContent ?? null;
const lineOf = (row) => row.querySelector('.dvg-who small')?.textContent ?? null;

// ---------------------------------------------------------------------------
// BEFORE THE FIRST KICKOFF
// ---------------------------------------------------------------------------

test('BEFORE ANYTHING KICKS OFF: eight rows, no hero, and no number invented', () => {
  const roster = Array.from({ length: 8 }, (_, i) => ({
    id: i + 1, ffc: `f${i}`, round: i + 1, pos: 'RB', name: `Player ${i + 1}`, team: 'KC',
  }));
  const c = render({ card: null, roster });
  assert.equal(rows(c).length, 8);
  assert.equal(c.querySelector('.dvg-rec'), null, 'the hero is absent, not zeroed');
  assert.doesNotMatch(c.textContent, /\b0\.0\b/);
  for (const r of rows(c)) assert.equal(r.querySelector('.dvg-pts').textContent, '', 'no points at all');
  // every pip reads "to come", and none is dropped: nothing has been decided
  assert.equal(c.querySelectorAll('.dvg-pip.on').length, 8);
  assert.equal(c.querySelectorAll('.dvg-pip.drop').length, 0);
  assert.match(t(c, '.dvg-sub'), /8 of 8 count · worst two dropped/);
});

// ---------------------------------------------------------------------------
// IN FLIGHT
// ---------------------------------------------------------------------------

test('THE HERO IS THE LIVE BEST SIX, with how much of it has played', () => {
  const c = render();
  assert.match(t(c, '.dvg-big'), /^88\.5 · 5 of 8 started$/);
  assert.match(t(c, '.dvg-sub'), /6 of 8 count · worst two dropped/);
  assert.match(t(c, '.dvg-sub'), /graded Tuesday/);
});

test('A FINAL ROW: the team, the score it ended on, and no kickoff time', () => {
  const c = render();
  assert.equal(lineOf(rows(c)[0]), 'R1 · BUF · Final 31-24');
  assert.equal(rows(c)[0].querySelector('.dvg-pts').textContent, '28.4');
  assert.ok(rows(c)[0].className.includes('fin'));
  assert.doesNotMatch(lineOf(rows(c)[0]), /AM|PM/);
  // AND THE ORIENTATION IS THE PLAYER'S OWN: Gibbs was on the other side.
  assert.equal(lineOf(rows(c)[1]), 'R2 · DET · Final 24-31');
});

test('A LIVE ROW: the matchup, shortOf\'s period, the clock, in the live colour', () => {
  const c = render();
  assert.equal(lineOf(rows(c)[2]), 'R3 · DAL vs WSH · Q3 4:12');
  assert.ok(rows(c)[2].className.includes('live'));
  assert.ok(rows(c)[2].querySelector('.dvg-who small').className.includes('dvg-l'));
  assert.equal(rows(c)[2].querySelector('.dvg-pts').textContent, '16.3');
  // A LIVE GAME WITH NO CLOCK says the period and stops there.
  assert.equal(lineOf(rows(c)[5]), 'R6 · SF vs MIA · Q2');
});

test('A ROW STILL TO PLAY: the matchup and its kickoff, and NO number', () => {
  const c = render();
  assert.match(lineOf(rows(c)[4]), /^R5 · LAR vs NYG$/);
  assert.match(rows(c)[4].querySelector('.dvg-pts').textContent, /\d{1,2}:\d{2} (AM|PM)/,
    'the kickoff stands where the number will go');
});

test('A BYE READS AS A BYE', () => {
  const c = render();
  assert.equal(lineOf(rows(c)[7]), 'R8 · CAR · bye');
  assert.equal(rows(c)[7].querySelector('.dvg-pts').textContent, 'bye');
});

// ---------------------------------------------------------------------------
// THE SIX THAT COUNT, AND THE TWO THAT DO NOT
// ---------------------------------------------------------------------------

test('THE COUNTING SIX ARE MARKED, and the two that drop are struck and dimmed', () => {
  const c = render();
  const marked = rows(c).filter((r) => r.querySelector('.dvg-count') != null);
  // ALL SIX, INCLUDING THE ONE WHO HAS NOT PLAYED YET. The tick is about
  // membership in the best six AS OF NOW - which is what bestBall decided -
  // and not about having a number yet. Puka Nacua counts on Sunday afternoon
  // with a Monday kickoff ahead of him.
  assert.equal(marked.length, 6, 'the counting six carry the tick');
  assert.ok(marked.some((r) => r.textContent.includes('Puka Nacua')),
    'a counting row whose game has not kicked off is still one of the six');
  const dropped = rows(c).filter((r) => r.className.includes('drop'));
  assert.deepEqual(dropped.map((r) => r.querySelector('.dvg-who b').textContent),
    ['Khalil Shakir', 'Chuba Hubbard']);
  // AND THE PIPS SAY IT A SECOND WAY.
  assert.equal(c.querySelectorAll('.dvg-pip.drop').length, 2);
  assert.equal(c.querySelectorAll('.dvg-pip.done').length, 3, 'three finals among the six');
  assert.equal(c.querySelectorAll('.dvg-pip.live').length, 2);
  const states = [...c.querySelectorAll('.dvg-pip')].map((p) => p.getAttribute('data-row-state'));
  assert.deepEqual(states, ['final', 'final', 'live', 'final', 'scheduled', 'live', 'dropped', 'dropped']);
});

test('A DROPPED ROW KEEPS ITS NUMBER VISIBLE - it is dimmed, not hidden', () => {
  const c = render();
  const shakir = rows(c).find((r) => r.textContent.includes('Khalil Shakir'));
  assert.equal(shakir.querySelector('.dvg-pts').textContent, '7.4');
  assert.equal(shakir.querySelector('.dvg-count'), null, 'and it carries no counting tick');
});

// ---------------------------------------------------------------------------
// THE STRIP, THE FOOTER, AND WHAT THIS RELAY DOES NOT DRAW
// ---------------------------------------------------------------------------

test('THE STRIP is Draft / Scored live / Settled, with the rule under it', () => {
  const c = render();
  assert.deepEqual([...c.querySelectorAll('.dvg-stp b')].map((b) => b.textContent),
    ['Draft', 'Scored live', 'Settled']);
  assert.equal(c.querySelector('.dvg-stp.done b').textContent, 'Draft');
  assert.equal(c.querySelector('.dvg-stp.on b').textContent, 'Scored live');
  assert.match(t(c, '.dvg-note'), /best six count/);
  assert.match(t(c, '.dvg-note'), /worst\s+two drop/);
  assert.match(t(c, '.dvg-note'), /2 games are on now\./);
});

test('THE FOOTER SAYS THE SEAT IN POINTS, or says what it is waiting for', () => {
  const withLine = render({ seatLine: 'Seat 5 averages 118.2 pts over 12 drafts' });
  assert.match(t(withLine, '.dvg-pace'), /Seat 5 averages 118\.2 pts over 12 drafts/);
  assert.match(t(withLine, '.dvg-pace'), /by seat/);
  act(() => { for (const r of roots) r.unmount(); }); roots.clear();
  const without = render({ seatLine: null });
  assert.match(t(without, '.dvg-pace'), /Seat averages arrive once a week has settled/);
  // NO BUTTON: there is nothing to press on a card about a week in flight.
  assert.equal(without.querySelector('button'), null);
});

test('NO RANK CELL, NO FIELD BAR, NO ROOM TABLE this relay', () => {
  const c = render();
  assert.equal(c.querySelector('.dvg-rt'), null, 'no rank cell');
  assert.doesNotMatch(c.textContent, /of 12 · this room|field best|room best/);
  assert.equal(c.querySelector('.dvg-ft button'), null);
});

test('THE CARD SCORES NOTHING - the guard, restated where it can be seen', () => {
  const src = readFileSync(new URL('./DraftLiveCard.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /fantasyPoints|RECEPTION_PTS|recYds|rushTd/);
  assert.doesNotMatch(src, /bestBall/, 'bestBall chose the six; this draws them');
});
