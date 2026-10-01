// components/scores/nbaCard.test.mjs - the NBA card on the SHARED CardFace and
// the NBA game page on the shared arcade page component, rendered (nba-card, thu-37).
//
// /scores: the live navy card with the clock, the BONUS tag and the one-line
// top scorers; the upcoming white card with the tip in the page zone and no
// "No line yet"; the final with W and FINAL · OT; the Pick'em strip.
// The game page: the card with the line, the last play and the timeouts; the
// chips Plays | Box | Leaders; the final's leaders, team stats and full box.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { install } from '../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../lib/testing/stubDir.mjs';
install();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const src = (rel) => strip(readFileSync(path.join(REPO, rel), 'utf8'));

const LINK = stubPath('__link_stub_nba.mjs');
const NAV = stubPath('__nav_stub_nba.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/link') return { url: pathToFileURL(LINK).href, shortCircuit: true };
  if (spec === 'next/navigation') return { url: pathToFileURL(NAV).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, render, ScoreboardV4, GamePageArcade, C;
before(async () => {
  writeFileSync(LINK, "import React from 'react'; export default function Link({ href, children, ...rest }) { return React.createElement('a', { ...rest, href: String(href) }, children); }\n");
  writeFileSync(NAV, "export function useRouter() { return { refresh() {}, push() {} }; }\n");
  React = await import('react');
  render = (await import('react-dom/server')).renderToStaticMarkup;
  ScoreboardV4 = (await import('./ScoreboardV4.js')).default;
  GamePageArcade = (await import('../gridiron/GamePageArcade.js')).default;
  C = await import('../../lib/nba/card.js');
});
after(() => { for (const f of [LINK, NAV]) { try { unlinkSync(f); } catch { /* gone */ } } });

const NOW = new Date('2026-10-20T23:40:00Z');
const T = (id, ab, nm) => ({ id, abbreviation: ab, name: nm, shortName: nm, colors: { primary: '#111111', secondary: '#EEEEEE' } });
const BOS = T(1, 'BOS', 'Celtics'), DET = T(2, 'DET', 'Pistons'), PHI = T(3, 'PHI', '76ers'), NYK = T(4, 'NYK', 'Knicks');
const G = (id, status, home, away, hs, as, extra = {}) => ({ id, slug: `nba-${id}`, leagueSlug: 'nba', status, kickoffAt: '2026-10-20T23:00:00Z', homeScore: hs, awayScore: as, home, away, network: null, liveState: null, etWeekday: 'Tue', ...extra });
const X = (o = {}) => ({ rank: { home: null, away: null }, record: { home: null, away: null }, spreadHome: null, total: null, openHome: null, preview: null, drive: null, diamond: null, stat: null, hasStats: false, mlbFoot: null, probables: null, prob: null, stake: null, open: false, nba: null, ...o });
const LS4 = { line_score: [{ period: 1, home: 22, away: 28 }, { period: 2, home: 31, away: 24 }, { period: 3, home: 26, away: 27 }, { period: 4, home: 22, away: 25 }] };
const LS5 = { line_score: [...LS4.line_score, { period: 5, home: 10, away: 14 }] };

function board({ strip = null } = {}) {
  const live = G(11, 'live', DET, BOS, 101, 104, { liveState: { period: 4, clock: '2:14' } });
  const up = G(12, 'scheduled', NYK, PHI, null, null, { kickoffAt: '2026-10-21T02:00:00Z' });
  const fin = G(13, 'final', DET, BOS, 114, 118);
  const extras = new Map([
    [11, X({ nba: { ...C.nbaCardExtras('live', { bonus: { home: false, away: true }, timeouts: { home: 1, away: 2 } }), perf: 'Tatum 31 pts · Cunningham 28' }, line: C.nbaLine(live, LS4) })],
    [12, X({ open: true, nba: { bonus: null, timeouts: null, finalPeriod: null, perf: null } })],
    [13, X({ hasStats: true, nba: { ...C.nbaCardExtras('final', LS5), perf: 'Tatum 38 pts · 11 reb' }, line: C.nbaLine(fin, LS5) })],
  ]);
  return {
    today: '2026-10-20', date: '2026-10-20', tz: 'America/Los_Angeles', sport: 'nba', mine: false, top25: false, rankedToday: false, liveCount: 1, mineCount: 0,
    leagues: ['nba'],
    days: [{ date: '2026-10-20', dow: 'Tue', day: 20, counts: { live: 1, final: 1, scheduled: 1, epl: 0 }, on: true }],
    liveAway: null,
    groups: [
      { key: 'live', title: 'Live now', sub: 'updates every 30s', games: [live] },
      { key: 'day', title: 'Today', sub: '1 game', games: [up] },
      { key: 'final', title: 'Final', sub: 'Tue', games: [fin] },
    ],
    extras, nbaPickem: strip,
  };
}
const doc = (h) => new JSDOM(`<!doctype html><body>${h}</body>`).window.document;
const boardDoc = (o) => doc(render(React.createElement(ScoreboardV4, { v: board(o), signedIn: true, zoneLabel: 'Pacific', now: NOW })));
const card = (d, slug) => d.querySelector(`article[data-slug="${slug}"]`);

test('LIVE (board): navy card, "Q4 · 2:14", BONUS on the side in it, the one-line top scorers; no ball, no odds, no win read', () => {
  const c = card(boardDoc(), 'nba-11');
  assert.equal(c.getAttribute('data-variant'), 'live');
  assert.equal(c.querySelector('.sv4-lbl .clock').textContent, 'Q4 · 2:14');
  assert.equal(c.querySelector('.sv4-lbl .where').textContent, 'NBA');
  const bonus = [...c.querySelectorAll('.bonus')];
  assert.equal(bonus.length, 1);
  assert.equal(bonus[0].getAttribute('data-bonus'), 'away');
  assert.equal(bonus[0].closest('.sv4-team').getAttribute('data-side'), 'away');
  assert.equal(c.querySelector('[data-perf]').textContent, 'Tatum 31 pts · Cunningham 28');
  assert.equal(c.querySelector('[data-timeouts]'), null, 'the timeouts are the game page\'s, not the board\'s');
  assert.equal(c.querySelector('.ball'), null, 'no possession: the feed has none');
  assert.equal(c.querySelector('[data-winprob]'), null);
});

test('UPCOMING (board): white card, the tip in the PAGE zone, and NO "No line yet" when there is no line', () => {
  const c = card(boardDoc(), 'nba-12');
  assert.equal(c.getAttribute('data-variant'), 'upcoming');
  assert.equal(c.querySelector('.sv4-lbl .ko').textContent, '7:00 PM PDT', 'serverTz = the page zone, as the header says Pacific');
  assert.ok(!/No line yet/.test(c.textContent));
  assert.equal(c.querySelector('.sv4-foot'), null, 'no line, no foot');
  assert.equal(c.querySelector('.sv4-stake'), null, 'the strip, not a card chip, is where a pick is made');
});

test('UPCOMING with a line: the line, as football writes it', () => {
  const v = board();
  v.extras.get(12).spreadHome = -4.5; v.extras.get(12).total = 224.5;
  const d = doc(render(React.createElement(ScoreboardV4, { v, signedIn: true, zoneLabel: 'Pacific', now: NOW })));
  assert.equal(card(d, 'nba-12').querySelector('[data-pre="nba"]').textContent, 'NYK -4.5 · 224.5');
});

test('FINAL (board): "Final · OT", W on the winner, the top scorer in the foot, the box link', () => {
  const c = card(boardDoc(), 'nba-13');
  assert.equal(c.querySelector('.sv4-lbl .fin').textContent, 'Final · OT');
  const w = [...c.querySelectorAll('.w')];
  assert.equal(w.length, 1);
  assert.equal(w[0].closest('.sv4-team').getAttribute('data-side'), 'away');
  assert.equal(c.querySelector('.sv4-foot .moment').textContent, 'Tatum 38 pts · 11 reb');
  assert.ok(/Box score/.test(c.querySelector('.sv4-foot .go').textContent));
  assert.equal(c.querySelector('.bonus'), null, 'no bonus on a final');
});

test('THE PICK\'EM STRIP: "1 of 3 picked · next lock <page-zone time>", one link to /pickem/nba; absent without a board', () => {
  const d = boardDoc({ strip: { href: '/pickem/nba', kicker: "Pick'em · Tonight", line: '1 of 3 picked', nextLock: '2026-10-21T02:00:00Z', cta: 'Pick' } });
  const s = d.querySelector('[data-nba-pickem]');
  assert.equal(s.getAttribute('href'), '/pickem/nba');
  assert.equal(s.querySelector('.l').textContent, '1 of 3 picked · next lock 7:00 PM PDT');
  assert.equal(boardDoc().querySelector('[data-nba-pickem]'), null);
});

test('SHARED WIRING: CardFace asks the sport once; scoresV2 reads the NBA extras, the line and the strip', () => {
  const face = src('components/scores/ScoreboardV4.js');
  assert.match(face, /const nba = sportOf\(g\.leagueSlug\) === BASKETBALL \? \(x\.nba \?\? \{\}\) : null;/);
  assert.match(face, /if \(sportOf\(g\.leagueSlug\) === BASKETBALL\) return nbaLiveLabel\(ls\);/);
  assert.match(face, /\(nba\s*\?\s*<span className="fin">\{nbaFinalLabel\(nba\.finalPeriod\)\}<\/span>/);
  assert.match(face, /<NbaPickemStrip s=\{v\.nbaPickem \?\? null\} tz=\{v\.tz\} \/>/);
  const reader = src('lib/gridiron/scoresV2.js');
  assert.match(reader, /nbaDetail: r\.league_slug === 'nba' \? r\.metadata\?\.detail \?\? null : null/);
  assert.match(reader, /lineFor\(g, \{ mlbLine: g\.mlbLine, nbaDetail: g\.nbaDetail \}\)/);
  assert.match(reader, /nbaCardExtras\(g\.status, g\.nbaDetail\)/);
  assert.match(reader, /sport === 'nba' && picked === today\s*\?\s*await nbaPickemStrip/);
  assert.match(src('lib/scores/expandRead.js'), /EXPAND_LEAGUES = Object\.freeze\(\['nfl', 'cfb', 'mlb', 'nba'\]\)/);
});

// ---------------------------------------------------------------------------
// the game page
// ---------------------------------------------------------------------------
function pageView(state) {
  const live = state === 'live';
  const g = G(21, live ? 'live' : 'final', DET, BOS, live ? 101 : 114, live ? 104 : 118, { liveState: live ? { period: 4, clock: '2:14' } : null, slug: 'nba-2026-10-20-bos-det' });
  const box = [
    { team_id: 1, player_name: 'Jayson Tatum', pts: 38, reb: 11, ast: 4, fgm: 13, fga: 24, fg3m: 5, fg3a: 11, ftm: 7, fta: 8, turnovers: 3, seconds: 2520, plus_minus: 6, dnp: false },
    { team_id: 2, player_name: 'Cade Cunningham', pts: 34, reb: 6, ast: 11, fgm: 12, fga: 27, fg3m: 2, fg3a: 8, ftm: 8, fta: 9, turnovers: 6, seconds: 2580, plus_minus: -4, dnp: false },
  ];
  const detail = live ? { ...LS4, bonus: { home: false, away: true }, timeouts: { home: 1, away: 2 }, last_play: { text: 'Jayson Tatum makes 26-foot three point jumper (Jaylen Brown assists)', type: 'Jump Shot' } } : LS5;
  const leaders = C.nbaLeaders(box, { homeId: 2, awayId: 1 });
  const teamBox = C.nbaTeamStats(box, { homeId: 2, awayId: 1 });
  const tables = C.nbaBoxTables(box, g);
  return {
    state, league: 'nba', simulated: false,
    modules: C.nbaModules({ state, hasYours: true, hasLeaders: true, hasTeamStats: true, hasBox: true }),
    g, signinHref: '/signin',
    x: X({ line: C.nbaLine(g, detail), closing: null, lastPlay: live ? C.lastPlayText(detail) : null,
      nba: { ...C.nbaCardExtras(g.status, detail), perf: C.performerLine(box, { status: g.status, homeId: 2, awayId: 1 }) } }),
    odds: null, winprob: null,
    yours: { signedIn: true, rows: [{ kind: 'pickem', label: "PICK'EM", line: live ? 'You have DET' : 'You had DET', value: live ? 'trailing by 3' : 'Lost · 2 of 3 tonight', href: '/pickem/nba' }], open: [], pre: false, playHref: null },
    chips: live ? C.nbaChips({ plays: 412, box: true, leaders: true, market: false }) : [],
    plays: { latest: C.nbaPlayRows([{ playNumber: 9, period: 4, clock: '2:14', playType: 'Jump Shot', text: 'Tatum makes 26-foot three point jumper', homeScore: 101, awayScore: 104, scoring: true, offenseTeamId: 1 }], { abbrOf: (id) => (id === 1 ? 'BOS' : 'DET') }), total: 412, all: false },
    box: tables, leaders, teamBox, market: { closing: null, propsCard: null }, scoring: [],
    boxHref: '/nba/game/nba-2026-10-20-bos-det?box=all#gpa-box', crumb: 'NBA · Tue',
  };
}
const pageDoc = (state) => doc(render(React.createElement(GamePageArcade, { view: pageView(state), now: NOW, tz: 'America/Los_Angeles' })));

test('GAME PAGE LIVE: the card with Q1-Q4, the last play and "TO 2 · 1"; In your games; chips Plays | Box | Leaders; plays with the running score', () => {
  const d = pageDoc('live');
  const c = d.querySelector('article.gpa-card');
  assert.equal(c.querySelector('.clock').textContent, 'Q4 · 2:14');
  assert.deepEqual([...c.querySelectorAll('.sv4-ls thead th')].map((t) => t.textContent), ['', '1', '2', '3', '4', 'T']);
  assert.equal(c.querySelector('.lp').textContent, 'Jayson Tatum makes 26-foot three point jumper (Jaylen Brown assists)');
  assert.equal(c.querySelector('[data-timeouts]').textContent, 'TO 2 · 1');
  assert.equal(c.querySelector('[data-bonus="away"]').textContent, 'Bonus');
  assert.equal(d.querySelector('.gpa-yrow .v').textContent, 'trailing by 3');
  assert.deepEqual([...d.querySelectorAll('.gpa-yrow')].map((r) => r.getAttribute('data-kind')), ['pickem'], "no Tonight's Six row");
  const chips = d.querySelector('[data-mod="chips"]').textContent;
  for (const w of ['Plays', 'Box', 'Leaders']) assert.ok(chips.includes(w), w);
  assert.equal(d.querySelector('.gpa-plays [data-score]').textContent, '104-101');
  assert.equal(d.querySelector('[data-all-plays]').textContent.replace(/\s+/g, ' ').trim(), 'All plays · 412 ›');
  assert.equal(d.querySelector('[data-gpa="winprob"]'), null, 'no win probability');
});

test('GAME PAGE FINAL: W and "Final · OT"; In your games settled; leaders, team stats and the full-box link', () => {
  const d = pageDoc('final');
  const c = d.querySelector('article.gpa-card');
  assert.equal(c.querySelector('.fin').textContent, 'Final · OT');
  assert.deepEqual([...c.querySelectorAll('.sv4-ls thead th')].map((t) => t.textContent), ['', '1', '2', '3', '4', 'OT', 'T']);
  assert.equal(c.querySelector('[data-won]').closest('.sv4-team').getAttribute('data-side'), 'away');
  assert.equal(d.querySelector('.gpa-yrow .v').textContent, 'Lost · 2 of 3 tonight');
  assert.deepEqual([...d.querySelectorAll('.gpa-mod')].map((m) => m.getAttribute('data-mod')), ['card', 'yours', 'leaders', 'teamstats', 'fullbox']);
  assert.deepEqual([...d.querySelectorAll('.gpa-lrow[data-cat]')].map((r) => r.getAttribute('data-cat')), ['PTS', 'REB', 'AST']);
  assert.deepEqual([...d.querySelectorAll('[data-gpa="teamstats"] tbody th')].map((t) => t.textContent), ['FG%', '3PT', 'REB', 'TOV']);
  assert.equal(d.querySelector('[data-gpa="fullbox"]').getAttribute('href'), '/nba/game/nba-2026-10-20-bos-det?box=all#gpa-box');
});

test('THE ROUTE: /nba/game/[slug] draws GamePageArcade from nbaGameView - the shared structure, no second page', () => {
  const r = src('app/nba/game/[slug]/page.js');
  assert.match(r, /import GamePageArcade from '@\/components\/gridiron\/GamePageArcade';/);
  assert.match(r, /const view = await nbaGameView\(/);
  assert.match(r, /<GamePageArcade view=\{view\} tz=\{tz \?\? 'America\/New_York'\} \/>/);
  assert.ok(!/winprob|LiveActivity|liveActivity/.test(r));
});
