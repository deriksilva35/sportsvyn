// components/gridiron/todayV2.test.mjs - the Today tab v2, rendered
// (docs/design/mocks/today-tab-v0_1.html). Every block, and every block's
// empty state, because "renders nothing rather than an empty shell" is the
// law this page inherits and the thing a fixture can actually check.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const LINK = path.join(__dirname, '__l_tv.mjs');
const NAV = path.join(__dirname, '__n_tv.mjs');
const CSS = path.join(__dirname, '__c_tv.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/link') return { url: pathToFileURL(LINK).href, shortCircuit: true };
  if (spec === 'next/navigation') return { url: pathToFileURL(NAV).href, shortCircuit: true };
  if (spec.endsWith('.css')) return { url: pathToFileURL(CSS).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, renderToStaticMarkup, TodayV2;
before(async () => {
  writeFileSync(LINK, "import React from 'react'; export default function Link({ href, children, ...rest }) { return React.createElement('a', { ...rest, href: String(href) }, children); }\n");
  writeFileSync(NAV, "export function usePathname(){ return '/nfl'; } export function useRouter(){ return { refresh(){}, push(){} }; }\n");
  writeFileSync(CSS, 'export default {};\n');
  React = await import('react');
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  TodayV2 = (await import('./TodayV2.js')).default;
});
after(() => { for (const f of [LINK, NAV, CSS]) { try { unlinkSync(f); } catch { /* gone */ } } });

const team = (ab, name = ab) => ({ id: ab.charCodeAt(0), abbreviation: ab, name, shortName: name, colors: { primary: '#111', secondary: '#eee' } });
const HERO = {
  contestId: 9, week: 1, settled: false,
  rows: [
    { slot: 'QB', id: 1, name: 'B. Purdy', team: 'SF', points: 18.4, played: true },
    { slot: 'RB', id: 2, name: 'B. Robinson', team: 'ATL', points: 14.1, played: true },
    { slot: 'WR', id: 3, name: 'J. Chase', team: 'CIN', points: 0, played: false },
    { slot: 'TE', id: null, name: null, team: null, points: 0, played: false },
    { slot: 'FLEX', id: 5, name: 'P. Nacua', team: 'LAR', points: 6.5, played: true },
    { slot: 'FLEX2', id: 6, name: 'J. Jacobs', team: 'GB', points: 9.2, played: true },
  ],
  total: 48.2, playedCount: 3, slots: 6, rank: 31, of: 1204, leader: 71.9,
};
const PICKS = {
  leagues: [
    { sport: 'nfl', label: 'NFL', href: '/pickem/nfl', total: 16, record: { wins: 1, losses: 1 }, chips: [], unpicked: 12, pendingPicked: 2 },
    { sport: 'cfb', label: 'CFB', href: '/pickem/cfb', total: 24, record: { wins: 5, losses: 2 }, chips: [], unpicked: 0, pendingPicked: 0 },
  ],
  chips: [
    { matchId: 1, abbr: 'SEA', state: 'won' },
    { matchId: 2, abbr: 'LAR', state: 'lost' },
    { matchId: 3, abbr: 'CIN', state: 'live' },
    { matchId: 4, abbr: 'DEN', state: 'live' },
    { matchId: 5, abbr: 'KC', state: 'pending' },
  ],
  nextLock: '2026-09-13T17:00:00Z', unpicked: 12, pendingPicked: 2, entered: true,
};
const TEAMS = [{
  followTeamId: 7, followName: 'SF', leagueSlug: 'nfl', slug: 'g1', status: 'final',
  kickoffAt: '2026-09-13T17:00:00Z', homeScore: 27, awayScore: 7, forHome: true,
  mine: team('SF', '49ers'), opp: team('SEA', 'Seahawks'), rank: null, liveLabel: null,
}, {
  followTeamId: 8, followName: 'ALA', leagueSlug: 'cfb', slug: 'g2', status: 'live',
  kickoffAt: '2026-09-13T20:00:00Z', homeScore: 24, awayScore: 10, forHome: true,
  mine: team('ALA', 'Alabama'), opp: team('LSU', 'LSU'), rank: 13, liveLabel: 'Live · Q3 6:12',
}];
const base = (over = {}) => ({
  leagueSlug: 'nfl', signedIn: true, now: '2026-09-13T14:42:00Z', week: 1, phase: 'REG',
  eyebrow: 'Sunday · Week 1 · 10:42 AM', title: 'Your day',
  read: { slug: 'r', title: "Week 1 spreads are still pricing last year's offenses.", dek: 'Three games.', readMin: 9, href: '/article/r' },
  hero: HERO, picks: PICKS,
  daily: { editionDate: '2026-09-13', board: { id: 29, closesAt: '2026-09-14T04:00:00Z' }, run: null, playingToday: 0 },
  teams: TEAMS, riding: true,
  chips: [{ teamId: 7, rank: 1, abbr: 'SF', record: '1-0', movement: null },
    { teamId: 99, rank: 2, abbr: 'LAR', record: '0-1', movement: null }],
  followed: new Set([7]),
  snapshot: { group: 'AFC WEST', rows: [{ team_id: 1, abbreviation: 'KC', wins: 0, losses: 0 }], hasStreak: false, hasPoints: false },
  leaders: [{ key: 'pass', label: 'PASSING', name: 'Purdy', yards: 205 }, { key: 'rec', label: 'RECEIVING', name: 'Nacua', yards: 122 }],
  wire: { items: [{ id: 1, lane: 'MOVE', headline: 'Denver -5.5, from -5 overnight.', url: '/x', source: 'Market' }], newest: null },
  kicks: [{ id: 1, slug: 'k1', kickoffAt: '2026-09-13T17:00:00Z', status: 'scheduled', home: team('CIN'), away: team('TB'), homeScore: null, awayScore: null, liveState: null, spreadHome: -3.5, href: '/nfl/game/k1' }],
  ...over,
});
const html = (v, props = {}) => renderToStaticMarkup(React.createElement(TodayV2, { v, ...props }));
const sections = (h) => [...h.matchAll(/data-section="([a-z]+)"/g)].map((m) => m[1]);

test('THE MOCK ORDER, signed in', () => {
  const h = html(base());
  assert.deepEqual(sections(h), ['read', 'weekly', 'picks', 'daily', 'teams', 'switch', 'rail', 'wire']);
  assert.match(h, /data-signed-in="1"/);
  assert.match(h, /<h1 class="tv-h1">Your day<\/h1>/);
  assert.match(h, /<div class="tv-eb">Sunday · Week 1 · 10:42 AM<\/div>/);
});

test('THE MOCK ORDER, signed out - the same page minus the personal blocks (R3)', () => {
  const h = html(base({ signedIn: false, title: 'Today', hero: null, picks: null, daily: null, teams: [], riding: false, followed: new Set() }));
  assert.deepEqual(sections(h), ['read', 'empty', 'kicks', 'switch', 'rail', 'wire']);
  assert.match(h, /<h1 class="tv-h1">Today<\/h1>/);
  assert.equal(/data-section="weekly"|data-section="picks"|data-section="daily"|data-section="teams"/.test(h), false);
});

test('THE NUMBERS BLOCK IS IDENTICAL SIGNED IN OR OUT (R3)', () => {
  const cut = (h) => h.slice(h.indexOf('data-section="switch"'), h.indexOf('The wire'));
  const inn = cut(html(base({ followed: new Set() })));
  const out = cut(html(base({ signedIn: false, title: 'Today', hero: null, picks: null, daily: null, teams: [], riding: false, followed: new Set() })));
  assert.equal(inn, out, 'byte for byte, given the same follow set');
});

test('THE READ STRIP IS OMITTED ENTIRELY WITH NO FOOTBALL ARTICLE (R2)', () => {
  const h = html(base({ read: null }));
  assert.equal(sections(h)[0], 'weekly', 'no read section, and nothing in its place');
  assert.equal(/tv-read|The read/.test(h), false, 'no placeholder, no heading');
  // And when there is one it carries title, dek and read time.
  const w = html(base());
  assert.match(w, /<div class="tv-eb q">The read<\/div>/);
  assert.match(w, /Read the card · 9 min/);
});

test('the Weekly hero: all six slots, three game states, and the rank printed at any field size', () => {
  const h = html(base());
  const slots = [...h.matchAll(/data-slot="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(slots, ['QB', 'RB', 'WR', 'TE', 'FLEX', 'FLEX2'], 'all six, including the unset one');
  assert.match(h, /<i class="tv-unset">Not set<\/i>/, 'an empty slot says so rather than vanishing');
  assert.match(h, /<div class="tv-big n">48\.2<\/div>/);
  assert.match(h, /<b class="n">#31<\/b><span>of 1204<\/span>/);
  assert.match(h, /<span>3 of 6 played<\/span>/); assert.match(h, /<span>leader 71\.9<\/span>/);
  assert.match(h, /style="width:50%"/, 'the bar is played over slots');
  // Q4: the truth at a field of one.
  const one = html(base({ hero: { ...HERO, rank: 1, of: 1 } }));
  assert.match(one, /<b class="n">#1<\/b><span>of 1<\/span>/);
});

test('the Weekly hero: a player whose game has not kicked says Not started, never 0', () => {
  const h = html(base({ kicks: [] }));
  const wr = h.slice(h.indexOf('data-slot="WR"'), h.indexOf('data-slot="TE"'));
  assert.match(wr, /<span class="st">Not started<\/span>/);
  assert.equal(/<b class="n">0<\/b>/.test(wr), false, 'a 0 next to a player who has not played is a wrong number');
  // A played slot shows its points.
  const qb = h.slice(h.indexOf('data-slot="QB"'), h.indexOf('data-slot="RB"'));
  assert.match(qb, /<b class="n">18\.4<\/b>/);
});

test('the Weekly hero is omitted when there is no entry', () => {
  const h = html(base({ hero: null }));
  assert.equal(/data-section="weekly"|The Weekly/.test(h), false);
});

test('the picks strip: the five states, and pending counted once (Q7)', () => {
  const h = html(base());
  const states = [...h.matchAll(/data-state="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(states, ['won', 'lost', 'live', 'live'], 'pending is not chipped individually');
  assert.match(h, /<span class="tv-chip good" data-state="won">SEA <b>✓<\/b>/);
  assert.match(h, /<span class="tv-chip bad" data-state="lost">LAR <b>✗<\/b>/);
  assert.match(h, /<span class="tv-chip" data-state="live">CIN <b>live<\/b>/);
  assert.match(h, /<span class="tv-chip q">14 pending<\/span>/, 'pendingPicked 2 + unpicked 12');
  assert.match(h, /NFL <b>1-1<\/b>/); assert.match(h, /CFB <b>5-2<\/b>/);
  assert.match(h, /next lock/);
});

test('the picks strip is omitted with no live board, and the pending chip with nothing pending', () => {
  assert.equal(/data-section="picks"/.test(html(base({ picks: null }))), false);
  assert.equal(/data-section="picks"/.test(html(base({ picks: { ...PICKS, leagues: [] } }))), false);
  const none = html(base({ picks: { ...PICKS, unpicked: 0, pendingPicked: 0 } }));
  assert.equal(/pending<\/span>/.test(none), false, 'no pending, no pending chip');
});

test('the Daily card names its three states and is omitted with no board', () => {
  assert.match(html(base()), /Not played/);
  assert.match(html(base()), />Play<\/span>/);
  const started = html(base({ daily: { board: { id: 1, closesAt: null }, run: { startedAt: 'x', completedAt: null } } }));
  assert.match(started, /In progress/); assert.match(started, />Resume<\/span>/);
  const done = html(base({ daily: { board: { id: 1, closesAt: null }, run: { startedAt: 'x', completedAt: 'y' } } }));
  assert.match(done, /Played today/); assert.match(done, />See your grade<\/span>/);
  assert.equal(/data-section="daily"/.test(html(base({ daily: null }))), false);
  assert.equal(/data-section="daily"/.test(html(base({ daily: { board: null, run: null } }))), false);
});

test('your teams: every followed team, live or next, with the CFB rank (R1)', () => {
  const h = html(base());
  const rows = [...h.matchAll(/data-team-id="(\d+)"/g)].map((m) => m[1]);
  assert.ok(rows.includes('7') && rows.includes('8'), 'both followed teams, not just the ones playing today');
  const sec = h.slice(h.indexOf('data-section="teams"'), h.indexOf('The numbers'));
  assert.match(sec, /<span class="tag w">W<\/span>/, 'a final the team won');
  assert.match(sec, /<span class="tag lv">Q3 6:12<\/span>/, 'a live game shows period and clock');
  assert.match(sec, /<span class="rk">13<\/span>/, 'and the AP rank on the CFB row');
  assert.match(sec, /27-7/);
  assert.equal(/data-section="teams"/.test(html(base({ teams: [] }))), false, 'no follows, no section');
});

test('the rail marks a followed team and carries the id it reads', () => {
  const h = html(base());
  assert.match(h, /<a class="tv-rchip mine" data-team-id="7"/);
  assert.match(h, /<a class="tv-rchip" data-team-id="99"/);
  assert.equal(/tv-rchip mine/.test(html(base({ followed: new Set() }))), false, 'a stranger marks nothing');
  assert.equal(/data-section="rail"/.test(html(base({ chips: [] }))), false);
});

test('the numbers: the stat short names are named, not truncated', () => {
  const h = html(base());
  assert.match(h, /<td class="l">PASS<\/td>/);
  assert.match(h, /<td class="l">REC<\/td>/);
  assert.equal(/RECE</.test(h), false, 'RECEIVING sliced to four characters is not a word');
  assert.match(h, /<div class="tv-eb q">AFC WEST<\/div>/, "the snapshot heading is the data's spelling");
});

test('the numbers: each half disappears on its own', () => {
  assert.equal(/Week leaders/.test(html(base({ leaders: [] }))), false);
  assert.equal(/AFC WEST/.test(html(base({ snapshot: null }))), false);
  const neither = html(base({ leaders: [], snapshot: null }));
  assert.equal(/tv-two/.test(neither), false, 'and the grid with them');
});

test('signed out: the kickoff list is today with spreads, and the CTA goes to sign-in', () => {
  const h = html(base({ signedIn: false, title: 'Today', hero: null, picks: null, daily: null, teams: [], riding: false }));
  assert.match(h, /data-section="kicks"/);
  assert.match(h, /<span class="nm">TB at CIN<\/span>/);
  assert.match(h, /<span class="sc line">CIN -3\.5<\/span>/);
  assert.match(h, /Nothing riding yet/);
  assert.match(h, /href="\/signin\?callbackUrl=%2Fdaily%2Fboard"/);
  assert.equal(/data-section="kicks"/.test(html(base({ signedIn: false, hero: null, picks: null, daily: null, teams: [], riding: false, kicks: [] }))), false);
});

test('signed out inside the shell carries the marker in both places', () => {
  const h = html(base({ signedIn: false, hero: null, picks: null, daily: null, teams: [], riding: false }), { isShell: true });
  const m = h.match(/href="(\/signin\?[^"]*)"/);
  assert.ok(m, 'a sign-in link renders');
  const href = m[1].replace(/&amp;/g, '&');
  assert.ok(/[&]shell=/.test(href), 'the /signin URL carries it');
  const cb = decodeURIComponent(new URL(href, 'https://x').searchParams.get('callbackUrl'));
  assert.ok(/[?&]shell=/.test(cb), 'and so does the callback');
});

test('a signed-in account with nothing riding gets the same one card, not three empty ones', () => {
  const h = html(base({ hero: null, picks: null, daily: null, teams: [], riding: false }));
  assert.match(h, /data-section="empty"/);
  assert.match(h, /Nothing riding yet/);
  assert.equal(/data-section="kicks"/.test(h), false, 'the kickoff list is the stranger block, not this one');
});

test('the wire is omitted when empty', () => {
  assert.equal(/data-section="wire"/.test(html(base({ wire: { items: [], newest: null } }))), false);
});

test('no em dash anywhere in the page or its readers', () => {
  for (const f of ['components/gridiron/TodayV2.js', 'components/gridiron/TodayShell.js',
    'lib/gridiron/todayV2.js', 'lib/gridiron/todayReads.js', 'lib/gridiron/todayPicks.js',
    'components/gridiron/todayV2.css']) {
    assert.equal(/—/.test(readFileSync(path.join(REPO, f), 'utf8')), false, `${f} carries an em dash`);
  }
});

test('SIX SLOTS, SIX STATES, ACROSS FOUR DAYS - the week, not the day', () => {
  // THE BUG THIS PINS: the slot state was matched against TODAY's slate, so a
  // lineup spread over Thursday, Sunday and Monday showed a state for the
  // Sunday players and nothing for the rest. The map is the contest's WEEK
  // now, so every filled row carries one.
  const week = new Map([
    ['SF', { status: 'final', metadata: { live_state: null }, kickoffAt: '2026-09-10T00:20:00Z' }],
    ['ATL', { status: 'live', metadata: { live_state: { period: 3, clock: '6:12' } }, kickoffAt: '2026-09-13T17:00:00Z' }],
    ['CIN', { status: 'scheduled', metadata: { live_state: null }, kickoffAt: '2026-09-13T20:05:00Z' }],
    ['LAR', { status: 'final', metadata: { live_state: null }, kickoffAt: '2026-09-14T00:20:00Z' }],
    ['GB', { status: 'scheduled', metadata: { live_state: null }, kickoffAt: '2026-09-15T00:15:00Z' }],
  ]);
  const h = html(base({ weekGames: week, kicks: [] }));
  const rows = [...h.matchAll(/data-slot="(\w+)" data-game="([^"]+)"/g)].map((m) => [m[1], m[2]]);
  assert.equal(rows.length, 6, 'all six slots render');
  const by = Object.fromEntries(rows);
  assert.equal(by.QB, 'final', 'Thursday, finished');
  assert.equal(by.RB, 'Q3 6:12', 'Sunday afternoon, live with period and clock');
  assert.equal(by.WR, 'scheduled', 'Sunday night, not started');
  // AN UNSET SLOT IS 'empty', NOT 'scheduled'. It used to print 'scheduled'
  // because the attribute fell back to that literal whenever there was no
  // game - which said "this player's game has not kicked off" about a slot
  // with no player in it. lib/weekly/slotState.js separates the two.
  assert.equal(by.TE, 'empty', 'an unset slot has no player, so it has no game state');
  assert.equal(by.FLEX, 'final', 'Sunday night, finished');
  assert.equal(by.FLEX2, 'scheduled', 'Monday, the slate has not started it');
  // The three renderings the states produce.
  const qb = h.slice(h.indexOf('data-slot="QB"'), h.indexOf('data-slot="RB"'));
  assert.match(qb, /SF · final/); assert.match(qb, /<b class="n">18\.4<\/b>/, 'a final shows points');
  const rb = h.slice(h.indexOf('data-slot="RB"'), h.indexOf('data-slot="WR"'));
  assert.match(rb, /ATL · Q3 6:12/); assert.match(rb, /<b class="n live">14\.1<\/b>/, 'a live row shows live points');
  const wr = h.slice(h.indexOf('data-slot="WR"'), h.indexOf('data-slot="TE"'));
  assert.match(wr, /<span class="st">Not started<\/span>/, 'and a scheduled one says so with its kickoff');
  assert.match(wr, /CIN · /);
});

test('the switch block carries the way out to every game, both states', () => {
  for (const [label, v] of [
    ['signed in', base()],
    ['signed out', base({ signedIn: false, title: 'Today', hero: null, picks: null, daily: null, teams: [], riding: false })],
  ]) {
    const h = html(v);
    const sw = h.slice(h.indexOf('data-section="switch"'), h.indexOf('data-section="rail"'));
    assert.match(sw, /<a class="all" href="\/scores">All games →<\/a>/, `${label}: the link is there`);
    assert.match(sw, /<span class="on">NFL<\/span>/, `${label}: beside the league pills`);
  }
});
