// components/daily/season/seasonBoardGuest.test.mjs - the signed-out play, as a
// button (Option A). Renders the real SeasonBoard in jsdom, presses the real
// buttons, asserts on the real fetches: Start goes to /api/daily/guest/start,
// the lock-in goes to /api/daily/guest/run WITH the signed token the start
// returned, and the result carries "Sign in to keep your streak".
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { transformSync } from '@babel/core';
import { install } from '../../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../../lib/testing/stubDir.mjs';
install();
// OpenReveal mounts LiveRefresh (useRouter); no app router exists under node --test.
const NAV = stubPath(`__guest_nav_${process.pid}.mjs`);
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/navigation') return { url: pathToFileURL(NAV).href, shortCircuit: true };
  return next(spec, ctx);
} });
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let React, createRoot, act, SeasonBoard, dom, tmp; const roots = new Set();
let calls = []; let impl = null;
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'FLEX', 'FLEX', 'K'];
const TEAMS = Array.from({ length: 12 }, (_, i) => ({ key: `T${i}`, abbr: `T${i}`, card: [{ position: 'QB', name: `P${i}`, points: 10 + i, meta: '' }] }));
const PLAY = {
  slots: SLOTS.slice(), teams: TEAMS,
  roster: SLOTS.map((pos, i) => ({ pos, pick: { teamKey: `T${i}`, player: { name: `P${i}`, points: 10 + i, position: 'QB', meta: '' } } })),
  used: new Set(TEAMS.slice(0, 8).map((t) => t.key)),
};
const REVEAL = {
  rows: SLOTS.map((s, i) => ({ slot: s, name: `P${i}`, team: `T${i}`, points: 10 + i })),
  total: 108, rank: null, of: 4, beatPct: 75, streak: null,
  board: { head: [], around: [], gap: false, me: null },
  guest: { claimExpiresAt: '2097-05-06T07:00:00.000Z' },
};
const SIGNIN = '/signin?callbackUrl=%2Fdaily%2Fboard';

before(async () => {
  writeFileSync(NAV, 'export function useRouter() { return { push: () => {}, replace: () => {}, refresh: () => {} }; }');
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/daily/board' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.MouseEvent = dom.window.MouseEvent; global.IS_REACT_ACT_ENVIRONMENT = true;
  global.fetch = (...a) => { calls.push(a); return impl(...a); };
  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react')); ({ createRoot } = await import('react-dom/client'));
  const src = path.join(__dirname, 'SeasonBoard.js');
  const out = transformSync(readFileSync(src, 'utf8'), { filename: src, presets: [['@babel/preset-react', { runtime: 'automatic' }]], configFile: false, babelrc: false }).code;
  tmp = stubPath(`__guest_test_${process.pid}.mjs`); writeFileSync(tmp, out.replace(/^'use client';\s*/m, ''));
  SeasonBoard = (await import(pathToFileURL(tmp).href)).default;
});
afterEach(() => { for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } } roots.clear(); });
after(() => { for (const f of [tmp, NAV]) { try { unlinkSync(f); } catch { /* gone */ } } });

function render(props) {
  const c = document.getElementById('root'); const root = createRoot(c); roots.add(root);
  act(() => root.render(React.createElement(SeasonBoard, {
    edition: 'The Daily · 2097-05-05', year: null, teams: TEAMS.map((t) => ({ ...t, card: [] })), slots: SLOTS,
    ranked: true, userId: null, boardId: 9, ...props,
  })));
  return c;
}
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

test('guest rules card: Start is there (it is the primary), sign-in is the secondary link', () => {
  const c = render({ guest: { signInHref: SIGNIN } });
  const card = c.querySelector('.sbd-rules');
  const start = [...card.querySelectorAll('button')].find((b) => /start the 3:00 clock/i.test(b.textContent));
  assert.ok(start, 'a signed-out reader can start');
  const link = [...card.querySelectorAll('a')].find((a) => a.getAttribute('href') === SIGNIN);
  assert.ok(link, 'and can sign in instead');
  assert.doesNotMatch(card.textContent, /Sign in to play/);
});

test('Start POSTs /api/daily/guest/start, never the signed-in start', async () => {
  calls = [];
  impl = async (url) => (url === '/api/daily/guest/start'
    ? { ok: true, json: async () => ({ boardId: 9, startedAt: new Date().toISOString(), teams: TEAMS, year: '2015', token: 'TOKEN.abc' }) }
    : { ok: true, json: async () => ({ ok: true, open: true, reveal: REVEAL, score: 108, elapsedS: 40 }) });
  const c = render({ guest: { signInHref: SIGNIN } });
  await act(async () => { click([...c.querySelectorAll('button')].find((b) => /start the 3:00 clock/i.test(b.textContent))); });
  assert.equal(calls[0][0], '/api/daily/guest/start');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls.filter(([u]) => u === '/api/daily/board/start').length, 0, 'never the signed-in start');
});

test('a resumed guest run submits with the token the PAGE handed down', async () => {
  calls = [];
  impl = async () => ({ ok: true, json: async () => ({ ok: true, open: true, reveal: REVEAL, score: 108, elapsedS: 40 }) });
  const c = render({
    teams: TEAMS, year: '2015', initialPlay: PLAY, initialScreen: 'board',
    initialStartedAt: new Date(Date.now() - 60_000).toISOString(),
    guest: { signInHref: SIGNIN, token: 'RESUME.tok' },
  });
  const lock = [...c.querySelectorAll('button')].find((b) => /lock it in/i.test(b.textContent));
  await act(async () => { click(lock); });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/daily/guest/run');
  const body = JSON.parse(calls[0][1].body);
  assert.equal(body.token, 'RESUME.tok');
  assert.equal(body.picks.length, 8);
  assert.ok(!('boardId' in body) && !('elapsedS' in body), 'nothing the server should not trust is sent');
  assert.ok(!('points' in body.picks[0]));
});

test('the guest result shows "Sign in to keep your streak" and "you beat X%", with no rank', async () => {
  impl = async () => ({ ok: true, json: async () => ({ ok: true, open: true, reveal: REVEAL, score: 108, elapsedS: 40 }) });
  const c = render({
    teams: TEAMS, year: '2015', initialPlay: PLAY, initialScreen: 'board',
    initialStartedAt: new Date(Date.now() - 60_000).toISOString(),
    guest: { signInHref: SIGNIN, token: 'RESUME.tok' },
  });
  await act(async () => { click([...c.querySelectorAll('button')].find((b) => /lock it in/i.test(b.textContent))); });
  const cta = [...c.querySelectorAll('a')].find((a) => /sign in to keep your streak/i.test(a.textContent));
  assert.ok(cta, 'the claim call to action is on the result');
  assert.equal(cta.getAttribute('href'), SIGNIN);
  assert.match(c.textContent, /you beat 75% of today's players/);
  assert.doesNotMatch(c.textContent, /#\d/, 'no rank - the guest is on no board');
});

test('a result that can no longer be claimed carries no sign-in button', () => {
  const c = render({ teams: TEAMS, year: '2015', initialScreen: 'grade', openReveal: REVEAL, guest: { signInHref: null } });
  assert.ok(![...c.querySelectorAll('a')].some((a) => /sign in to keep your streak/i.test(a.textContent)));
});

test('a SIGNED-IN reader never sees the guest paths', () => {
  const c = render({ userId: 5, teams: TEAMS, year: '2015', initialScreen: 'grade', openReveal: { ...REVEAL, rank: 3 } });
  assert.ok(![...c.querySelectorAll('a')].some((a) => /sign in to keep your streak/i.test(a.textContent)));
});
