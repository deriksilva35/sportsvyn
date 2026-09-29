// components/scores/scoreboardV4.test.mjs - the arcade Scoreboard, rendered (scores-v4).
//
// THE PARITY TEST IS THE POINT OF THIS FILE: every field the dark card
// (ScoresV2) shows, the arcade card shows. It renders both from ONE slate and
// walks the V2 card's own text, atom by atom, so a field added to V2 later and
// forgotten here fails without anybody having to remember to list it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { install } from '../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../lib/testing/stubDir.mjs';
install();

const LINK = stubPath('__link_stub_v4.mjs');
const NAV = stubPath('__nav_stub_v4.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/link') return { url: pathToFileURL(LINK).href, shortCircuit: true };
  if (spec === 'next/navigation') return { url: pathToFileURL(NAV).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, renderToStaticMarkup, ScoresV2, ScoreboardV4;
before(async () => {
  writeFileSync(LINK, "import React from 'react'; export default function Link({ href, children, ...rest }) { return React.createElement('a', { ...rest, href: String(href) }, children); }\n");
  writeFileSync(NAV, "export function useRouter() { return { refresh() {}, push() {} }; }\n");
  React = await import('react');
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  ScoresV2 = (await import('./ScoresV2.js')).default;
  ScoreboardV4 = (await import('./ScoreboardV4.js')).default;
});
after(() => { for (const f of [LINK, NAV]) { try { unlinkSync(f); } catch { /* gone */ } } });

const NOW = new Date('2026-09-12T23:40:00Z');
const team = (id, ab, colors = { primary: '#111111', secondary: '#EEEEEE' }, conference = null) => ({ id, abbreviation: ab, name: ab, shortName: ab, colors, conference });
const game = (id, league, status, kickoffAt, home, away, hs = null, as = null, extra = {}) => ({ id, slug: `g-${id}`, leagueSlug: league, status, kickoffAt, homeScore: hs, awayScore: as, home, away, network: 'FOX', liveState: null, etWeekday: 'Fri', ...extra });
const X = (o = {}) => ({ rank: { home: null, away: null }, record: { home: '1-0', away: '0-1' }, spreadHome: null, total: null, openHome: null, preview: null, drive: null, diamond: null, stat: null, hasStats: false, mlbFoot: null, probables: null, prob: null, stake: null, open: false, ...o });

function fixture({ signedIn = true } = {}) {
  const live = game(3, 'cfb', 'live', '2026-09-12T23:30:00Z', team(5, 'ALA', undefined, 'SEC'), team(6, 'USF', undefined, 'American'), 24, 10, { liveState: { period: 3, clock: '8:41' } });
  const nfl = game(7, 'nfl', 'live', '2026-09-12T23:15:00Z', team(13, 'CHI'), team(14, 'PHI'), 17, 20, { liveState: { period: 4, clock: '6:42', win_prob: 36, win_prob_at: '2026-09-12T23:39:30Z' }, network: 'ABC' });
  const mlb = game(8, 'mlb', 'live', '2026-09-12T23:05:00Z', team(15, 'NYY'), team(16, 'BOS'), 3, 2, { liveState: { period: 7, half: 'top' }, network: 'MLBN' });
  const mlbUp = game(9, 'mlb', 'scheduled', '2026-09-13T17:05:00Z', team(17, 'LAD'), team(18, 'SD'));
  const epl = game(5, 'epl', 'live', '2026-09-12T16:30:00Z', team(9, 'BRE', null), team(10, 'BOU', null), 1, 1, { liveState: { period: '2H', elapsed: 71 } });
  const up = game(6, 'nfl', 'scheduled', '2026-09-13T17:00:00Z', team(11, 'TEN'), team(12, 'DEN'));
  const fin = game(2, 'cfb', 'final', '2026-09-11T23:00:00Z', team(3, 'NCSU', undefined, 'ACC'), team(4, 'RICH'), 38, 3);
  const stake = (o) => (signedIn ? o : null);
  const extras = new Map([
    [3, X({ rank: { home: 4, away: null }, drive: { label: '2nd & 6', spot: 'ALA 41', offenseAbbr: 'ALA', pct: 41, togo: 6, lastPlay: 'J. Milroe pass short right to G. Bernard for 9 yards.' }, spreadHome: -14.5, total: 55.5, openHome: -13, stake: stake({ pick: { side: 'home', abbr: 'ALA', state: 'winning' }, weekly: [{ name: 'Jalen Milroe', pos: 'QB', points: 18.4 }], alerts: true }) })],
    [7, X({ spreadHome: 1.5, total: 44.5, openHome: 2.5, drive: { label: '3rd & 2', spot: 'CHI 30', offenseAbbr: 'PHI', pct: 70, togo: 2, lastPlay: 'J. Hurts rush up the middle for 4 yards.' } })],
    [8, X({ diamond: { lead: 'Top 7th', sub: '1 out', bases: { first: true, second: false, third: true }, count: '2-1', lastPlay: 'Devers singles to right.' } })],
    [9, X({ probables: 'Yamamoto vs Darvish', spreadHome: -1.5, total: 8.5, preview: '/article/sd-lad' })],
    [5, X({ prob: { home: 54, draw: 24, away: 22 } })],
    [6, X({ open: true, spreadHome: -5.5, total: 43.5, openHome: -4, preview: '/article/den-ten', stake: stake({ pick: { side: 'away', abbr: 'DEN', state: 'pending' }, weekly: [{ name: 'Bo Nix', pos: 'QB', points: 0 }, { name: 'Courtland Sutton', pos: 'WR', points: 0 }], alerts: true }) })],
    [2, X({ stat: { name: 'CJ Bailey', passCmp: 13, passAtt: 17, passYds: 281, passTd: 1 }, hasStats: true, stake: stake({ pick: { side: 'home', abbr: 'NCSU', state: 'won' }, weekly: [], alerts: false }) })],
  ]);
  return {
    today: '2026-09-12', date: '2026-09-12', tz: 'America/Los_Angeles', sport: 'all', mine: false, top25: false, rankedToday: true, liveCount: 4, mineCount: signedIn ? 3 : 0,
    days: [
      { date: '2026-09-11', dow: 'Fri', day: 11, counts: { live: 0, final: 1, scheduled: 0, epl: 0 }, on: false },
      { date: '2026-09-12', dow: 'Sat', day: 12, counts: { live: 4, final: 0, scheduled: 0, epl: 1 }, on: true },
      { date: '2026-09-13', dow: 'Sun', day: 13, counts: { live: 0, final: 0, scheduled: 2, epl: 0 }, on: false },
    ],
    liveAway: null,
    groups: [
      { key: 'live', title: 'Live now', sub: 'updates every 30s', games: [live, nfl, mlb, epl] },
      { key: 'day', title: 'Tomorrow · Sunday', sub: '2 games · your picks lock at kick', subTail: ' · your picks lock at kick', games: [up, mlbUp] },
      { key: 'final', title: 'Final', sub: 'Fri', games: [fin] },
    ],
    extras,
  };
}

const v2html = (v, signedIn) => renderToStaticMarkup(React.createElement(ScoresV2, { v, signedIn, zoneLabel: 'Pacific', arcade: true }));
const v4html = (v, signedIn, o = {}) => renderToStaticMarkup(React.createElement(ScoreboardV4, { v, signedIn, zoneLabel: 'Pacific', now: NOW, ...o }));
const doc = (h) => new JSDOM(`<!doctype html><body>${h}</body>`).window.document;

/**
 * THE ATOMS A V2 CARD SHOWS: every text node, split on the house separator
 * " · " and the arrow. Two spellings differ by design and are normalised
 * here, in the open, rather than exempted: V2 prefixes the line with
 * "Spread " (V4's foot is "TEN -5.5 · O/U 43.5 · opened -4"), and V2's
 * "3 live"-style pill words are chrome, not card fields.
 */
function atoms(el) {
  const out = [];
  const walk = (n) => {
    if (n.nodeType === 3) {
      for (const a of n.textContent.split(/ · |→/)) {
        const t = a.replace(/^Spread /, '').trim();
        if (t) out.push(t);
      }
    }
    for (const c of n.childNodes ?? []) walk(c);
  };
  walk(el);
  return out;
}
const flat = (el) => el.textContent.replace(/\s+/g, ' ');

// EPL IS OUTSIDE THE PARITY, declared: it left the arcade chip row (mon-17),
// and its pre-game percentages and bar are the win-prob read ruling (f)
// confines to the NFL.
const PARITY_LEAGUES = ['nfl', 'cfb', 'mlb'];

for (const signedIn of [true, false]) {
  test(`card field parity with ScoresV2 (${signedIn ? 'signed in' : 'signed out'}): every V2 field is on the V4 card`, () => {
    const v = fixture({ signedIn });
    const d2 = doc(v2html(v, signedIn)); const d4 = doc(v4html(v, signedIn));
    const cards2 = [...d2.querySelectorAll('a.sv2-card')].filter((c) => PARITY_LEAGUES.includes(c.dataset.league));
    assert.equal(cards2.length, 6, 'six NFL/CFB/MLB cards on the dark board');
    for (const c2 of cards2) {
      const slug = c2.getAttribute('href').split('/').pop();
      const c4 = d4.querySelector(`article.sv4-card[data-slug="${slug}"]`);
      assert.ok(c4, `${slug}: the arcade board draws the card`);
      assert.equal(c4.dataset.variant, c2.dataset.variant, `${slug}: same variant`);
      const text4 = flat(c4);
      for (const a of atoms(c2)) assert.ok(text4.includes(a), `${slug}: V2 shows "${a}", V4 does not.\nV4: ${text4}`);
    }
  });
}

test('the page-level fields V2 shows are on V4 too: the zone, the live count, the day rail with its counts, Yours · N', () => {
  const v = fixture();
  const d4 = doc(v4html(v, true));
  const t = flat(d4.body);
  assert.match(t, /Saturday · all times Pacific/);
  assert.match(t, /4 live · 4 on the slate/);
  const days = [...d4.querySelectorAll('.sv4-day')].map((a) => [a.dataset.date, a.textContent, a.getAttribute('href')]);
  assert.deepEqual(days, [
    ['2026-09-11', 'Fri111 final', '/scores?date=2026-09-11'],
    ['2026-09-12', 'Sat124 live', '/scores'],
    ['2026-09-13', 'Sun132 games', '/scores?date=2026-09-13'],
  ]);
  assert.equal(d4.querySelector('[data-chip="mine"]').textContent, 'Yours 3');
});

test('chips: All/NFL/CFB/MLB (no EPL), then Live · Yours · Top 25 · Close · Tonight; a zero count hides the chip; selected is .on', () => {
  const v = fixture();
  const d4 = doc(v4html(v, true));
  const chips = [...d4.querySelectorAll('[data-section="chips"] .sv4-chip')].map((a) => a.dataset.chip);
  // Close: NFL 17-20 in Q4 is 3 (close); ALA 24-10 in Q3 is not; NYY 3-2 top 7th is (MLB within 2 from the 7th). Tonight: nothing left today.
  assert.deepEqual(chips, ['sport:all', 'sport:nfl', 'sport:cfb', 'sport:mlb', 'live', 'mine', 'top25', 'close']);
  assert.equal(d4.querySelector('[data-chip="close"]').textContent, 'Close 2');
  assert.equal(d4.querySelector('[data-chip="live"]').textContent, 'Live 4');
  assert.equal(d4.querySelector('[data-chip="sport:all"]').className, 'sv4-chip on');
  assert.equal(d4.querySelector('[data-chip="close"]').getAttribute('href'), '/scores?view=close');
  // the Close view narrows the board to the two close games, and its chip toggles off
  const dc = doc(v4html(v, true, { view: 'close' }));
  assert.deepEqual([...dc.querySelectorAll('article.sv4-card')].map((c) => c.dataset.slug), ['g-7', 'g-8']);
  assert.equal(dc.querySelector('[data-chip="close"]').className, 'sv4-chip on');
  assert.equal(dc.querySelector('[data-chip="close"]').getAttribute('href'), '/scores');
  // signed out: no Yours chip
  assert.equal(doc(v4html(fixture({ signedIn: false }), false)).querySelector('[data-chip="mine"]'), null);
});

test('CFB adds the conference picker, built from the day\'s rows', () => {
  const v = { ...fixture(), sport: 'cfb' };
  v.groups = v.groups.map((g) => ({ ...g, games: g.games.filter((x) => x.leagueSlug === 'cfb') })).filter((g) => g.games.length);
  const d4 = doc(v4html(v, true, { conf: 'SEC' }));
  assert.deepEqual([...d4.querySelectorAll('[data-section="conf"] .sv4-chip')].map((a) => [a.textContent, a.className]),
    [['ACC', 'sv4-chip'], ['American', 'sv4-chip'], ['SEC', 'sv4-chip on']]);
  assert.deepEqual([...d4.querySelectorAll('article.sv4-card')].map((c) => c.dataset.slug), ['g-3']);
  assert.equal(doc(v4html(fixture(), true)).querySelector('[data-section="conf"]'), null, 'All has no picker');
});

test('the live NFL card: volt clock pill, the leader\'s score, the ball, the field with its first-down tick, the foot with the opening and the win read', () => {
  const d4 = doc(v4html(fixture(), true));
  const c = d4.querySelector('[data-slug="g-7"]');
  assert.equal(c.querySelector('.clock').textContent, 'Q4 · 6:42');
  assert.equal(c.querySelector('.sv4-team.lead').dataset.side, 'away', 'PHI leads 20-17');
  assert.equal(c.querySelector('.sv4-team.lead .sc').textContent, '20');
  assert.ok(c.querySelector('.sv4-team[data-side="away"] .ball'), 'PHI has the ball');
  assert.equal(c.querySelector('.track u').getAttribute('style'), 'width:70%');
  assert.equal(c.querySelector('.track em').getAttribute('style'), 'left:72%');
  assert.equal(c.querySelector('.sit').textContent, 'PHI · 3rd & 2 · CHI 30');
  assert.equal(c.querySelector('.sv4-foot span').textContent, 'PHI -1.5 · O/U 44.5 · opened -2.5');
  assert.equal(c.querySelector('[data-winprob="nfl"]').textContent, 'PHI 64% win');
  // CFB and MLB: the win-prob slot renders nothing (ruling f)
  assert.equal(d4.querySelector('[data-slug="g-3"] [data-winprob]'), null);
  assert.equal(d4.querySelector('[data-slug="g-8"] [data-winprob]'), null);
});

test('the MLB live card: inning and half, count, bases - no field strip', () => {
  const c = doc(v4html(fixture(), true)).querySelector('[data-slug="g-8"]');
  assert.equal(c.querySelector('.clock').textContent, 'Top 7th');
  assert.ok(c.querySelector('[data-baseball="1"]'));
  assert.equal(c.querySelector('.sv4-diamond').getAttribute('aria-label'), '1st, 3rd');
  assert.match(c.querySelector('.cnt').textContent, /2-1/);
  assert.equal(c.querySelector('[data-drive]'), null);
});

test('final and scheduled: winner ink / loser muted, the moment and the link; the scheduled foot is line, total, open and the CTA', () => {
  const d4 = doc(v4html(fixture(), true));
  const f = d4.querySelector('[data-slug="g-2"]');
  assert.equal(f.querySelector('.sv4-team.trail').dataset.side, 'away');
  assert.equal(f.querySelector('.moment').textContent, 'Bailey 13/17 · 281 · 1 TD');
  assert.equal(f.querySelector('.go').getAttribute('href'), '/cfb/game/g-2');
  const s = d4.querySelector('[data-slug="g-6"]');
  assert.equal(s.querySelector('.sv4-foot span').textContent, 'TEN -5.5 · O/U 43.5 · opened -4');
  assert.equal(s.querySelector('.go').textContent, 'Change pick →');
  const out = doc(v4html(fixture({ signedIn: false }), false)).querySelector('[data-slug="g-6"]');
  assert.equal(out.querySelector('.go').textContent, 'Sign in to pick');
  // the card is one tap target without wrapping its own links in another link
  assert.equal(d4.querySelectorAll('a a').length, 0, 'no nested anchors');
  assert.equal(s.querySelector('.sv4-hit').getAttribute('href'), '/nfl/game/g-6');
});

test('the Yours strip sits above the day rail, exactly the band scoresV2 built', () => {
  const v = fixture();
  const alaGame = v.groups[0].games[0];
  v.groups = [{ key: 'yours', title: 'Yours', sub: '1 game · 1 live', games: [alaGame] }, ...v.groups.map((g) => ({ ...g, games: g.games.filter((x) => x.id !== 3) }))];
  const h = v4html(v, true);
  const order = [...h.matchAll(/data-group="(\w+)"|data-section="(\w+)"/g)].map((m) => m[1] ?? m[2]);
  assert.deepEqual(order, ['yours', 'days', 'chips', 'live', 'day', 'final']);
  // a view never hides the band
  assert.match(v4html(v, true, { view: 'tonight' }), /data-group="yours"/);
});
