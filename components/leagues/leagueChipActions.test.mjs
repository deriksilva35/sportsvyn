// components/leagues/leagueChipActions.test.mjs - "+ Join" and "+ Create",
// MOUNTED, with the refusal a bad code earns.
//
// The claims this file actually tests:
//   SAME REFUSAL     a bad code shows lib/leagues/code.js's own sentence - the
//                    string joinLeague() returns on the server - and shows it
//                    without costing a round trip.
//   PASTE OR TYPE    cleanLeagueInput runs at the keystroke and on paste, so
//                    "abcd-ef " lands as ABCDEF instead of being refused later.
//   THE SERVER'S WORDS the reason a refused join renders is the one handed back,
//                    never a copy of it written here.
//   CREATE SHOWS BOTH the code and a link that EXISTS (/leagues?join=CODE, not
//                    the /leagues/join/CODE the Run board printed, which 404s).
//   NO WEB-ONLY STEP nothing in the component sends a reader to a web page to
//                    finish the job, and nothing names an origin.

import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { install } from '../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../lib/testing/stubDir.mjs';
install();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ACTION = stubPath('__lgc_actions.mjs');
const NAV = stubPath('__lgc_nav.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec.endsWith('app/actions/leagues')) return { url: pathToFileURL(ACTION).href, shortCircuit: true };
  if (spec === 'next/navigation') return { url: pathToFileURL(NAV).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, Chips, createRoot, act, dom, action, nav, CODE;
const roots = new Set();

before(async () => {
  writeFileSync(ACTION, [
    'export const calls = [];',
    "export let joinReply = { ok: true, leagueId: 77, name: 'The Pals' };",
    "export let createReply = { ok: true, leagueId: 78, joinCode: 'ABC234' };",
    'export function setJoin(r) { joinReply = r; }',
    'export function setCreate(r) { createReply = r; }',
    "export async function joinLeagueAction(fd) { calls.push({ kind: 'join', code: fd.get('code') }); return joinReply; }",
    "export async function createLeagueAction(fd) { calls.push({ kind: 'create', name: fd.get('name') }); return createReply; }",
  ].join('\n') + '\n');
  writeFileSync(NAV, [
    'export const pushed = [];',
    'export let refreshed = 0;',
    'export function useRouter() { return { push: (h) => pushed.push(h), refresh: () => { refreshed += 1; } }; }',
    'export function useSearchParams() { return new URLSearchParams(); }',
    'export function reset() { pushed.length = 0; refreshed = 0; }',
    'export function counts() { return { refreshed }; }',
  ].join('\n') + '\n');
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/run/board' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  React = await import('react'); ({ act } = React);
  ({ createRoot } = await import('react-dom/client'));
  Chips = (await import('./LeagueChipActions.js')).default;
  action = await import(pathToFileURL(ACTION).href);
  nav = await import(pathToFileURL(NAV).href);
  CODE = await import('../../lib/leagues/code.js');
});
afterEach(() => {
  for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } }
  roots.clear(); action.calls.length = 0; nav.reset();
  action.setJoin({ ok: true, leagueId: 77, name: 'The Pals' });
  action.setCreate({ ok: true, leagueId: 78, joinCode: 'ABC234' });
});
after(() => { for (const f of [ACTION, NAV]) { try { unlinkSync(f); } catch { /* gone */ } } });

async function mount(props = {}) {
  const el = document.getElementById('root');
  const root = createRoot(el); roots.add(root);
  await act(async () => {
    root.render(React.createElement(Chips, { boardHref: '/run/board', signedIn: true, signinHref: '/signin', ...props }));
  });
  return el;
}
const chip = (el, label) => [...el.querySelectorAll('.lgc-chip')].find((b) => b.textContent === label);
/**
 * TYPE INTO A REACT-CONTROLLED INPUT. Assigning `input.value` directly is not
 * enough: React caches the last value it wrote on the node, sees no change, and
 * drops the event - so the first draft of this file "passed" a bad-code test with
 * a field that had never received a character (empty is also not a code, which is
 * how the test lied). The native setter is what React's own tracker watches.
 */
