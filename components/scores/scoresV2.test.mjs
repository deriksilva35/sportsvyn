// components/scores/scoresV2.test.mjs - the Scores tab v2, rendered (SCORES TAB v2, item 10).
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { install } from '../../lib/testing/nextResolve.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINK = path.join(__dirname, '__link_stub.mjs');
const NAV = path.join(__dirname, '__nav_stub.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/link') return { url: pathToFileURL(LINK).href, shortCircuit: true };
  if (spec === 'next/navigation') return { url: pathToFileURL(NAV).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, renderToStaticMarkup, ScoresV2, nav, dom, createRoot, act; const roots = new Set();
before(async () => {
  writeFileSync(LINK, "import React from 'react'; export default function Link({ href, children, ...rest }) { return React.createElement('a', { ...rest, href: String(href) }, children); }\n");
  writeFileSync(NAV, "export const refreshes = []; export function useRouter() { return { refresh: () => refreshes.push(Date.now()), push() {} }; }\n");
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/scores' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  React = await import('react'); ({ act } = React); ({ createRoot } = await import('react-dom/client'));
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  ScoresV2 = (await import('./ScoresV2.js')).default;
  nav = await import(pathToFileURL(NAV).href);
});
afterEach(() => { for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } } roots.clear(); });
after(() => { for (const f of [LINK, NAV]) { try { unlinkSync(f); } catch { /* gone */ } } });

const team = (id, ab, colors = { primary: '#111111', secondary: '#EEEEEE' }) => ({ id, abbreviation: ab, name: ab, shortName: ab, colors });
const game = (id, league, status, kickoffAt, home, away, hs = null, as = null, extra = {}) => ({ id, slug: `g-${id}`, leagueSlug: league, status, kickoffAt, homeScore: hs, awayScore: as, home, away, network: 'FOX', liveState: null, etWeekday: 'Fri', ...extra });
const X = (o = {}) => ({ record: { home: '1-0', away: '0-1' }, spreadHome: null, total: null, preview: null, drive: null, stat: null, hasStats: false, prob: null, stake: null, open: false, ...o });
function fixture({ signedIn = true } = {}) {
  const live = game(3, 'cfb', 'live', '2026-09-12T23:30:00Z', team(5, 'ALA'), team(6, 'USF'), 24, 10, { liveState: { period: 3, clock: '8:41' } });
  const epl = game(5, 'epl', 'live', '2026-09-12T16:30:00Z', team(9, 'BRE', null), team(10, 'BOU', null), 1, 1, { liveState: { period: '2H', elapsed: 71 } });
  const up = game(6, 'nfl', 'scheduled', '2026-09-13T17:00:00Z', team(11, 'TEN'), team(12, 'DEN'));
  const fin = game(2, 'cfb', 'final', '2026-09-11T23:00:00Z', team(3, 'NCSU'), team(4, 'RICH'), 38, 3);
  const extras = new Map([
    [3, X({ drive: { label: '2nd & 6', spot: 'ALA 41', offenseAbbr: 'ALA', pct: 41, lastPlay: 'J. Milroe pass short right to G. Bernard for 9 yards.' }, stake: signedIn ? { pick: { side: 'home', abbr: 'ALA', state: 'winning' }, weekly: [{ name: 'Jalen Milroe', pos: 'QB', points: 18.4 }], alerts: true } : null })],
    [5, X({ prob: { home: 54, draw: 24, away: 22 } })],
    [6, X({ open: true, spreadHome: -5.5, total: 43.5, preview: '/article/den-ten', stake: signedIn ? { pick: { side: 'away', abbr: 'DEN', state: 'pending' }, weekly: [{ name: 'Bo Nix', pos: 'QB', points: 0 }, { name: 'Courtland Sutton', pos: 'WR', points: 0 }], alerts: true } : null })],
    [2, X({ stat: { name: 'CJ Bailey', passCmp: 13, passAtt: 17, passYds: 281, passTd: 1 }, hasStats: true, stake: signedIn ? { pick: { side: 'home', abbr: 'NCSU', state: 'won' }, weekly: [], alerts: false } : null })],
  ]);
  return {
    today: '2026-09-12', date: '2026-09-12', tz: 'America/Los_Angeles', sport: 'all', mine: false, liveCount: 2, mineCount: signedIn ? 3 : 0,
    days: [{ date: '2026-09-11', dow: 'Fri', day: 11, counts: { live: 0, final: 1, scheduled: 0, epl: 0 }, on: false }, { date: '2026-09-12', dow: 'Sat', day: 12, counts: { live: 2, final: 0, scheduled: 0, epl: 1 }, on: true }, { date: '2026-09-13', dow: 'Sun', day: 13, counts: { live: 0, final: 0, scheduled: 1, epl: 0 }, on: false }],
    liveAway: null,
    groups: [
      { key: 'live', title: 'Live now', sub: 'updates every 30s', games: [live, epl] },
      { key: 'day', title: 'Tomorrow · Sunday', sub: '1 game · your picks lock at kick', games: [up] },
      { key: 'final', title: 'Final', sub: 'Fri', games: [fin] },
    ],
    extras,
  };
}
// The same slate with SUNDAY picked: the day leads, the live games collapse.
function sundayFixture() {
  const v = fixture();
  return {
    ...v, date: '2026-09-13', liveAway: { count: 2 },
    days: v.days.map((d) => ({ ...d, on: d.date === '2026-09-13' })),
    groups: v.groups.filter((g) => g.key !== 'live'),
  };
}
const html = (props) => renderToStaticMarkup(React.createElement(ScoresV2, props));

