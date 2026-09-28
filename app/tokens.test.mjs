// app/tokens.test.mjs - tokens v2: one source, and R0 moves no pixel.
//
// THREE CLAIMS, each the thing that would silently break:
//   1. THE ARCADE PALETTE IS THE RULING'S, verbatim (--arcade-*). A typo here is
//      the whole site wrong on the day R1 flips.
//   2. EVERY OLD NAME RESOLVES THROUGH THE SEMANTIC LAYER, and in R0 lands on
//      exactly the value it had before - resolved here by following var() chains
//      in app/globals.css itself, not by trusting the comments.
//   3. THE RATCHET: no file gains a colour literal (lib/brand/hexCensus.js against
//      lib/brand/hexBaseline.json). R2 lowers the ceiling as it retires them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hexCensus } from '../lib/brand/hexCensus.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(path.join(REPO, 'app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the FIRST block whose selector matches exactly (:root or @theme). */
function block(sel, nth = 0) {
  const re = new RegExp(`(^|\\n)${sel.replace(/[[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  const all = [...css.matchAll(re)];
  assert.ok(all[nth], `a ${sel} block (#${nth})`);
  return Object.fromEntries([...all[nth][2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const rootTokens = block(':root', 0);   // tokens v2
const theme = block('@theme', 0);
const rootAliases = block(':root', 1);
const surface = block('[data-surface]', 0);
const ALL = { ...rootTokens, ...theme, ...rootAliases };
/** Follow var(--x) through the global declarations (and a surface's, when given). */
function resolve(name, scope = {}) {
  let v = scope[name] ?? ALL[name];
  for (let i = 0; i < 10 && v; i++) {
    const m = /^var\((--[\w-]+)\)$/.exec(v);
    if (!m) return v;
    v = scope[m[1]] ?? ALL[m[1]];
  }
  return v;
}

test('THE ARCADE PALETTE is the ruling\'s, verbatim', () => {
  const spec = {
    '--arcade-page': '#FFFFFF', '--arcade-surface': '#F6F5FF', '--arcade-surface-2': '#ECEAFB',
    '--arcade-ink': '#0E0B2B', '--arcade-muted': '#5A5680', '--arcade-primary': '#1A1650',
    '--arcade-on-primary': '#D4FF00', '--arcade-chip': '#2447FF', '--arcade-live': '#D6006F',
    '--arcade-up': '#1B8A5A', '--arcade-coin': '#B7791F', '--arcade-line': '#DCD9F5',
    '--arcade-radius-lg': '20px', '--arcade-radius-md': '14px', '--arcade-shadow-card': '0 4px 0 #1A1650',
  };
  for (const [k, v] of Object.entries(spec)) assert.equal(rootTokens[k], v, k);
});

test('EVERY SEMANTIC ROLE EXISTS, and in R0 each holds today\'s dark value', () => {
  const r0 = {
    '--tok-page': '#0A0A0A', '--tok-surface': '#141414', '--tok-surface-2': '#1C1C1C', '--tok-ink': '#F5F5F2',
    '--tok-muted': '#888888', '--tok-primary': '#141414', '--tok-on-primary': '#D4FF00', '--tok-accent': '#D4FF00',
    '--tok-chip': '#245BFF', '--tok-live': '#E63946', '--tok-up': '#2A8A4F', '--tok-down': '#B8410F',
    '--tok-coin': '#B7791F', '--tok-line': '#2E2E2E',
  };
  for (const [k, v] of Object.entries(r0)) assert.equal(rootTokens[k], v, k);
  for (const k of ['--tok-radius-lg', '--tok-radius-md', '--tok-shadow-card', '--tok-font-display', '--tok-font-body', '--tok-font-num']) assert.ok(rootTokens[k], k);
});

test('R0 MOVES NO PIXEL: every old name reads the semantic layer and resolves to the value it had', () => {
  const before = {
    '--color-ink': '#0A0A0A', '--color-paper-warm': '#F5F5F2', '--color-volt': '#D4FF00', '--color-muted': '#888888',
    '--color-jade': '#2A8A4F', '--color-terra': '#B8410F', '--color-live-red': '#E63946', '--color-rule-dark': '#2E2E2E',
    '--ink': '#0A0A0A', '--paper-warm': '#F5F5F2', '--volt': '#D4FF00', '--muted': '#888888', '--jade': '#2A8A4F',
    '--terra': '#B8410F', '--rule': '#2E2E2E', '--paper': '#F5F5F2', '--live': '#E63946', '--ink-2': '#141414',
    '--ink-3': '#1C1C1C', '--blue': '#245BFF', '--line': '#2A2A2A', '--rule-dim': '#1F1F1F',
  };
  for (const [k, v] of Object.entries(before)) assert.equal(resolve(k), v, `${k} outside a surface`);
  const inSurface = {
    '--ink': '#0A0A0A', '--paper': '#F5F5F2', '--muted': '#888888', '--volt': '#D4FF00', '--live': '#E63946',
    '--jade': '#2A8A4F', '--terra': '#B8410F', '--rule': '#2E2E2E', '--volt-dim': '#8FAA00', '--paper-dim': '#C5C5C2',
  };
  for (const [k, v] of Object.entries(inSurface)) assert.equal(resolve(k, surface), v, `${k} inside [data-surface]`);
  for (const k of ['--color-ink', '--color-paper-warm', '--color-volt', '--color-live-red']) assert.match(theme[k], /^var\(--tok-/, `${k} is one source`);
  assert.match(css, /body \{[^}]*font-family: var\(--tok-font-body\)/, 'the body face is a token too');
});

test('THE ARCADE FACES are loaded - Rubik 500/700/800/900 and Rubik Mono One - and nothing reads them yet', () => {
  const layout = readFileSync(path.join(REPO, 'app/layout.js'), 'utf8');
  assert.match(layout, /Rubik\(\{\s*variable: "--font-rubik",\s*weight: \["500", "700", "800", "900"\]/);
  assert.match(layout, /Rubik_Mono_One\(\{\s*variable: "--font-rubik-mono"/);
  assert.match(layout, /\$\{rubik\.variable\} \$\{rubikMono\.variable\}/);
  assert.equal((layout.match(/preload: false/g) ?? []).length, 2, 'no request until R1 uses them');
  assert.doesNotMatch(css, /--font-rubik/, 'R0: no token points at Rubik yet');
});

test('THE RATCHET: no file gains a colour literal outside the tokens', () => {
  const base = JSON.parse(readFileSync(path.join(REPO, 'lib/brand/hexBaseline.json'), 'utf8'));
  const now = hexCensus(REPO);
  const grew = Object.entries(now.byFile).filter(([f, n]) => n > (base.byFile[f] ?? 0)).map(([f, n]) => `${f}: ${base.byFile[f] ?? 0} -> ${n}`);
  assert.deepEqual(grew, [], 'use a token (app/globals.css --tok-*) - or, when retiring literals, lower the ceiling with node scripts/hex-census.mjs --write');
  assert.ok(now.total <= base.total, `total ${now.total} > ceiling ${base.total}`);
});
