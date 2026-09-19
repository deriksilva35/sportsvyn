// components/sim/trackerDoor.test.mjs - the tracker's door, on a league row.
//
// WHERE IT MOVED FROM AND WHY. The Games tab carried a "Tracker" tile beside
// "Mock" (GAMES v3 dropped it, and its addendum sent the door here). The
// tracker follows a draft happening SOMEWHERE ELSE, and somewhere else is a
// league you imported - not a practice preset and not a tab of games.
//
// THE THING WORTH PROVING is not that a link exists but that it carries THIS
// league's shape. A tracker opened with the wrong roster asks the reader to
// re-describe a board they are already sitting at, which is the whole cost the
// handoff exists to avoid.

import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
import { parseTrackerHandoff } from '../../lib/fantasy/handoff.js';

install();

// EXTENSIONLESS RELATIVE IMPORTS. nextResolve maps '@/x' and swallows CSS, but
// MyLeagues imports its siblings as './LeagueStart' - which Next resolves and
// plain ESM does not. Same Next-ism, one directory over; handled here rather
// than by widening the shared helper mid-relay.
const HERE = path.dirname(fileURLToPath(import.meta.url));
// THE ROUTER, STUBBED. LeagueStart and JoinByCode are client components that
// call useRouter; without a stub React throws "invariant expected app router
// to be mounted" before a single row renders. Outside the repo, so eslint
// never reads a file that is about to vanish.
const NAV = path.join(process.env.TMPDIR || '/tmp', `__td_nav_${process.pid}.mjs`);
writeFileSync(NAV, `
  export function useRouter() { return { push() {}, replace() {}, refresh() {} }; }
  export function useSearchParams() { return new URLSearchParams(); }
  export function usePathname() { return '/sim'; }
  export function redirect() {}
  export function notFound() {}
  export function useParams() { return {}; }
  export function useSelectedLayoutSegment() { return null; }
`);
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/navigation') return { url: pathToFileURL(NAV).href, shortCircuit: true };
  if (spec.startsWith('./') && !/\.[a-z]+$/.test(spec)) {
    const base = path.resolve(path.dirname(fileURLToPath(ctx.parentURL ?? pathToFileURL(`${HERE}/x`).href)), spec);
    for (const ext of ['.js', '.jsx', '.mjs']) {
      if (existsSync(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true };
    }
  }
  return next(spec, ctx);
} });

let React; let createRoot; let act; let MyLeagues; let dom;
const roots = new Set();

const LEAGUE = {
  id: 1902,
  name: 'The Longest Yard',
  teams_count: 12,
  scoring_format: 'ppr',
  roster_slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6 },
  keeper_count: 41,
  draft_date: null,
  role: 'owner',
  members: [],
  invite: null,
  mocks: [],
  default_seat: 2,
  kept_by_seat: null,
};

before(async () => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/sim' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  MyLeagues = (await import('./MyLeagues.js')).default;
});
afterEach(() => {
  for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } }
  roots.clear(); document.getElementById('root').innerHTML = '';
});
after(() => {
  for (const r of roots) { try { r.unmount(); } catch { /* gone */ } }
  try { unlinkSync(NAV); } catch { /* gone */ }
});

function render(leagues) {
  const c = document.getElementById('root');
  const root = createRoot(c); roots.add(root);
  act(() => root.render(React.createElement(MyLeagues, { leagues, userId: 1 })));
  return c;
}
const door = (c) => c.querySelector('.sml-track');

test('a league row carries the door, and it lands on the tracker', () => {
  const c = render([LEAGUE]);
  const a = door(c);
  assert.ok(a, 'the door is on the row');
  assert.match(a.textContent, /Track a live draft/);
  assert.match(a.getAttribute('href'), /^\/sim\/tracker\?/);
});

test('IT CARRIES THIS LEAGUE\'S SHAPE, not a default - parsed back out', () => {
  const c = render([LEAGUE]);
  const url = new URL(door(c).getAttribute('href'), 'https://sportsvyn.test');
  const sp = Object.fromEntries(url.searchParams.entries());
  // Through the tracker's OWN parser, which is all-or-nothing by design: if
  // any part fails to validate it returns null, so a green assertion here is
  // the tracker agreeing it can open on this board.
  const parsed = parseTrackerHandoff(sp);
  assert.ok(parsed, 'the tracker accepts the handoff');
  assert.equal(parsed.teamsCount, 12);
  assert.equal(parsed.scoringFormat, 'ppr');
  assert.deepEqual(parsed.rosterSlots, { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6 });
});

test('a SECOND league gets its own door, with its own shape', () => {
  const other = {
    ...LEAGUE, id: 1903, name: 'Ten Man Half', teams_count: 10,
    scoring_format: 'half-ppr', roster_slots: { QB: 1, RB: 2, WR: 3, TE: 1, BN: 4 },
  };
  const c = render([LEAGUE, other]);
  const doors = [...c.querySelectorAll('.sml-track')];
  assert.equal(doors.length, 2, 'one door per league, not one for the page');
  const parsed = doors.map((a) => parseTrackerHandoff(
    Object.fromEntries(new URL(a.getAttribute('href'), 'https://sportsvyn.test').searchParams.entries()),
  ));
  assert.equal(parsed[0].teamsCount, 12);
  assert.equal(parsed[1].teamsCount, 10);
  assert.equal(parsed[1].scoringFormat, 'half-ppr');
  assert.deepEqual(parsed[1].rosterSlots, { QB: 1, RB: 2, WR: 3, TE: 1, BN: 4 });
});

test('NO LEAGUES, NO DOOR - the component still renders nothing at all', () => {
  const c = render([]);
  assert.equal(c.innerHTML, '', 'a reader with no league sees the join band instead');
  assert.equal(door(c), null);
});

test('a league with no roster on the row still produces a link the tracker refuses cleanly', () => {
  // An import that arrived without roster_slots must not throw on render. The
  // handoff will not validate - which is the tracker asking for the shape,
  // the honest outcome - but the row draws.
  const c = render([{ ...LEAGUE, roster_slots: null }]);
  const a = door(c);
  assert.ok(a, 'the row still renders');
  const sp = Object.fromEntries(new URL(a.getAttribute('href'), 'https://sportsvyn.test').searchParams.entries());
  assert.equal(parseTrackerHandoff(sp), null, 'and the tracker asks rather than guesses');
});
