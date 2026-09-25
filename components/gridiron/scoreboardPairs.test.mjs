// components/gridiron/scoreboardPairs.test.mjs - the v1 Scoreboard card's two
// marks are a PAIR in both senses: helmets both-or-neither, and colours
// both-or-neither. An FBS club beside an FCS one (no colours on PROD) draws the
// plain abbreviation disc on both sides, as the Scores tab does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../lib/testing/stubDir.mjs';

install();
const LINK = stubPath('__sb_link_stub.mjs');
writeFileSync(LINK, "import React from 'react'; export default function Link({ href, children, ...rest }) { return React.createElement('a', { ...rest, href: String(href) }, children); }\n");
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/link') return { url: pathToFileURL(LINK).href, shortCircuit: true };
  if (spec.endsWith('.css')) return { url: pathToFileURL(LINK).href, shortCircuit: true };
  // Scoreboard imports its siblings extensionless ('./OddsStrip'), which the
  // bundler resolves and node does not.
  if (spec.startsWith('./') && !/\.[a-z]+$/i.test(spec)) return next(`${spec}.js`, ctx);
  return next(spec, ctx);
} });
after(() => { try { unlinkSync(LINK); } catch { /* gone */ } });

let html;
before(async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const Scoreboard = (await import('./Scoreboard.js')).default;
  html = (games) => renderToStaticMarkup(React.createElement(Scoreboard, { byLeague: { cfb: games, nfl: [] }, date: '2026-09-26', sport: 'cfb' }));
});

const team = (id, abbreviation, name, colors) => ({ id, abbreviation, name, colors });
const game = (id, away, home) => ({ id, slug: `g-${id}`, leagueSlug: 'cfb', status: 'scheduled', kickoffAt: '2026-09-26T16:00:00Z',
  homeScore: null, awayScore: null, home, away, seasonPhase: 'REG', week: 4 });
const PITT = team(1, 'PITT', 'Pittsburgh', { primary: '#003594', secondary: '#FFB81C' });
const BUCK = team(2, null, 'Bucknell', null);                     // FCS: no stored abbreviation, no colours
const COLO = team(3, 'COLO', 'Colorado', { primary: '#CFB87C', secondary: '#000000' });
const BAY = team(4, 'BAY', 'Baylor', { primary: '#154734', secondary: '#FFB81C' });
const marks = (h) => [...h.matchAll(/data-teammark="(\w+)"/g)].map((m) => m[1]);

test('FBS v FCS on the Scoreboard: the plain abbreviation disc on BOTH sides', () => {
  const h = html([game(10, BUCK, PITT)]);
  assert.deepEqual(marks(h), ['abbr', 'abbr']);
  assert.doesNotMatch(h, /headgear|data-teammark="circle"/, 'Pitt drops its helmet and its colours to match Bucknell');
});

test('FBS v FBS keeps its helmets', () => {
  const h = html([game(11, COLO, BAY)]);
  assert.deepEqual(marks(h), ['headgear', 'headgear']);
});
