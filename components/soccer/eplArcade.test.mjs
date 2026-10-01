// components/soccer/eplArcade.test.mjs - EPL under arcade (thu-24): the card
// face's soccer lines, the match page's modules, the table. Rendered.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../lib/testing/stubDir.mjs';
import { eplModules, topPlayers, eplState } from '../../lib/soccer/eplPageArcade.js';
import { momentsFromEvents, momentList } from '../../lib/soccer/moments.js';
install();

const LINK = stubPath('__link_stub_epl.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/link') return { url: pathToFileURL(LINK).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, render, CardFace, Card, EplPageArcade, EplTableArcade;
before(async () => {
  writeFileSync(LINK, "import React from 'react'; export default function Link({ href, children, ...rest }) { return React.createElement('a', { ...rest, href: String(href) }, children); }\n");
  React = await import('react');
  render = (await import('react-dom/server')).renderToStaticMarkup;
  ({ CardFace, Card } = await import('../scores/ScoreboardV4.js'));
  EplPageArcade = (await import('./EplPageArcade.js')).default;
  EplTableArcade = (await import('./EplTableArcade.js')).default;
});
after(() => { try { unlinkSync(LINK); } catch { /* gone */ } });

const NOW = new Date('2026-09-20T16:00:00Z');
const team = (id, ab, name) => ({ id, abbreviation: ab, name, shortName: name, colors: null });
const ev = (minute, event_type, detail, team_side, player_name, o = {}) => ({ minute, minute_extra: null, event_type, detail, team_side, player_name, assist_name: null, is_current: true, ...o });
const MOMENTS = momentsFromEvents([
  ev(11, 'Goal', 'Normal Goal', 'home', 'T. Barry', { assist_name: 'J. Tarkowski' }),
  ev(67, 'Card', 'Yellow Card', 'away', 'Abdul Fatawu Issahaku'), ev(67, 'Card', 'Red Card', 'away', 'Abdul Fatawu Issahaku'),
]);
const G = (status, o = {}) => ({ id: 1, slug: 'everton-vs-ipswich-2026-09-20', leagueSlug: 'epl', status, kickoffAt: '2026-09-20T14:00:00Z', homeScore: 1, awayScore: 0,
  home: team(593, 'EVE', 'Everton'), away: team(600, 'IPS', 'Ipswich'), network: null, liveState: null, etWeekday: 'Sun', ...o });
const X = (o = {}) => ({ rank: { home: null, away: null }, record: { home: '9th', away: '17th' }, spreadHome: null, total: null, openHome: null, preview: null, drive: null, diamond: null, stat: { scorers: [{ name: 'Barry', goals: 1 }] }, hasStats: false, mlbFoot: null, probables: null, prob: null, stake: null, open: false, soccer: MOMENTS, ...o });
const face = (g, x, onPage = false) => render(React.createElement(CardFace, { g, x, signedIn: false, signinHref: '/signin', tz: 'America/New_York', now: NOW, onPage }));

test('THE FINAL CARD: FT, the score, Barry 11\' under Everton, Issahaku\'s red under Ipswich; the foot names no moment and links the match', () => {
  const h = face(G('final'), X());
  assert.match(h, /<span class="fin">FT · Sun<\/span>/);
  assert.match(h, /<ul class="side" data-side="home"[^>]*><li class="goal" aria-label="Goal, Barry, 11&#x27;"><i class="gl" aria-hidden="true"><\/i><span>Barry 11&#x27;<\/span><\/li><\/ul>/);
  assert.match(h, /data-side="away"[^>]*><li class="red" aria-label="Red card, Issahaku, 67&#x27;"><i class="rc"/);
  assert.ok(h.indexOf('data-side="home"') < h.indexOf('data-side="away"', h.indexOf('sv4-soc')), 'home first, as the rows are');
  assert.match(h, /<span class="moment"><\/span>/, 'the scorers are on the face, so the foot carries none');
  assert.match(render(React.createElement(Card, { g: G('final'), x: X(), signedIn: false, signinHref: '/signin', tz: 'America/New_York', now: NOW })), /href="\/epl\/match\/everton-vs-ipswich-2026-09-20"[^>]*>Match →|href="\/epl\/match\/everton-vs-ipswich-2026-09-20"/);
});

test('THE LIVE CARD: the minute, then HT; the lines are drawn live too', () => {
  const live = face(G('live', { liveState: { period: '2H', elapsed: 71 } }), X());
  assert.match(live, /<i class="dot"><\/i>71&#x27;/);
  assert.match(live, /data-soccer="1"/);
  assert.match(face(G('live', { liveState: { period: 'HT', elapsed: 45 } }), X()), /<i class="dot"><\/i>HT/);
  assert.match(face(G('live', { liveState: { period: '2H', elapsed: 90, extra: 4 } }), X()), /90&#x27;\+4|90\+4/);
});

test('NOTHING SOCCER on a scheduled EPL card, or on any card without x.soccer', () => {
  assert.doesNotMatch(face(G('scheduled', { homeScore: null, awayScore: null }), X()), /sv4-soc/);
  assert.doesNotMatch(face(G('final'), X({ soccer: null })), /sv4-soc/);
  assert.doesNotMatch(face(G('final', { leagueSlug: 'nfl' }), X({ soccer: MOMENTS })), /sv4-soc|>FT ·/, 'only EPL draws them, whatever x carries');
});

test('THE MATCH PAGE: modules per state, empty ones dropped; top players three a side', () => {
  assert.equal(eplState('final'), 'final'); assert.equal(eplState('scheduled'), 'pre');
  assert.deepEqual(eplModules({ state: 'pre', hasMoments: true }), ['card']);
  assert.deepEqual(eplModules({ state: 'live', hasMoments: true, hasStats: true, hasPlayers: true }), ['card', 'moments', 'stats']);
  assert.deepEqual(eplModules({ state: 'final', hasMoments: false, hasStats: true, hasPlayers: true }), ['card', 'stats', 'players']);
  const rows = [
    { team_id: 1, full_name: 'T. Barry', minutes_played: 90, goals: 1, assists: 0, match_rating: '7.9' },
    { team_id: 1, full_name: 'J. Tarkowski', minutes_played: 90, goals: 0, assists: 1, match_rating: '7.9' },
    { team_id: 1, full_name: 'Bench', minutes_played: 0, match_rating: '9.9' },
    { team_id: 2, full_name: 'C. Walton', minutes_played: 90, goals: 0, assists: 0, saves: 5, match_rating: '7.4' },
  ];
  assert.deepEqual(topPlayers(rows, { homeId: 1, awayId: 2 }), {
    home: [{ name: 'Barry', line: "7.9 · 1 G · 90'" }, { name: 'Tarkowski', line: "7.9 · 1 A · 90'" }],
    away: [{ name: 'Walton', line: "7.4 · 5 saves · 90'" }],
  });
  const view = {
    state: 'final', g: G('final'), x: X(), modules: ['card', 'moments', 'stats', 'players'],
    moments: momentList(MOMENTS, { homeAbbr: 'EVE', awayAbbr: 'IPS' }),
    compare: [{ key: 'Ball Possession', label: 'Possession', home: '58%', away: '42%' }],
    players: topPlayers(rows, { homeId: 1, awayId: 2 }), crumb: 'EPL · Matchweek 5 · Sun',
  };
  const h = render(React.createElement(EplPageArcade, { view, now: NOW }));
  assert.deepEqual([...h.matchAll(/data-mod="(\w+)"/g)].map((m) => m[1]), ['card', 'moments', 'stats', 'players']);
  assert.match(h, /<span class="sc">EVE 1 - IPS 0<\/span>/);
  assert.match(h, /<i class="epl-rc" aria-hidden="true"><\/i>Issahaku - Red card/);
  assert.match(h, /<td>58%<\/td><th scope="row">Possession<\/th><td>42%<\/td>/);
  assert.match(h, /<b>Barry<\/b><span>7\.9 · 1 G · 90&#x27;<\/span>/);
  assert.match(h, /EPL · Matchweek 5 · Sun/);
});

test('THE TABLE: #, club, P, W, D, L, GD, Pts, form; GD signed; the rails; the empty state', () => {
  const table = { rows: [
    { rank: 1, teamId: 50, team: 'Manchester City', played: 5, win: 5, draw: 0, lose: 0, goalsDiff: 11, points: 15, form: 'WWWWW', note: 'Promotion - Champions League (League phase: )' },
    { rank: 20, teamId: 57, team: 'Ipswich', played: 5, win: 0, draw: 1, lose: 4, goalsDiff: -7, points: 1, form: 'LLDLL', note: 'Relegation - Championship' },
  ] };
  const h = render(React.createElement(EplTableArcade, { table }));
  assert.deepEqual([...h.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]), ['#', 'Club', 'P', 'W', 'D', 'L', 'GD', 'Pts', 'Form']);
  assert.match(h, /<tr data-rail="ucl"><td class="ept-rk">1<\/td><th scope="row" class="ept-club">Manchester City<\/th><td>5<\/td><td>5<\/td><td>0<\/td><td>0<\/td><td class="ept-gd">\+11<\/td><td class="ept-pts">15<\/td>/);
  assert.match(h, /<tr data-rail="drop">.*<td class="ept-gd">-7<\/td>/);
  assert.match(h, /aria-label="Last five: L L D L L"/);
  assert.match(h, /Matchweek 5/);
  assert.match(render(React.createElement(EplTableArcade, { table: null })), /The table lands with the first sync\./);
});

test('THE PAGES BRANCH ON THE FLAG, and the dark pages stay below the branch', () => {
  const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  for (const [p, comp] of [['app/epl/standings/page.js', 'EplTableArcade'], ['app/epl/match/[slug]/page.js', 'EplPageArcade']]) {
    const s = src(p);
    assert.match(s, /if \(arcadeFor\(isShell\)\) \{/, p);
    assert.ok(s.indexOf(`<${comp}`) > s.indexOf('if (arcadeFor(isShell))'), `${p} draws ${comp} in the branch`);
  }
  const css = src('components/soccer/eplArcade.css');
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-fA-F]{3,8}\b|rgb\(/, 'tokens only');
});
