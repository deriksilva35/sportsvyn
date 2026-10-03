// components/soccer/uclArcade.test.mjs - the Champions League under arcade
// (ucl, fri-3): the card on /scores, the match page's links, the league-phase
// table and its bands. Rendered.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../lib/testing/stubDir.mjs';
import { momentsFromEvents, momentList } from '../../lib/soccer/moments.js';
install();

const LINK = stubPath('__link_stub_ucl.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/link') return { url: pathToFileURL(LINK).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, render, CardFace, Card, EplPageArcade, UclTableArcade, bandedRows;
before(async () => {
  writeFileSync(LINK, "import React from 'react'; export default function Link({ href, children, ...rest }) { return React.createElement('a', { ...rest, href: String(href) }, children); }\n");
  React = await import('react');
  render = (await import('react-dom/server')).renderToStaticMarkup;
  ({ CardFace, Card } = await import('../scores/ScoreboardV4.js'));
  EplPageArcade = (await import('./EplPageArcade.js')).default;
  ({ default: UclTableArcade, bandedRows } = await import('./UclTableArcade.js'));
});
after(() => { try { unlinkSync(LINK); } catch { /* gone */ } });

const NOW = new Date('2026-09-09T22:00:00Z');
const team = (id, ab, name) => ({ id, abbreviation: ab, name, shortName: name, colors: null });
const ev = (minute, event_type, detail, team_side, player_name) => ({ minute, minute_extra: null, event_type, detail, team_side, player_name, assist_name: null, is_current: true });
const MOMENTS = momentsFromEvents([ev(11, 'Goal', 'Normal Goal', 'away', 'J. McGinn'), ev(19, 'Goal', 'Normal Goal', 'home', 'H. Vetlesen')]);
const G = (status, o = {}) => ({ id: 1, slug: 'club-brugge-kv-vs-aston-villa-2026-09-08', leagueSlug: 'ucl', status, kickoffAt: '2026-09-08T16:45:00Z',
  homeScore: 2, awayScore: 3, week: 1, stage: 'league',
  home: team(10, 'CLU', 'Club Brugge KV'), away: team(11, 'AST', 'Aston Villa'), network: null, liveState: null, etWeekday: 'Tue', ...o });
const X = (o = {}) => ({ rank: { home: null, away: null }, record: { home: '20th', away: '5th' }, spreadHome: null, total: null, openHome: null, preview: null, drive: null, diamond: null, stat: null, hasStats: false, mlbFoot: null, probables: null, prob: null, stake: null, open: false, soccer: MOMENTS, ...o });
const face = (g, x, o = {}) => render(React.createElement(CardFace, { g, x, signedIn: false, signinHref: '/signin', tz: 'America/New_York', now: NOW, ...o }));

test('THE FINAL UCL CARD: FT, home first, the goals on the face, UCL in the corner, and the link is the UCL match page', () => {
  const h = face(G('final'), X());
  assert.match(h, /<span class="fin">FT · Tue<\/span>/);
  assert.match(h, /<span class="where">UCL/);
  assert.ok(h.indexOf('data-side="home"') < h.indexOf('data-side="away"'), 'home first, as soccer reads');
  assert.match(h, /data-soccer="1"/);
  assert.match(h, /McGinn 11/);
  const card = render(React.createElement(Card, { g: G('final'), x: X(), signedIn: false, signinHref: '/signin', tz: 'America/New_York', now: NOW }));
  assert.match(card, /href="\/ucl\/match\/club-brugge-kv-vs-aston-villa-2026-09-08"/);
  assert.doesNotMatch(card, /\/ucl\/game\//);
});

test('NO COLOURS NEEDED: both clubs draw the monogram disc', () => {
  const h = face(G('final'), X());
  assert.equal([...h.matchAll(/data-teammark="abbr"/g)].length, 2);
  assert.match(h, />CLU<\/span>/);
});

test('THE PRE-MATCH UCL FOOT is the round, never a pick or a line', () => {
  const md = face(G('scheduled', { homeScore: null, awayScore: null, week: 2 }), X({ soccer: null }));
  assert.match(md, /<div class="sv4-foot" data-pre="ucl"><span>Matchday 2<\/span><\/div>/);
  assert.doesNotMatch(md, /Sign in to pick|No line yet|Pick/);
  const qf = face(G('scheduled', { homeScore: null, awayScore: null, week: null, stage: 'qf' }), X({ soccer: null }), { signedIn: true });
  assert.match(qf, /data-pre="ucl"><span>Quarter-final<\/span>/);
});

test('THE LIVE UCL CARD: the minute', () => {
  assert.match(face(G('live', { liveState: { period: '2H', elapsed: 62 } }), X()), /<i class="dot"><\/i>62&#x27;/);
});

test('THE UCL MATCH PAGE: its crumb, its scores chip, its table', () => {
  const view = {
    state: 'final', g: G('final'), x: X(), modules: ['card', 'moments'],
    moments: momentList(MOMENTS, { homeAbbr: 'CLU', awayAbbr: 'AST' }), compare: [], players: { home: [], away: [] },
    crumb: 'UCL · Matchday 1 · Tue',
  };
  const h = render(React.createElement(EplPageArcade, { view, now: NOW }));
  assert.match(h, /data-league="ucl"/);
  assert.match(h, /href="\/scores\?sport=ucl"/);
  assert.match(h, /href="\/ucl\/standings"/);
  assert.doesNotMatch(h, /\/epl\//);
  assert.match(h, /UCL · Matchday 1 · Tue/);
});

const ROW = (rank, team, o = {}) => ({ rank, teamId: rank, team, played: 1, win: 1, draw: 0, lose: 0, goalsDiff: 1, points: 3, form: 'W', note: null, ...o });

test('THE LEAGUE-PHASE TABLE: 36 rows, banded 1-8 / 9-24 / 25-36, a hairline where each band starts, the key', () => {
  const rows = Array.from({ length: 36 }, (_, i) => ROW(i + 1, `Club ${i + 1}`));
  const b = bandedRows(rows);
  assert.deepEqual(b.filter((r) => r.bandStart).map((r) => r.rank), [9, 25]);
  assert.equal(b.filter((r) => r.band === 'r16').length, 8);
  assert.equal(b.filter((r) => r.band === 'playoff').length, 16);
  assert.equal(b.filter((r) => r.band === 'out').length, 12);
  const h = render(React.createElement(UclTableArcade, { table: { rows } }));
  assert.equal([...h.matchAll(/<tr data-band="/g)].length, 36);
  assert.match(h, /<tr data-band="playoff" data-band-start="1"><td class="ept-rk">9<\/td>/);
  assert.match(h, /<tr data-band="out" data-band-start="1"><td class="ept-rk">25<\/td>/);
  assert.deepEqual([...h.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]), ['#', 'Club', 'P', 'W', 'D', 'L', 'GD', 'Pts', 'Form']);
  assert.match(h, /1-8 Round of 16/); assert.match(h, /9-24 Knockout play-off/); assert.match(h, /25-36 Eliminated/);
  assert.match(h, /After Matchday 1/);
  assert.match(h, /href="\/scores\?sport=ucl"/);
  assert.match(h, /class="ept ucl-t"/);
  assert.match(render(React.createElement(UclTableArcade, { table: null })), /The table lands with the first sync\./);
});

test('THE UCL CSS is scoped to .ucl-t and tokens only', () => {
  const css = readFileSync(new URL('./uclArcade.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgb\(/, 'tokens only');
  for (const rule of css.split('}').map((s) => s.trim()).filter(Boolean)) {
    assert.match(rule.split('{')[0], /^\.ucl-t /, `scoped: ${rule.split('{')[0]}`);
  }
});

// NO NAV ENTRY (fri-4): the two tables link each other, one line each, on both themes.
test('THE TABLES LINK EACH OTHER: /epl/standings <-> /ucl/standings, arcade and dark', async () => {
  const EplTableArcade = (await import('./EplTableArcade.js')).default;
  const t = { rows: [ROW(1, 'A')] };
  assert.match(render(React.createElement(EplTableArcade, { table: t })), /<p class="ept-key" data-cross="ucl"><a href="\/ucl\/standings">Champions League table/);
  assert.match(render(React.createElement(UclTableArcade, { table: t })), /<p class="ept-key" data-cross="epl"><a href="\/epl\/standings">Premier League table/);
  const src = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
  assert.match(src('app/epl/standings/page.js'), /data-cross="ucl"><Link className="lnk" href="\/ucl\/standings">/);
  assert.match(src('app/ucl/standings/page.js'), /data-cross="epl"><Link className="lnk" href="\/epl\/standings">/);
  assert.doesNotMatch(src('lib/nav.js'), /ucl/i, 'no primary-nav entry');
});