const type = async (input, value) => {
  const set = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    set.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
};

test('THE TWO CHIPS ARE THERE, and neither opens anything until it is tapped', async () => {
  const el = await mount();
  assert.ok(chip(el, '+ Join'), 'a Join chip');
  assert.ok(chip(el, '+ Create'), 'a Create chip');
  assert.equal(el.querySelector('.lgc-sheet'), null, 'and no sheet yet');
  await act(async () => { chip(el, '+ Join').click(); });
  assert.ok(el.querySelector('.lgc-sheet'), 'the sheet opens');
  assert.equal(chip(el, '+ Join').getAttribute('aria-expanded'), 'true');
  assert.equal(el.querySelector('.lgc-in').getAttribute('aria-label'), 'League code');
  assert.equal(el.querySelector('.lgc-in').placeholder, `${CODE.CODE_LENGTH}-character code`);
});

test('A BAD CODE SHOWS THE SAME REFUSAL, and never reaches the server', async () => {
  const el = await mount();
  await act(async () => { chip(el, '+ Join').click(); });
  await type(el.querySelector('.lgc-in'), 'ABC');          // three characters
  // THE FIELD REALLY HOLDS THEM. Without this the test passes on an EMPTY field,
  // because empty is also "not a code" - which is exactly how it passed before
  // the typing helper was fixed.
  assert.equal(el.querySelector('.lgc-in').value, 'ABC');
  await act(async () => { el.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });

  const err = el.querySelector('.lgc-err');
  assert.ok(err, 'a refusal is shown');
  // THE SERVER'S OWN SENTENCE, from lib/leagues/code.js - not a copy written in
  // the component, and the same string joinLeague() returns.
  assert.equal(err.textContent, CODE.REFUSALS.not_a_code);
  assert.equal(err.textContent, 'Codes are six characters');
  assert.equal(err.getAttribute('role'), 'alert');
  // A SUBMIT THAT CANNOT SUCCEED COSTS NO ROUND TRIP.
  assert.equal(action.calls.length, 0, 'the action was never called');
  assert.deepEqual(nav.pushed, [], 'and nowhere was navigated');
});

