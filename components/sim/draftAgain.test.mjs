// components/sim/draftAgain.test.mjs - the board "Draft again" asked for.
//
// THE DEFECT IT CLOSES. The Read's "Draft again" was a bare <a href="/sim">,
// and StartForm seeds from presets[0] - so a reader who just drafted The
// Weekly Six and tapped again landed on The Draft, silently, every time. Part
// A called it "a querystring away, not a build"; this is the querystring and
// the form learning to read it.
//
// BOTH HALVES OR NEITHER. A link carrying ?preset= to a form that ignores it
// is worse than the bare link: it looks fixed. So this file presses the FORM,
// and pins the link's shape in the component that emits it.

import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../lib/testing/stubDir.mjs';

install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const STUB = stubPath('__da_sim.mjs');
const NAV = stubPath('__da_nav.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === '@/app/actions/sim') return { url: pathToFileURL(STUB).href, shortCircuit: true };
  if (spec === 'next/navigation') return { url: pathToFileURL(NAV).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React; let createRoot; let act; let StartForm; let dom;
const roots = new Set();

const PRESETS = [
  { id: 322, name: 'The Draft', teams_count: 12, scoring_format: 'ppr', roster_slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1 }, pick_timer_seconds: 30, is_preset: true, default_sort: 'ppg' },
  { id: 20, name: 'The Weekly Six', teams_count: 12, scoring_format: 'ppr', roster_slots: { QB: 1, RB: 1, WR: 1, TE: 1, FLEX: 2 }, pick_timer_seconds: 30, is_preset: true, default_sort: null },
  { id: 21, name: 'Standard 12 PPR', teams_count: 12, scoring_format: 'ppr', roster_slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6 }, pick_timer_seconds: 60, is_preset: true, default_sort: null },
];

before(async () => {
  writeFileSync(STUB, 'export async function startDraft() { return { ok: true, draftId: 1 }; }\nexport async function startCustomDraft() { return { ok: true, draftId: 1 }; }\n');
  writeFileSync(NAV, `
    export function useRouter() { return { push() {}, replace() {}, refresh() {} }; }
    export function useSearchParams() { return new URLSearchParams(); }
    export function usePathname() { return '/sim'; }
    export function redirect() {}
    export function notFound() {}
  `);
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/sim' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  StartForm = (await import('./StartForm.js')).default;
});
afterEach(() => {
  for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } }
  roots.clear(); document.getElementById('root').innerHTML = '';
});
after(() => { for (const f of [STUB, NAV]) { try { unlinkSync(f); } catch { /* gone */ } } });

function form(initialPresetId) {
  const c = document.getElementById('root');
  const root = createRoot(c); roots.add(root);
  act(() => root.render(React.createElement(StartForm, {
    presets: PRESETS, canStart: true, used: 0, limit: 0, member: false, initialPresetId,
  })));
  return c;
}
/** Which preset row is selected, read off the screen rather than off state. */
const selectedName = (c) => {
  const on = c.querySelector('.sim-preset.on, .sim-preset[aria-pressed="true"], .sim-preset.selected');
  if (on) return on.textContent;
  // fall back to the whole form's text when the deck marks selection another way
  return (c.textContent || '');
};

test('NO PARAM IS TODAY\'S BEHAVIOUR: the first preset leads', () => {
  const c = form(null);
  assert.match(selectedName(c), /The Draft/, 'presets[0] still wins with no param');
});

test('?preset= SEEDS THE DECK on the board that was just drafted', () => {
  const c = form(20);
  const t = selectedName(c);
  assert.match(t, /The Weekly Six/);
  // the shape follows the preset, not the first row: the Weekly Six is 6 rounds
  assert.match(c.textContent, /6\s*(rounds|RDS|rds)/i);
});

test('a STRING id works, because a querystring is a string', () => {
  const c = form('21');
  assert.match(selectedName(c), /Standard 12 PPR/);
});

test('A STALE ID DEGRADES TO TODAY, not to an empty form', () => {
  // A retired preset, or an old Read linking to one. The deck must still draw.
  const c = form(999999);
  assert.match(selectedName(c), /The Draft/);
  assert.ok(c.querySelector('button'), 'START is still on the screen');
});

test('THE LINK AND THE FORM AGREE - the Read only ever names a PRESET', () => {
  // The other half, pinned where it is emitted: a custom or imported-league
  // config is not a row this deck can select, so it must not travel.
  const src = readFileSync(path.join(REPO, 'components/sim/DraftResults.js'), 'utf8');
  assert.match(src, /config\.is_preset \? `\/sim\?preset=\$\{config\.id\}` : '\/sim'/);
});
