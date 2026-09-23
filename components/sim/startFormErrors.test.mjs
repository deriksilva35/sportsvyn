// components/sim/startFormErrors.test.mjs - the room's refusals, in words.
//
// THE FILED DEFECT. StartForm printed `Could not start: ${res.reason}` for
// every reason it had no branch for, so a reader who picked a preset and a
// seat could be shown "Could not start: pool_too_small" - a token naming a
// constraint they have never heard of, suggesting nothing they can do.
//
// PRESSED, NOT PINNED. A source-regex on START_ERRORS would pass on a version
// of this file that built the map and never read it. These tap START and read
// the sentence off the screen.

import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../lib/testing/stubDir.mjs';

install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// NO TEMP COPY OF THE COMPONENT. nextResolve's LOAD hook transforms repo JSX
// on the way in and strips the 'use client' banner, so StartForm imports
// directly - which also keeps a vanishing .mjs out of components/, where
// eslint reads mid-run (the weekly-hdr relay lost an afternoon to that).
// The two STUBS still have to be files, because they stand in for modules
// that must not run; they live outside the repo for the same reason.
const STUB = stubPath('__sfe_sim.mjs');
const NAV = stubPath('__sfe_nav.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === '@/app/actions/sim') return { url: pathToFileURL(STUB).href, shortCircuit: true };
  if (spec === 'next/navigation') return { url: pathToFileURL(NAV).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React; let createRoot; let act; let StartForm; let dom; let stub;
const roots = new Set();

const PRESETS = [{
  id: 20, name: 'The Weekly Six', teams_count: 12, scoring_format: 'ppr',
  roster_slots: { QB: 1, RB: 1, WR: 1, TE: 1, FLEX: 2 },
  pick_timer_seconds: 30, is_preset: true, default_sort: null,
}];

before(async () => {
  writeFileSync(STUB, `
    export let nextResult = { ok: true, draftId: 1 };
    export function setNext(r) { nextResult = r; }
    export async function startDraft() { return nextResult; }
    export async function startCustomDraft() { return nextResult; }
  `);
  writeFileSync(NAV, `
    export function useRouter() { return { push() {}, replace() {}, refresh() {} }; }
    export function useSearchParams() { return new URLSearchParams(); }
    export function usePathname() { return '/sim'; }
  `);
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/sim' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  stub = await import(pathToFileURL(STUB).href);
  StartForm = (await import('./StartForm.js')).default;
});
afterEach(() => {
  for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } }
  roots.clear(); document.getElementById('root').innerHTML = '';
});
after(() => { for (const f of [STUB, NAV]) { try { unlinkSync(f); } catch { /* gone */ } } });

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const click = (el) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });

async function form() {
  const c = document.getElementById('root');
  const root = createRoot(c); roots.add(root);
  act(() => root.render(React.createElement(StartForm, {
    presets: PRESETS, canStart: true, used: 0, limit: 0, member: false,
  })));
  return c;
}
const startButton = (c) => [...c.querySelectorAll('button')]
  .find((b) => /^(start|draft)/i.test((b.textContent || '').trim()));
const noteText = (c) => (c.textContent || '').replace(/\s+/g, ' ');

async function refuseWith(reason) {
  const c = await form();
  stub.setNext({ ok: false, reason });
  const b = startButton(c);
  assert.ok(b, 'START is on the screen');
  await click(b);
  await tick(); await tick();
  return noteText(c);
}

test('pool_too_small says what the reader can DO, and never says pool_too_small', async () => {
  const t = await refuseWith('pool_too_small');
  assert.match(t, /needs more players than the board has/i);
  assert.match(t, /fewer rounds or a smaller league/i);
  assert.equal(/pool_too_small/.test(t), false, 'the raw token never reaches the screen');
  assert.equal(/Could not start: /.test(t), false);
});

test('every reason the two start paths emit has a sentence', async () => {
  // These are the reasons startDraftFor and startCustomDraftFor actually
  // return - grepped from lib/fantasy/drafts.js, not invented here.
  for (const reason of ['no_pool', 'preset_not_found', 'league_not_found',
    'no_seat', 'bad_seat', 'bad_position']) {
    const t = await refuseWith(reason);
    assert.equal(t.includes(reason), false, `${reason} leaked to the screen`);
    assert.equal(/Could not start: /.test(t), false, `${reason} fell through to the raw branch`);
    afterEachInline();
  }
});
function afterEachInline() {
  for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } }
  roots.clear(); document.getElementById('root').innerHTML = '';
}

test('AN UNKNOWN REASON STILL GETS A SENTENCE, not a token', async () => {
  // The default exists for the reason the defect existed: a new refusal added
  // in lib/ must not reach a reader as a variable name.
  const t = await refuseWith('some_future_reason_nobody_wrote_copy_for');
  assert.match(t, /Could not start\. Try again in a moment\./);
  assert.equal(/some_future_reason/.test(t), false);
});

test('invalid_config keeps its own line, with the detail it carries', async () => {
  const c = await form();
  stub.setNext({ ok: false, reason: 'invalid_config', detail: 'rounds must be at least 1' });
  await click(startButton(c));
  await tick(); await tick();
  assert.match(noteText(c), /isn't valid \(rounds must be at least 1\)/);
});