test('groups render in order with their cards by status, TeamMark at 24 on every row', () => {
  const h = html({ v: fixture(), signedIn: true, zoneLabel: 'Pacific' });
  const groups = [...h.matchAll(/data-group="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(groups, ['live', 'day', 'final']);
  assert.deepEqual([...h.matchAll(/data-variant="(\w+)"/g)].map((m) => m[1]), ['live', 'live', 'upcoming', 'final']);
  assert.match(h, /<h2>Live now<\/h2><small>updates every 30s<\/small>/);
  assert.match(h, /<h2>Tomorrow · Sunday<\/h2>/); assert.match(h, /<h2>Final<\/h2>/);
  // eight team rows, eight marks at 24: six coloured circles and two EPL abbr discs
  assert.equal((h.match(/class="sv2-team/g) ?? []).length, 8);
  assert.equal((h.match(/data-teammark="circle"/g) ?? []).length, 6);
  assert.equal((h.match(/data-teammark="abbr"/g) ?? []).length, 2);
  assert.equal((h.match(/width="24" height="24"/g) ?? []).length, 6);
  assert.match(h, /data-teammark="abbr"[^>]*>BRE</, 'the EPL fallback carries the abbreviation');
  // header + strip
  assert.match(h, /<h1>Scores<\/h1><div class="sv2-eb q">Saturday · all times Pacific<\/div>/);
  assert.match(h, /data-live-count="2">2 live</);
  assert.match(h, /class="sv2-day on live"[^>]*href="\/scores\?date=2026-09-12"[^>]*><small>Sat<\/small><b>12<\/b><i>2 live<\/i>/);
  assert.match(h, /class="sv2-day"[^>]*href="\/scores\?date=2026-09-11"[^>]*><small>Fri<\/small><b>11<\/b><i>1 final<\/i>/);
});

test('live card: red rule, period and clock, network, Alerts on, the drive strip; EPL gets the bar, football does not', () => {
  const h = html({ v: fixture(), signedIn: true });
  const cards = h.split('<a class="sv2-card').slice(1);
  const ala = cards[0], bre = cards[1];
  assert.match(ala, /^ live" href="\/cfb\/game\/g-3"/);
  assert.match(ala, /<span class="l">Q3 · 8:41<\/span><span>CFB · FOX<\/span><span class="bell">Alerts on<\/span>/);
  assert.match(ala, /data-drive="1"/); assert.match(ala, /<span class="dd">2nd &amp; 6<small>ALA 41<\/small><\/span><span class="ball">ALA ball<\/span>/);
  assert.match(ala, /class="field"><u style="left:0;width:41%"><\/u><i style="left:41%"><\/i>/);
  assert.match(ala, /<span class="lp">J\. Milroe pass short right to G\. Bernard for 9 yards\.<\/span>/);
  assert.doesNotMatch(ala, /data-winprob/, 'no win-probability bar on football');
  assert.match(ala, /<b class="n">24<\/b>/); assert.match(ala, /<span class="rec">1-0<\/span>/);
  assert.match(ala, /data-stake="1"/); assert.match(ala, /class="good">Pick(?:&#x27;|')em <b>ALA<\/b>/); assert.match(ala, /class="good">Weekly · Milroe <b>18\.4<\/b>/);
  assert.match(bre, /data-winprob="epl"/); assert.match(bre, /<span>BRE 54%<\/span>/); assert.match(bre, /style="width:54%"/);
  assert.match(bre, /<span class="l">71&#x27;<\/span>|<span class="l">71'<\/span>/);
  assert.doesNotMatch(bre, /data-drive/);
});

test('upcoming card: kickoff, Your pick chip, spread and total, Preview; final card: compact, pick result, Box score', () => {
  const h = html({ v: fixture(), signedIn: true });
  const cards = h.split('<a class="sv2-card').slice(1);
  const up = cards[2], fin = cards[3];
  assert.match(up, /<span class="pk">Your pick<\/span>/); assert.equal((up.match(/Your pick/g) ?? []).length, 1);
  assert.match(up, /Spread TEN -5\.5 · O\/U 43\.5/); assert.match(up, /class="go">Change pick →</, 'picked and open -> Change pick (rider 2)');
  assert.match(up, /Weekly · Nix, Sutton <b>2 players<\/b>/); assert.match(up, /class="bell">Alerts</);
  assert.match(fin, /^ final" href="\/cfb\/game\/g-2"/); assert.match(fin, /Final · Fri/);
  assert.match(fin, /data-stake="1"/); assert.match(fin, /Pick(?:&#x27;|')em <b>NCSU ✓<\/b>/); assert.match(fin, /class="go">Box score →</);
  // the foot is the stat line whether or not there is a pick (addendum 6)
  const v2 = fixture(); v2.extras.get(2).stake = null;
  const h2 = html({ v: v2, signedIn: true }).split('<a class="sv2-card').slice(1)[3];
  assert.match(h2, /<b>Bailey 13\/17 · 281 · 1 TD<\/b>/);
  // no pick on an open board -> "No pick yet" chip to THIS league's board (rider 3), and Preview only with an article (rider 2)
  const v3 = fixture(); v3.extras.get(6).stake = { pick: null, weekly: [], alerts: false };
  const h3 = html({ v: v3, signedIn: true }).split('<a class="sv2-card').slice(1)[2];
  assert.match(h3, /class="none" href="\/pickem\/nfl">No pick yet<\/a>/); assert.match(h3, /class="go">Preview →</);
  const v4 = fixture(); v4.extras.get(6).stake = { pick: null, weekly: [], alerts: false }; v4.extras.get(6).preview = null;
  const h4 = html({ v: v4, signedIn: true }).split('<a class="sv2-card').slice(1)[2];
  assert.doesNotMatch(h4, /class="go"/, 'no pick and no preview -> no element at all');
  const v5 = fixture(); v5.extras.get(6).open = false;
  const h5 = html({ v: v5, signedIn: true }).split('<a class="sv2-card').slice(1)[2];
  assert.doesNotMatch(h5, /class="go"/, 'picked but kicked -> no Change pick, no empty span');
  assert.doesNotMatch(html({ v: fixture(), signedIn: true }), /<span class="go"><\/span>/, 'never an empty go span');
  // a CFB card's chip goes to the CFB board
  const v6 = fixture(); v6.groups[1].games[0] = { ...v6.groups[1].games[0], leagueSlug: 'cfb' };
  v6.extras.get(6).stake = { pick: null, weekly: [], alerts: false };
  assert.match(html({ v: v6, signedIn: true }), /class="none" href="\/pickem\/cfb">No pick yet<\/a>/);
});

test('Mine: the pill carries the count and toggles ?mine=1; signed out has no Mine, no stake markup, "Sign in to pick"', () => {
  const h = html({ v: fixture(), signedIn: true });
  assert.match(h, /class="sv2-pill mine"[^>]*href="\/scores\?date=2026-09-12&amp;mine=1"[^>]*>Mine · 3</);
  assert.match(h, /data-mine-count="3"/);
  const on = html({ v: { ...fixture(), mine: true }, signedIn: true });
  assert.match(on, /class="sv2-pill mine on"[^>]*href="\/scores\?date=2026-09-12"/);
  const out = html({ v: fixture({ signedIn: false }), signedIn: false });
  assert.doesNotMatch(out, /data-stake|Mine ·|Your pick|Pick'em|Alerts/);
  assert.match(out, /class="go">Sign in to pick</);
  assert.equal((out.match(/data-variant=/g) ?? []).length, 4, 'the same four cards');
});

test('the 30 s refresh mounts only with a live card, and stops while the tab is hidden', async () => {
  const calls = [];
  const realSet = global.setInterval, realClear = global.clearInterval;
  global.setInterval = (fn, ms) => { calls.push(['set', ms, fn]); return calls.length; };
  global.clearInterval = (id) => calls.push(['clear', id]);
  try {
    const mount = (v) => { const el = document.getElementById('root'); const root = createRoot(el); roots.add(root); act(() => root.render(React.createElement(ScoresV2, { v, signedIn: true }))); return el; };
    mount(fixture());
    const sets = calls.filter((c) => c[0] === 'set');
    assert.equal(sets.length, 1, 'one interval with a live card'); assert.equal(sets[0][1], 30_000);
    sets[0][2](); assert.equal(nav.refreshes.length, 1, 'the tick calls router.refresh()');
    // hidden -> cleared; visible -> a new one
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => { document.dispatchEvent(new dom.window.Event('visibilitychange')); });
    assert.equal(calls.filter((c) => c[0] === 'clear').length, 1, 'cleared while hidden');
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => { document.dispatchEvent(new dom.window.Event('visibilitychange')); });
    assert.equal(calls.filter((c) => c[0] === 'set').length, 2, 'restarted when visible');
    for (const r of roots) act(() => r.unmount()); roots.clear(); calls.length = 0;
    const quiet = fixture(); quiet.liveCount = 0; quiet.groups = quiet.groups.filter((g) => g.key !== 'live');
    mount(quiet);
    assert.equal(calls.filter((c) => c[0] === 'set').length, 0, 'no interval without a live card');
  } finally { global.setInterval = realSet; global.clearInterval = realClear; }
});

test('an FCS side with no abbreviation gets one derived from its name, on the mark and in the column', () => {
  const v = fixture(); v.groups[2].games[0].away = { id: 4, abbreviation: null, name: 'Norfolk State', shortName: 'Norfolk State', colors: null };
  const h = html({ v, signedIn: true }).split('<a class="sv2-card').slice(1)[3];
  assert.match(h, /data-teammark="abbr"[^>]*aria-label="Norfolk State"[^>]*>NOR</);
  assert.match(h, /<span class="ab">NOR<\/span><span class="nm">Norfolk State/);
});

test('TEAM ORDER: the EPL card renders home first, the football cards away first', () => {
  const h = html({ v: fixture(), signedIn: true });
  const cards = h.split('<a class="sv2-card').slice(1);
  const rowAbbrs = (c) => [...c.matchAll(/<span class="ab">([^<]*)<\/span>/g)].map((m) => m[1]);
  // the fixture's live CFB card is ALA (home) v USF (away) -> away first
  assert.deepEqual(rowAbbrs(cards[0]), ['USF', 'ALA'], 'CFB: away then home');
  // the EPL card is BRE (home) v BOU (away) -> home first
  assert.deepEqual(rowAbbrs(cards[1]), ['BRE', 'BOU'], 'EPL: home then away');
  // NFL upcoming: TEN (home) v DEN (away) -> away first
  assert.deepEqual(rowAbbrs(cards[2]), ['DEN', 'TEN'], 'NFL: away then home');
  // the score follows the TEAM, not the row position: BRE leads the card and
  // still carries the home score
  const eplRows = cards[1].split('<div class="sv2-team');
  assert.match(eplRows[1], /<span class="ab">BRE<\/span>[\s\S]*<b class="n">1<\/b>/);
  assert.match(eplRows[2], /<span class="ab">BOU<\/span>[\s\S]*<b class="n">1<\/b>/);
  // and nothing here decides the order for itself
  const comp = readFileSync(path.join(path.resolve(__dirname, '..', '..'), 'components/scores/ScoresV2.js'), 'utf8');
  assert.match(comp, /orderFor\(g\.leagueSlug\)/);
});

test('DAY PICK LEADS: on another day the day leads, the live games are one red line, and no live card renders', () => {
  const h = html({ v: sundayFixture(), signedIn: true });
  // the line, its count, and the way back
  assert.match(h, /<a class="sv2-liveaway" data-liveaway="2" href="\/scores">2 live now <span>Back to today →<\/span><\/a>/);
  // it sits above the first group, and the day's own games lead
  assert.ok(h.indexOf('sv2-liveaway') < h.indexOf('data-group='), 'the line is above the groups');
  assert.deepEqual([...h.matchAll(/data-group="(\w+)"/g)].map((m) => m[1]), ['day', 'final']);
  // NO live card markup at all
  assert.doesNotMatch(h, /class="sv2-card live"/);
  assert.doesNotMatch(h, /data-variant="live"/);
  assert.doesNotMatch(h, /<h2>Live now<\/h2>/);
  assert.doesNotMatch(h, /data-drive="1"/, 'no drive strip either - the cards are gone');
  // today keeps its own line and no collapse
  const t = html({ v: fixture(), signedIn: true });
  assert.doesNotMatch(t, /sv2-liveaway/); assert.match(t, /<h2>Live now<\/h2>/);
  // the line's CSS is live-red with the dot
  const css = readFileSync(path.join(path.resolve(__dirname, '..', '..'), 'app/scores/scoresV2.css'), 'utf8');
  assert.match(css, /\.sv2-liveaway \{[^}]*border: 1px solid var\(--live\)[^}]*color: var\(--live\)/s);
});

test('the day strip: the picked day is marked on, and today keeps its live class even when another day is picked', () => {
  const h = html({ v: sundayFixture(), signedIn: true });
  // Sat (today) still carries live; Sun (picked) carries on and not live
  assert.match(h, /class="sv2-day live"[^>]*data-date="2026-09-12"/, 'today keeps its live class');
  assert.match(h, /class="sv2-day on"[^>]*data-date="2026-09-13"/, 'the picked day is marked on');
  assert.doesNotMatch(h, /class="sv2-day on live"[^>]*data-date="2026-09-13"/);
  // and on today both land on the same chip
  assert.match(html({ v: fixture(), signedIn: true }), /class="sv2-day on live"[^>]*data-date="2026-09-12"/);
  // every chip is a full navigation to its own date (Next scrolls to top by default - no scroll={false} anywhere)
  const comp = readFileSync(path.join(path.resolve(__dirname, '..', '..'), 'components/scores/ScoresV2.js'), 'utf8');
  assert.doesNotMatch(comp, /scroll=\{false\}/, 'a day change must land at the top of the new page');
  assert.equal((h.match(/class="sv2-day[^"]*"[^>]*href="\/scores\?date=/g) ?? []).length, 3);
});

test('a final foot carries the stat line and the box score, never the pick (addendum 6)', () => {
  const h = html({ v: fixture(), signedIn: true });
  const fin = h.split('<a class="sv2-card').slice(1)[3];
  const foot = fin.slice(fin.indexOf('<div class="sv2-foot">'));
  assert.doesNotMatch(foot, /Pick(?:&#x27;|')em/, 'the result lives in the stake row and nowhere else');
  assert.match(foot, /<b>Bailey 13\/17 · 281 · 1 TD<\/b>/); assert.match(foot, /class="go">Box score →</);
  // and the stake row still carries it
  assert.match(fin, /data-stake="1"/); assert.match(fin, /Pick(?:&#x27;|')em <b>NCSU ✓<\/b>/);
  // a final with no stat line and no stats reads "Final" with no box-score link
  const v = fixture(); v.extras.get(2).stat = null; v.extras.get(2).hasStats = false;
  const bare = html({ v, signedIn: true }).split('<a class="sv2-card').slice(1)[3];
  assert.match(bare, /<div class="sv2-foot"><span>Final<\/span><\/div>/);
});

test('addendum 5: the Scores tab mounts TzCookie so sv_tz is written on the first visit', () => {
  const page = readFileSync(path.join(path.resolve(__dirname, '..', '..'), 'app/scores/page.js'), 'utf8');
  assert.match(page, /import TzCookie from '@\/components\/gridiron\/TzCookie'/);
  assert.match(page, /<TzCookie \/>/);
  assert.ok(page.indexOf('<TzCookie />') < page.indexOf('<ScoresV2'), 'mounted with the tab, above the board');
});

test('no em dashes; /nfl/scores and /cfb/scores still mount ScoresView; LeagueScores untouched', () => {
  const REPO = path.resolve(__dirname, '..', '..');
  for (const f of ['components/scores/ScoresV2.js', 'components/scores/LiveRefresh.js', 'lib/gridiron/scoresV2.js', 'lib/gridiron/scoresV2Shape.js', 'app/scores/scoresV2.css', 'app/scores/page.js']) {
    assert.ok(!/—/.test(readFileSync(path.join(REPO, f), 'utf8')), `${f} carries an em dash`);
  }
  // GO rider 1: the site's straight apostrophe, no U+2019 anywhere in components/scores
  for (const f of ['components/scores/ScoresV2.js', 'components/scores/LiveRefresh.js']) {
    assert.ok(!/\u2019/.test(readFileSync(path.join(REPO, f), 'utf8')), `${f} carries a curly apostrophe`);
  }
  const page = readFileSync(path.join(REPO, 'app/scores/page.js'), 'utf8');
  assert.match(page, /export async function ScoresView\(/); assert.match(page, /<ScoresV2 v=\{v\} signedIn=\{userId != null\}/);
  for (const f of ['app/nfl/scores/page.js', 'app/cfb/scores/page.js']) assert.match(readFileSync(path.join(REPO, f), 'utf8'), /import \{ ScoresView \} from '@\/app\/scores\/page'/);
});
