// components/scores/scoresRail.test.mjs - the landscape rail, mounted (scores-landscape).
// Counts come from a fixture day (sportCountsOf, the function scoresV2 uses),
// a sport with none shows no number, and the Weekly tile is signed-in only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { install } from '../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../lib/testing/stubDir.mjs';
install();

const LINK = stubPath('__link_stub_rail.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/link') return { url: pathToFileURL(LINK).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, renderToStaticMarkup, ScoresRail, sportCountsOf, hrefs, APP_TABS;
before(async () => {
  writeFileSync(LINK, "import React from 'react'; export default function Link({ href, children, ...rest }) { return React.createElement('a', { ...rest, href: String(href) }, children); }\n");
  React = await import('react');
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  ScoresRail = (await import('./ScoresRail.js')).default;
  ({ sportCountsOf } = await import('../../lib/gridiron/scoresV2.js'));
  ({ hrefs } = await import('../../lib/scores/v4.js'));
  ({ APP_TABS } = await import('../../lib/shell/appTabs.js'));
});
after(() => { try { unlinkSync(LINK); } catch { /* gone */ } });

// THE FIXTURE DAY: 3 NBA, 1 CFB, 2 NFL; no MLB, no EPL.
const day = [
  ...[1, 2, 3].map((id) => ({ id, leagueSlug: 'nba' })),
  { id: 4, leagueSlug: 'cfb' }, { id: 5, leagueSlug: 'nfl' }, { id: 6, leagueSlug: 'nfl' },
];
const WEEKLY = { total: 41.84, playedCount: 3, slots: 6 };
const mount = (o = {}) => {
  const h = hrefs({ date: null, sport: o.sport ?? 'all', view: null, conf: null, mine: false, top25: false });
  const html = renderToStaticMarkup(React.createElement(ScoresRail, { sport: 'all', counts: sportCountsOf(day), leagues: ['nba', 'cfb', 'nfl'], href: h.sport, weekly: null, signedIn: false, ...o }));
  return new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
};
const countOf = (d, k) => d.querySelector(`[data-rail-sport="${k}"] .n`)?.textContent ?? null;

test('sportCountsOf counts the fixture day by league, and All is the total', () => {
  assert.deepEqual(sportCountsOf(day), { all: 6, nba: 3, cfb: 1, nfl: 2 });
});

test('the rail shows each sport with the day\'s count; a sport with none shows no number', () => {
  const d = mount();
  assert.equal(countOf(d, 'all'), '6');
  assert.equal(countOf(d, 'nba'), '3');
  assert.equal(countOf(d, 'cfb'), '1');
  assert.equal(countOf(d, 'nfl'), '2');
  assert.ok(d.querySelector('[data-rail-sport="mlb"]'), 'the MLB chip is present (always shown)');
  assert.equal(countOf(d, 'mlb'), null, 'MLB has no game today: no number');
  assert.equal(d.querySelector('[data-rail-sport="epl"]'), null, 'EPL is not on the day, so its chip is not drawn (the board\'s rule)');
  assert.ok(d.querySelector('[data-rail-sport="all"]').classList.contains('on'));
});

test('the sport links are the board\'s own hrefs', () => {
  const d = mount({ sport: 'nba' });
  assert.equal(d.querySelector('[data-rail-sport="nba"]').getAttribute('href'), '/scores?sport=nba');
  assert.equal(d.querySelector('[data-rail-sport="all"]').getAttribute('href'), '/scores');
  assert.ok(d.querySelector('[data-rail-sport="nba"]').classList.contains('on'));
});

test('the tab entries are the app bar\'s own, as icons, with Scores lit', () => {
  const d = mount();
  const tabs = [...d.querySelectorAll('.rail-tab')];
  assert.deepEqual(tabs.map((a) => a.getAttribute('data-key')), APP_TABS.map((t) => t.key));
  assert.deepEqual(tabs.map((a) => a.getAttribute('href')), APP_TABS.map((t) => t.href));
  assert.equal(d.querySelector('.rail-tab.on').getAttribute('data-key'), 'scores');
});

test('the Weekly tile is hidden signed out, even if a reading is handed in', () => {
  assert.equal(mount({ weekly: WEEKLY, signedIn: false }).querySelector('[data-rail-weekly]'), null);
});

test('the Weekly tile is shown signed in, with total, played and slots', () => {
  const t = mount({ weekly: WEEKLY, signedIn: true }).querySelector('[data-rail-weekly]');
  assert.ok(t);
  assert.match(t.textContent, /YOUR WEEKLY/);
  assert.match(t.textContent, /41\.8/);
  assert.match(t.textContent, /3 of 6 played/);
});

test('signed in with no Weekly entry: no tile (weeklyHero is null)', () => {
  assert.equal(mount({ weekly: null, signedIn: true }).querySelector('[data-rail-weekly]'), null);
});
