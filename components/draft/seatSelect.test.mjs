// components/draft/seatSelect.test.mjs - press the seat: with hasHandle true
// the seat write fires and NO modal opens. This is the tap 168 players were
// getting a claim modal on instead (see lib/onboardingGate.test.mjs).
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { transformSync } from '@babel/core';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
install();
// next/navigation's useRouter needs the App Router context; outside Next it
// throws. A stub router is enough here - this test never navigates.
const STUB = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '__nav_stub.mjs')).href;
registerHooks({ resolve(spec, ctx, next) { return spec === 'next/navigation' ? { url: STUB, shortCircuit: true } : next(spec, ctx); } });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let React, createRoot, act, SeatSelect, dom, tmp; const roots = new Set();
let fetchCalls = [];

before(async () => {
  writeFileSync(path.join(__dirname, '__nav_stub.mjs'), 'export const useRouter = () => ({ push() {}, replace() {}, refresh() {} });\nexport const usePathname = () => \'/draft\';\nexport const useSearchParams = () => new URLSearchParams();\nexport const redirect = () => {};\nexport const notFound = () => {};\n');
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/draft' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  global.fetch = async (...a) => { fetchCalls.push(a); return { ok: true, json: async () => ({ draftId: 7 }) }; };
  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react')); ({ createRoot } = await import('react-dom/client'));
  const src = path.join(__dirname, 'SeatSelect.js');
  const out = transformSync(readFileSync(src, 'utf8'), { filename: src, presets: [['@babel/preset-react', { runtime: 'automatic' }]], configFile: false, babelrc: false }).code;
  tmp = path.join(__dirname, `__seat_test_${process.pid}.mjs`);
  writeFileSync(tmp, out.replace(/^'use client';\s*/m, ''));
  SeatSelect = (await import(pathToFileURL(tmp).href)).default;
});
afterEach(() => { for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } } roots.clear(); });
after(() => { for (const f of [tmp, path.join(__dirname, '__nav_stub.mjs')]) { try { unlinkSync(f); } catch { /* gone */ } } });

function render(hasHandle) {
  const container = document.getElementById('root'); const root = createRoot(container); roots.add(root);
  act(() => root.render(React.createElement(SeatSelect, {
    seats: Array.from({ length: 12 }, (_, i) => ({ seat: i + 1, round1Pick: i + 1, round2Pick: 24 - i })),
    teamsCount: 12, rounds: 8, clockSeconds: 30, signedIn: true, hasHandle,
  })));
  return container;
}
const click = (el) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
const seatButton = (c) => [...c.querySelectorAll('button.opt')].find((b) => b.textContent.trim() === '7');
// ONE BUTTON, ONE READING: 'Take a seat' unselected, 'Take seat N' once chosen.
const takeButton = (c) => [...c.querySelectorAll('button')].find((b) => /take (a )?seat/i.test(b.textContent));

test('WITH a handle: pick a seat, Take a seat -> the seat write fires and no modal opens', async () => {
  fetchCalls = [];
  const c = render(true);
  const s = seatButton(c); assert.ok(s, 'a seat button');
  await click(s);
  const t = takeButton(c); assert.ok(t, 'the Take a seat button');
  await click(t);
  assert.equal(fetchCalls.length, 1, 'exactly one POST');
  assert.equal(fetchCalls[0][0], '/api/draft/start');
  assert.equal(JSON.parse(fetchCalls[0][1].body).seat, 7);
  assert.equal(c.querySelector('input'), null, 'no claim modal (it renders an input) opened');
  assert.doesNotMatch(c.textContent, /claim|handle/i);
});

test('WITHOUT a handle: the same tap opens the claim modal and writes nothing', async () => {
  fetchCalls = [];
  const c = render(false);
  await click(seatButton(c)); await click(takeButton(c));
  assert.equal(fetchCalls.length, 0, 'no POST behind the modal');
  assert.ok(document.body.querySelector('input') || /handle/i.test(document.body.textContent), 'the claim modal is up');
});
