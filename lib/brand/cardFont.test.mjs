// lib/brand/cardFont.test.mjs - EVERY IMAGE CARD READS ITS FONT FROM DISK (sun-6).
//
// fetch(new URL('./font.woff', import.meta.url)) is "not implemented" on Vercel's
// Node runtime: the NFL mock card 500'd on PROD with it, and the NBA mock card did
// on its first preview. readFileSync on the same URL works (app/daily/[date]/card).
// This walks app/ for every route that renders an ImageResponse - a guard cannot
// see a file it does not name - and refuses the fetch form.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc); else if (e.name === 'route.js') acc.push(full);
  }
  return acc;
}

test('no image card fetches its font through import.meta.url', () => {
  const cards = walk(path.join(REPO, 'app')).filter((f) => readFileSync(f, 'utf8').includes('ImageResponse'));
  assert.ok(cards.length >= 3, `the walker sees the image cards (${cards.length})`);
  const code = (f) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const bad = cards.filter((f) => /fetch\(\s*new URL\([^)]*import\.meta\.url/.test(code(f)));
  assert.deepEqual(bad.map((f) => path.relative(REPO, f)), [], 'read the font with readFileSync(new URL(..., import.meta.url))');
});
