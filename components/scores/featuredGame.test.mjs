// components/scores/featuredGame.test.mjs - the landscape featured card, mounted (scores-landscape).
// The pick: first of "in your games" when signed in (label from its via), else the
// first live game, else nothing. The middle is the sport's own read: win
// probability for NFL/CFB, the last play for NBA (never a win probability).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { install } from '../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../lib/testing/stubDir.mjs';
install();

const LINK = stubPath('__link_stub_feat.mjs');
const NAV = stubPath('__nav_stub_feat.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/link') return { url: pathToFileURL(LINK).href, shortCircuit: true };
  if (spec === 'next/navigation') return { url: pathToFileURL(NAV).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, renderToStaticMarkup, FeaturedGame, pickFeatured, viaLabel, VIA_LABEL, stakeLines;
before(async () => {
  writeFileSync(LINK, "import React from 'react'; export default function Link({ href, children, ...rest }) { return React.createElement('a', { ...rest, href: String(href) }, children); }\n");
  writeFileSync(NAV, "export function useRouter() { return { refresh() {}, push() {} }; }\n");
  React = await import('react');
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  ({ default: FeaturedGame, stakeLines } = await import('./FeaturedGame.js'));
  ({ pickFeatured, viaLabel, VIA_LABEL } = await import('../../lib/scores/featured.js'));
});
after(() => { for (const f of [LINK, NAV]) { try { unlinkSync(f); } catch { /* gone */ } } });

const NOW = new Date('2026-10-30T02:40:00Z');
const iso = (min) => new Date(NOW.getTime() + min * 60000).toISOString();
const team = (id, ab, name) => ({ id, abbreviation: ab, name, shortName: name, colors: { primary: '#111111', secondary: '#EEEEEE' } });
const game = (id, league, status, kick, home, away, hs, as, extra = {}) => ({ id, slug: `g-${id}`, leagueSlug: league, status, kickoffAt: iso(kick), homeScore: hs, awayScore: as, home, away, network: null, liveState: null, etWeekday: 'Fri', ...extra });
const X = (o = {}) => ({ rank: { home: null, away: null }, record: { home: '2-2', away: '3-1' }, spreadHome: null, total: null, openHome: null, preview: null, drive: null, diamond: null, nba: null, stake: null, open: false, ...o });
const wp = { period: 4, clock: '6:42', win_prob: 36, win_prob_at: new Date(NOW.getTime() - 20000).toISOString() };

const nfl = game(10, 'nfl', 'live', -150, team(1, 'CHI', 'Bears'), team(2, 'PHI', 'Eagles'), 17, 20, { liveState: wp });
const nba = game(11, 'nba', 'live', -100, team(3, 'LAL', 'Lakers'), team(4, 'GSW', 'Warriors'), 109, 104, {
  liveState: { period: 4, clock: '3:12', win_prob: 69, win_prob_at: wp.win_prob_at },
  nbaDetail: { last_play: { text: 'Curry pull-up three', type: 'jump shot' } },
});
const nbaUp = game(12, 'nba', 'scheduled', 120, team(5, 'PHX', 'Suns'), team(6, 'POR', 'Trail Blazers'), null, null);

const weekly4 = ['Jalen Hurts', 'A.J. Brown', 'DeVonta Smith', 'Dallas Goedert'].map((name, i) => ({ name, pos: 'WR', points: 10 + i }));
const stakeWeekly = { pick: null, weekly: weekly4, alerts: false, follow: null };
const stakePick = { pick: { side: 'home', abbr: 'PHX', state: 'pending' }, weekly: [], alerts: false, follow: null };

const render = (pick, o = {}) => {
  const html = renderToStaticMarkup(React.createElement(FeaturedGame, { pick, signedIn: true, signinHref: '/signin', tz: 'America/Los_Angeles', now: NOW, ...o }));
  return { html, d: new JSDOM(`<!doctype html><body>${html}</body>`).window.document };
};

test('SIGNED IN: the first stake game wins, live before upcoming, labelled by its stake (weekly)', () => {
  const games = [nbaUp, nfl, nba];
  const extras = new Map([[10, X({ stake: stakeWeekly })], [12, X({ stake: stakePick })], [11, X()]]);
  const pick = pickFeatured({ games, extras, signedIn: true, now: NOW });
  assert.equal(pick.g.id, 10, 'the live stake game leads the scheduled one');
  assert.equal(pick.label, 'IN YOUR WEEKLY');
});

test('SIGNED IN, a pick only: label YOUR PICK', () => {
  const extras = new Map([[12, X({ stake: stakePick })]]);
  const pick = pickFeatured({ games: [nbaUp], extras, signedIn: true, now: NOW });
  assert.equal(pick.label, 'YOUR PICK');
  assert.equal(pick.g.id, 12);
});

test('every via maps to its label; lineups handed in label draft and series games', () => {
  assert.equal(VIA_LABEL.weekly, 'IN YOUR WEEKLY');
  assert.equal(VIA_LABEL.draft, 'IN YOUR DRAFT');
  assert.equal(VIA_LABEL.pickem, 'YOUR PICK');
  for (const k of ['series', 'october', 'run', 'six']) assert.equal(VIA_LABEL[k], 'IN YOUR GAMES', k);
  assert.equal(viaLabel(['pickem', 'weekly']), 'IN YOUR WEEKLY', 'the most specific stake names the card');
  assert.equal(viaLabel(['pickem', 'draft']), 'IN YOUR DRAFT');
  const draft = [{ team: 'PHI', name: 'Jalen Hurts', points: 12 }];
  const pick = pickFeatured({ games: [nfl], extras: new Map([[10, X()]]), signedIn: true, now: NOW, lineups: { draft } });
  assert.equal(pick.label, 'IN YOUR DRAFT');
});

test('NO STAKE (or signed out): the first live game; no live game: nothing renders', () => {
  const extras = new Map([[10, X()], [11, X()], [12, X()]]);
  const out = pickFeatured({ games: [nbaUp, nfl, nba], extras, signedIn: false, now: NOW });
  assert.equal(out.g.id, 10);
  const signedInNoStake = pickFeatured({ games: [nbaUp, nfl, nba], extras, signedIn: true, now: NOW });
  assert.equal(signedInNoStake.g.id, 10, 'signed in with no stake falls to the first live game');
  assert.equal(pickFeatured({ games: [nbaUp], extras, signedIn: true, now: NOW }), null);
  assert.equal(render(null).html, '', 'no pick, no markup');
});

test('NFL: win-probability bar and the down-and-distance line; stake capped at 3 lines then +N', () => {
  const x = X({ stake: stakeWeekly, drive: { label: '3rd & 2', spot: 'CHI 30', offenseAbbr: 'PHI', pct: 70, togo: 2, lastPlay: 'rush' } });
  const { d } = render({ g: nfl, x, label: 'IN YOUR WEEKLY', via: ['weekly'] });
  assert.ok(d.querySelector('[data-winprob-bar]'), 'win prob bar for NFL');
  assert.match(d.querySelector('[data-winprob-bar]').textContent, /PHI 64%/);
  assert.match(d.querySelector('[data-winprob-bar]').textContent, /CHI 36%/);
  assert.match(d.querySelector('[data-sit]').textContent, /3rd & 2/);
  assert.equal(d.querySelectorAll('.f-stake .row').length, 3);
  assert.equal(d.querySelector('[data-more]').textContent, '+1');
  assert.equal(d.querySelector('[data-featured-label]').textContent, 'IN YOUR WEEKLY');
});

test('NBA: the last play, and NO win probability', () => {
  const { d, html } = render({ g: nba, x: X({ nba: { bonus: null, timeouts: null, perf: null, finalPeriod: null } }), label: 'LIVE NOW', via: [] });
  assert.equal(d.querySelector('[data-last-play]').textContent, 'Curry pull-up three');
  assert.equal(d.querySelector('[data-winprob-bar]'), null, 'the NBA has no win probability on this card');
  assert.doesNotMatch(html, /win prob/i);
});

test('MLB: the diamond situation from the row', () => {
  const mlb = game(13, 'mlb', 'live', -90, team(7, 'NYY', 'Yankees'), team(8, 'BOS', 'Red Sox'), 3, 2, { liveState: { period: 7, half: 'top' } });
  const x = X({ diamond: { lead: 'Top 7th', sub: '1 out', bases: { first: true, second: false, third: true }, count: '2-1', lastPlay: 'Devers singles to right.' } });
  const { d } = render({ g: mlb, x, label: 'LIVE NOW', via: [] });
  assert.match(d.querySelector('[data-baseball]').textContent, /Top 7th/);
  assert.equal(d.querySelector('[data-winprob-bar]'), null);
});

test('stake lines: the pick first, then Weekly players; before kickoff a player shows his position', () => {
  const lines = stakeLines({ pick: { side: 'home', abbr: 'PHX', state: 'won' }, weekly: [{ name: 'Jalen Hurts', pos: 'QB', points: 0 }] }, { status: 'scheduled' });
  assert.deepEqual(lines.map((l) => [l.left, l.right]), [["Pick'em", 'PHX ✓'], ['Hurts', 'QB']]);
});

test('HYPHENS ONLY: no en or em dash in anything the card prints', () => {
  const x = X({ stake: stakeWeekly, drive: { label: '3rd & 2', spot: 'CHI 30', offenseAbbr: 'PHI', pct: 70, togo: 2 } });
  for (const p of [{ g: nfl, x, label: 'IN YOUR WEEKLY', via: ['weekly'] }, { g: nba, x: X(), label: 'LIVE NOW', via: [] }]) {
    assert.doesNotMatch(render(p).d.body.textContent, /[–—]/);
  }
});
