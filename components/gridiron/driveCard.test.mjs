// components/gridiron/driveCard.test.mjs - the drive card, rendered (drive-2).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install } from '../../lib/testing/nextResolve.mjs';
install();

let React, renderToStaticMarkup, DriveCard, driveCardFor;
before(async () => {
  React = await import('react');
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  DriveCard = (await import('./DriveCard.js')).default;
  ({ driveCardFor } = await import('../../lib/gridiron/driveCard.js'));
});

const NOW = new Date('2026-11-08T21:00:00Z');
const ago = (s) => new Date(NOW.getTime() - s * 1000).toISOString();
const game = { home: { id: 1, abbreviation: 'ARI', colors: { primary: '#97233F' } }, away: { id: 2, abbreviation: 'SEA', name: 'Seattle', colors: { primary: '#002244' } } };
const snap = (o) => ({ period: 4, clock: '5:00', down: 2, distance: 10, yardsToGoal: 44, yardsGained: 2, offenseTeamId: 2, playType: 'rush', text: 'x', scoring: false, driveId: 'r9', homeScore: 0, awayScore: 0, createdAt: ago(300), ...o });
const render = (dc, lastPlay) => renderToStaticMarkup(React.createElement(DriveCard, { dc, lastPlay }));

test('mid-drive: the lines, the five field marks and the aria-label', () => {
  const dc = driveCardFor({ plays: [snap()], game, drives: [{ driveId: 'r9', offenseTeamId: 2, playCount: 9, yards: 37, duration: '4:31', startYardsToGoal: 79 }], now: NOW });
  const html = render(dc, 'K.Walker rush up the middle for 2 yards.');
  assert.match(html, /3rd &amp; 8 · ARI 42/);
  assert.match(html, /9 plays · 37 yds · 4:31/);
  assert.match(html, /aria-label="Ball at ARI 42, first down at ARI 34"/);
  for (const m of ['data-los', 'data-firstdown', 'data-ball', 'data-band', 'data-start']) assert.match(html, new RegExp(m), m);
  assert.doesNotMatch(html, /data-redzone/, 'outside the 20 there is no tint');
  assert.doesNotMatch(html, /timeout/i, 'no timeout dots: no feed has them');
  assert.match(html, /K\.Walker rush/);
});

test('red zone and & Goal: tint present, no first-down line', () => {
  const dc = driveCardFor({ plays: [snap({ offenseTeamId: 1, down: 2, distance: 4, yardsToGoal: 28, yardsGained: 22 })], game, now: NOW });
  const html = render(dc);
  assert.match(html, /data-redzone/); assert.doesNotMatch(html, /data-firstdown/);
  assert.match(html, /1st &amp; Goal · SEA 6/); assert.match(html, /aria-label="Ball at SEA 6, goal to go"/);
});

test('scoring moment: volt end zone with TD in navy, headline; gone at 40 s', () => {
  const td = snap({ playType: 'rushing-touchdown', scoring: true, awayScore: 6, down: 1, distance: 6, yardsToGoal: 6, yardsGained: 6, createdAt: ago(10) });
  const html = render(driveCardFor({ plays: [td], game, now: NOW }));
  assert.match(html, /Touchdown · Seattle/);
  assert.match(html, /data-zone="left" data-flash="TD"/);
  assert.match(html, /fill="#D4FF00"/); assert.match(html, /fill="#1A1650"[^>]*>TD</);
  const old = render(driveCardFor({ plays: [{ ...td, createdAt: ago(40) }], game, now: NOW }));
  assert.doesNotMatch(old, /data-flash|Touchdown ·/);
});

test('390px: the SVG scales (no fixed width), nothing can scroll sideways, no new stylesheet', () => {
  const html = render(driveCardFor({ plays: [snap()], game, now: NOW }));
  assert.match(html, /<svg viewBox="0 0 354 60"/);
  assert.doesNotMatch(html, /<svg[^>]* width="\d+"/, 'a fixed 354 would still fit, but only the viewBox scales to a narrower card');
  assert.match(html, /style="display:block;width:100%;height:auto;max-width:100%"/);
  assert.match(html, /flex-wrap:wrap/, 'the two lines wrap rather than overflow');
  const src = readFileSync(new URL('./DriveCard.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /#[0-9a-fA-F]{6}\b/, 'no colour literal in the component: palette or team colour only');
  assert.doesNotMatch(src, /import .*\.css/, 'no stylesheet');
});

test('the card is wired on both surfaces and falls back to the old strip', () => {
  const board = readFileSync(new URL('../scores/ScoreboardV4.js', import.meta.url), 'utf8');
  assert.match(board, /live && x\.driveCard \? <DriveCard/);
  assert.match(board, /live && x\.drive && !x\.driveCard/);
  assert.match(readFileSync(new URL('../../lib/gridiron/scoresV2.js', import.meta.url), 'utf8'), /driveCard: plays\.has\(g\.id\) \? driveCardFor\(/);
  assert.match(readFileSync(new URL('../../lib/gridiron/gamePageArcadeView.js', import.meta.url), 'utf8'), /driveCard: state === 'live' \? driveCardFor\(/);
});
