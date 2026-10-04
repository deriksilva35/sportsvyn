// lib/brand/fontsLocal.test.mjs - THE FACES ARE IN THE REPO (sun-12 item 4).
//
// next/font/google fetches the font CSS and files from Google DURING THE BUILD.
// That fetch failed a production build on 1 Oct 2026 and two previews on 3-4 Oct
// ("Can't resolve '@vercel/turbopack-next/internal/font/google/font'"). The faces
// now load through next/font/local from app/fonts/. This walks EVERY source file
// in the repo (not a list of known ones) and fails on any next/font/google import,
// and checks that each file app/layout.js names exists, with its licence beside it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKIP = new Set(['node_modules', '.next', '.git', '.vercel', 'test-tmp', 'out', 'coverage']);
const SRC = /\.(m?[jt]sx?|cjs|css)$/;

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (SRC.test(e.name)) yield p;
  }
}

// Built from parts so this file does not match itself.
const GOOGLE = new RegExp(['next', 'font', 'google'].join('/'));
const IMPORT = new RegExp(`(from\\s*|import\\s*\\(?\\s*|require\\(\\s*)['"]${GOOGLE.source}['"]`);

test('NO FILE IMPORTS next/font/google: a build never fetches a font', () => {
  const files = [...walk(REPO)];
  assert.ok(files.length > 500, `walked ${files.length} source files - the walk reached the tree`);
  const offenders = files.filter((f) => IMPORT.test(readFileSync(f, 'utf8'))).map((f) => path.relative(REPO, f));
  assert.deepEqual(offenders, [], 'use next/font/local with the woff2 in app/fonts/ (see app/layout.js)');
});

test('the guard can see an import (it is not vacuous)', () => {
  for (const src of [`import { Saira } from "${['next', 'font', 'google'].join('/')}";`, `const f = require('${['next', 'font', 'google'].join('/')}')`])
    assert.match(src, IMPORT);
  assert.doesNotMatch('import localFont from "next/font/local";', IMPORT);
});

test('every face app/layout.js names is committed, woff2, with its OFL licence beside it', () => {
  const layout = readFileSync(path.join(REPO, 'app/layout.js'), 'utf8');
  assert.match(layout, /import localFont from "next\/font\/local"/);
  const paths = [...new Set([...layout.matchAll(/path: "(\.\/fonts\/[^"]+)"/g)].map((m) => m[1]))];
  assert.equal(paths.length, 10, `ten distinct files, got ${paths.length}`);
  for (const p of paths) {
    const abs = path.join(REPO, 'app', p);
    assert.ok(existsSync(abs), `${p} exists`);
    assert.match(p, /\.woff2$/);
    assert.equal(readFileSync(abs).subarray(0, 4).toString('latin1'), 'wOF2', `${p} is a woff2`);
    assert.ok(statSync(abs).size > 1000, `${p} is not empty`);
  }
  const fonts = readdirSync(path.join(REPO, 'app/fonts'));
  for (const lic of ['saira', 'sairacondensed', 'sourceserif4', 'jetbrainsmono', 'archivo', 'rubik', 'rubikmonoone'])
    assert.ok(fonts.includes(`OFL-${lic}.txt`), `OFL-${lic}.txt beside the files`);
  // The seven variables the stylesheets read are all still set on <html>.
  for (const v of ['--font-saira', '--font-saira-condensed', '--font-source-serif', '--font-jetbrains-mono', '--font-archivo', '--font-rubik', '--font-rubik-mono'])
    assert.match(layout, new RegExp(`variable: "${v}"`), v);
});

test('THE FAMILY NAMES: the variables point at real faces, and the Google names still exist', () => {
  const layout = readFileSync(path.join(REPO, 'app/layout.js'), 'utf8');
  const calls = Object.fromEntries([...layout.matchAll(/const (\w+) = localFont\(\{([\s\S]*?)\n\}\);/g)].map((m) => [m[1], m[2]]));
  // Turbopack names the --font-* variable after the const even when a declaration
  // renames the face (seen on the fonts-local preview, 4 Oct): a variable loader
  // with a font-family declaration points its variable at a face that is not there.
  for (const v of ['saira', 'sairaCondensed', 'sourceSerif', 'jetbrainsMono', 'archivo', 'rubik', 'rubikMono']) {
    assert.ok(calls[v], `${v} loader exists`);
    assert.doesNotMatch(calls[v], /prop: "font-family"/, `${v} keeps the const name as its family`);
  }
  // The multi-word names are written literally across the stylesheets.
  const face = { sairaCondensedFace: ['Saira Condensed', 'sairaCondensed'], sourceSerifFace: ['Source Serif 4', 'sourceSerif'],
    jetbrainsMonoFace: ['JetBrains Mono', 'jetbrainsMono'], rubikMonoFace: ['Rubik Mono One', 'rubikMono'] };
  const strip = (c) => c.replace(/\s*variable: "[^"]+",/, '').replace(/\s*declarations: \[[^\]]*\],/, '');
  for (const [alias, [name, twin]] of Object.entries(face)) {
    assert.ok(calls[alias], `${alias} loader exists`);
    assert.match(calls[alias], new RegExp(`value: "'${name}'"`), `${alias} declares '${name}'`);
    // Same files, same options as its twin, so the emitted URL is the same file.
    assert.equal(strip(calls[alias]), strip(calls[twin]), `${alias} mirrors ${twin}`);
    assert.match(layout, new RegExp(`\\$\\{${alias}\\.variable\\}`), `${alias} is on <html>`);
  }
});

test('THE SUBSETS: every face has its latin-ext twin, same family, same weight and style, disjoint ranges', () => {
  const layout = readFileSync(path.join(REPO, 'app/layout.js'), 'utf8');
  assert.match(layout, /import "\.\/fonts\/latin-ext\.css";/);
  const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
  const css = readFileSync(path.join(REPO, 'app/fonts/latin-ext.css'), 'utf8');
  const ext = [...css.matchAll(/@font-face \{([^}]*)\}/g)].map(([, b]) => ({
    family: /font-family: '([^']+)'/.exec(b)[1].toLowerCase(), style: /font-style: (\w+)/.exec(b)[1],
    weight: /font-weight: (\d+)/.exec(b)[1], src: /url\('\.\/([^']+)'\)/.exec(b)[1], range: /unicode-range: ([^;]+);/.exec(b)[1],
    display: /font-display: (\w+)/.exec(b)?.[1] }));
  for (const f of ext) {
    assert.ok(existsSync(path.join(REPO, 'app/fonts', f.src)), `${f.src} exists`);
    assert.match(f.range, /^U\+0100-02BA/, `${f.family} ${f.weight} is the latin-ext range`);
    assert.equal(f.display, 'swap');
  }
  const calls = [...layout.matchAll(/const (\w+) = localFont\(\{([\s\S]*?)\n\}\);/g)];
  assert.equal(calls.length, 11);
  let faces = 0;
  for (const [, name, body] of calls) {
    assert.ok(body.includes(`{ prop: "unicode-range", value: "${LATIN}" }`), `${name} carries Google's latin range`);
    const family = (/value: "'([^']+)'"/.exec(body)?.[1] ?? name).toLowerCase();
    for (const [, weight, style] of body.matchAll(/weight: "(\d+)", style: "(\w+)"/g)) {
      faces++;
      assert.ok(ext.some((f) => f.family === family && f.weight === weight && f.style === style), `${family} ${weight} ${style} has a latin-ext face`);
    }
  }
  assert.equal(ext.length, faces, 'one latin-ext face per latin face, no strays');
});
