// app/run/runCrumb.test.mjs - /run's crumb, RENDERED.
//
// "‹ Bracket League board ›" was two adjacent anchors with nothing between
// them - one run-together phrase. It reads "Bracket · League board", with the
// same separator /run/board's crumb already carries.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../lib/testing/stubDir.mjs';

install();

const F = (n) => stubPath(`__rc_${n}.mjs`);
const MAP = {
  'next/link': 'link', '@/auth': 'auth',
  '@/components/GlobalHeaderServer': 'hdr', '@/components/SiteFooter': 'foot',
  '@/lib/shell/shell': 'shell', '@/lib/shell/signinHref': 'signin',
  '@/lib/run/create': 'create', '@/lib/run/entry': 'entry',
  '@/lib/leagues/core': 'leagues', '@/components/run/RunRoster': 'roster',
};
const NAMES = [...new Set([...Object.values(MAP), 'css'])];
registerHooks({ resolve(spec, ctx, next) {
  if (MAP[spec]) return { url: pathToFileURL(F(MAP[spec])).href, shortCircuit: true };
  if (spec.endsWith('.css')) return { url: pathToFileURL(F('css')).href, shortCircuit: true };
  return next(spec, ctx);
} });

let renderToStaticMarkup, Page, createStub;
before(async () => {
  writeFileSync(F('link'), "import React from 'react'; export default function Link({href,children,...r}){return React.createElement('a',{...r,href:String(href)},children);}\n");
  writeFileSync(F('auth'), 'export async function auth(){return null;}\n');
  writeFileSync(F('hdr'), 'export default function H(){return null;}\n');
  writeFileSync(F('foot'), 'export default function F(){return null;}\n');
  writeFileSync(F('roster'), 'export default function R(){return null;}\n');
  writeFileSync(F('css'), 'export default {};\n');
  writeFileSync(F('shell'), 'export async function resolveShellMode() { return { isShell: false }; }\n');
  writeFileSync(F('signin'), "export function shellSigninHref(p) { return '/signin?next=' + p; }\n");
  writeFileSync(F('create'), [
    'export let round = { id: 23 };',
    'export function setRound(v) { round = v; }',
    'export async function currentRunRound() { return round; }',
  ].join('\n') + '\n');
  writeFileSync(F('entry'), 'export async function runView(uid, c) { return c ? { phase: "open", contest: c } : null; }\n');
  writeFileSync(F('leagues'), 'export async function myLeagues() { return []; }\n');
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  createStub = await import(pathToFileURL(F('create')).href);
  Page = (await import('./page.js')).default;
});
after(() => { for (const n of NAMES) { try { unlinkSync(F(n)); } catch { /* gone */ } } });

test('THE CRUMB READS "Bracket · League board" - the separator was missing', async () => {
  createStub.setRound({ id: 23 });
  const h = renderToStaticMarkup(await Page());
  assert.match(h, /Bracket<\/a><span class="rn-crumb-sep" aria-hidden="true">·<\/span><a href="\/run\/board">League board/);
});

test('NO ROUND, NO BOARD LINK - and no orphaned separator', async () => {
  createStub.setRound(null);
  const h = renderToStaticMarkup(await Page());
  assert.match(h, /Bracket<\/a>/);
  assert.doesNotMatch(h, /League board/);
  assert.doesNotMatch(h, /rn-crumb-sep/);
});