test("A SERVER REFUSAL IS RENDERED AS HANDED OVER - no league with that code", async () => {
  const el = await mount();
  action.setJoin({ ok: false, reason: CODE.REFUSALS.no_league });
  await act(async () => { chip(el, '+ Join').click(); });
  await type(el.querySelector('.lgc-in'), 'ABC234');
  await act(async () => { el.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
  assert.equal(action.calls.length, 1, 'a full code DOES reach the server');
  assert.equal(action.calls[0].code, 'ABC234');
  assert.equal(el.querySelector('.lgc-err').textContent, 'No league with that code');
  assert.deepEqual(nav.pushed, [], 'a refused join does not navigate');
});

test('PASTE OR TYPE: the field cleans at the keystroke, so a hyphenated paste is a code', async () => {
  const el = await mount();
  await act(async () => { chip(el, '+ Join').click(); });
  const input = el.querySelector('.lgc-in');
  await type(input, 'abcd-ef ');
  assert.equal(input.value, 'ABCDEF', 'upper-cased, hyphen and space dropped');
  // AND THE CONFUSABLES ARE NOT IN THE ALPHABET, so they never land.
  await type(input, 'a0b1c!d');
  assert.equal(input.value, 'ABCD');
  await act(async () => { el.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
  assert.equal(el.querySelector('.lgc-err').textContent, CODE.REFUSALS.not_a_code, 'four characters is still not six');
});

test('A GOOD CODE JOINS AND LANDS ON THE BOARD, filtered to the league', async () => {
  const el = await mount();
  await act(async () => { chip(el, '+ Join').click(); });
  await type(el.querySelector('.lgc-in'), 'abc234');
  await act(async () => { el.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
  assert.deepEqual(action.calls, [{ kind: 'join', code: 'ABC234' }]);
  assert.deepEqual(nav.pushed, ['/run/board?league=77'], 'the board, filtered');
  assert.equal(nav.counts().refreshed, 1, 'and the server list re-reads');
  assert.equal(el.querySelector('.lgc-sheet'), null, 'the sheet closes behind it');
});

test('CREATE NAMES THE LEAGUE AND SHOWS THE CODE AND A LINK THAT EXISTS', async () => {
  const el = await mount();
  await act(async () => { chip(el, '+ Create').click(); });
  const input = el.querySelector('.lgc-in');
  assert.equal(input.getAttribute('aria-label'), 'New league name');
  // THREE CHARACTERS AT LEAST - validateLeagueName's floor, so the button does
  // not offer a submit the server will refuse.
  await type(input, 'ab');
  assert.equal(el.querySelector('.lgc-go').disabled, true);
  await type(input, 'The Pals');
  assert.equal(el.querySelector('.lgc-go').disabled, false);
  await act(async () => { el.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });

  assert.deepEqual(action.calls, [{ kind: 'create', name: 'The Pals' }]);
  assert.equal(el.querySelector('.lgc-code').textContent, 'ABC234', 'the code, big');
  const link = el.querySelector('.lgc-link');
  assert.equal(link.getAttribute('href'), '/leagues?join=ABC234');
  assert.equal(link.textContent, '/leagues?join=ABC234');
  // NOT THE DEAD ONE. /leagues/join/<code> 404s - there is no such route.
  assert.doesNotMatch(link.getAttribute('href'), /\/leagues\/join\//);
  // RELATIVE, ALWAYS: inside the container a tap must stay in the container.
  assert.doesNotMatch(link.getAttribute('href'), /^https?:|sportsvyn\.com/);
  // NOBODY IS NAVIGATED AWAY - the code is the point, and it is still on screen.
  assert.deepEqual(nav.pushed, []);
});

test('A CREATE REFUSAL IS THE SERVER\'S SENTENCE, and the sheet stays open', async () => {
  const el = await mount();
  action.setCreate({ ok: false, reason: 'Three characters at least' });
  await act(async () => { chip(el, '+ Create').click(); });
  await type(el.querySelector('.lgc-in'), 'The Pals');
  await act(async () => { el.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
  assert.equal(el.querySelector('.lgc-err').textContent, 'Three characters at least');
  assert.ok(el.querySelector('.lgc-sheet'), 'still open, so it can be corrected');
  assert.equal(el.querySelector('.lgc-code'), null, 'and no code is invented');
});

test('SIGNED OUT GETS A SIGN-IN LINE, not a dead form', async () => {
  const el = await mount({ signedIn: false, signinHref: '/signin?next=%2Frun%2Fboard' });
  await act(async () => { chip(el, '+ Join').click(); });
  assert.equal(el.querySelector('form'), null, 'no form to submit into nothing');
  const a = el.querySelector('.lgc-h a');
  assert.equal(a.getAttribute('href'), '/signin?next=%2Frun%2Fboard');
  assert.match(el.querySelector('.lgc-h').textContent, /Sign in to join a league\./);
});

test('NO WEB-ONLY STEP, and the Run board mounts the chips', () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const comp = strip(readFileSync(path.join(REPO, 'components/leagues/LeagueChipActions.js'), 'utf8'));
  const board = strip(readFileSync(path.join(REPO, 'app/run/board/page.js'), 'utf8'));
  // The component names no origin and opens no window.
  assert.doesNotMatch(comp, /sportsvyn\.com|https?:\/\//);
  assert.doesNotMatch(comp, /window\.open|target="_blank"/);
  // The board mounts it, and no longer tells anybody to go to /leagues.
  assert.match(board, /<LeagueChipActions/);
  assert.doesNotMatch(board, /Create a league from \/leagues/);
  assert.doesNotMatch(board, /leagues\/join\//, 'the 404 link is gone');
  // AND THE CRUMB HAS ITS SEPARATOR - item 2.
  assert.match(board, /rn-crumb-sep/);
  assert.match(strip(readFileSync(path.join(REPO, 'app/october/board/page.js'), 'utf8')), /oc-crumb-sep/);
});
