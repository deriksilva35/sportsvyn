// app/dailyBlue.test.mjs - THE DAILY BLUE IS THE DAILY'S (mon-2).
//
// --tok-daily (#245BFF) is the Play lobby's Daily banner and nothing else:
// a blue anywhere else on the Play tab would say "this is the Daily" about
// something that is not. This walks EVERY stylesheet and script under app/,
// components/ and lib/ (a guard cannot see a file it does not name) and holds
// the token to the one stylesheet that draws the banner. It also pins the
// token's value in both themes, and the contrast of what is drawn on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrastRatio } from '../lib/brand/contrast.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BANNER_CSS = 'components/games/dailyBanner.css';
const DAILY_BLUE = '#245BFF';
const css = readFileSync(path.join(REPO, 'app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules' && !name.startsWith('.')) walk(p, out); continue; }
    if (/\.(css|js|mjs|jsx)$/.test(name) && !/\.test\.mjs$/.test(name)) out.push(p);
  }
  return out;
}

const blockOf = (sel) => {
  const m = new RegExp(`(?:^|\\n)${sel.replace(/[[\]()"=]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(m, `a ${sel} block`);
  return m[1];
};
const valueIn = (body, name) => new RegExp(`${name}:\\s*([^;]+);`).exec(body)?.[1]?.trim() ?? null;

test('--tok-daily is #245BFF in BOTH themes, its ink white', () => {
  const dark = blockOf(':root');
  const arcade = blockOf(':root[data-theme="arcade"]');
  assert.equal(valueIn(dark, '--tok-daily'), DAILY_BLUE);
  assert.equal(valueIn(arcade, '--tok-daily'), DAILY_BLUE, 'the blue is the Daily\'s, not the theme\'s');
  assert.equal(valueIn(dark, '--tok-on-daily'), '#FFFFFF');
  assert.equal(valueIn(arcade, '--tok-on-daily'), '#FFFFFF');
});

test('ONLY THE DAILY BANNER reads --tok-daily: every file under app/, components/, lib/ walked and counted', () => {
  const users = {};
  let walked = 0;
  for (const root of ['app', 'components', 'lib']) {
    for (const abs of walk(path.join(REPO, root))) {
      walked += 1;
      const rel = path.relative(REPO, abs).split(path.sep).join('/');
      if (rel === 'app/globals.css') continue; // the definition
      const n = (readFileSync(abs, 'utf8').match(/var\(\s*--tok(?:-on)?-daily\b/g) ?? []).length;
      if (n) users[rel] = n;
    }
  }
  assert.ok(walked > 500, `walked the tree (${walked} files)`);
  assert.deepEqual(Object.keys(users), [BANNER_CSS], `--tok-daily is the banner's alone: ${JSON.stringify(users)}`);
  // and inside that file, only the banner's own .pd rules
  const banner = readFileSync(path.join(REPO, BANNER_CSS), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of banner.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (/--tok-daily/.test(m[2])) for (const sel of m[1].split(',')) assert.match(sel.trim(), /^\.pd(?:[-.\s:]|$)/, sel.trim());
  }
});

test('WHAT SITS ON THE BLUE IS LEGIBLE: white ink and volt (eyebrow, score, button fill) clear AA', () => {
  const VOLT = '#D4FF00';
  assert.ok(contrastRatio('#FFFFFF', DAILY_BLUE) >= 4.5, `white on blue ${contrastRatio('#FFFFFF', DAILY_BLUE).toFixed(2)}`);
  assert.ok(contrastRatio(VOLT, DAILY_BLUE) >= 4.5, `volt on blue ${contrastRatio(VOLT, DAILY_BLUE).toFixed(2)}`);
  // the volt buttons carry their own ink: navy (arcade) / near-black (dark)
  for (const ink of ['#1A1650', '#0A0A0A']) assert.ok(contrastRatio(ink, VOLT) >= 7, `${ink} on volt`);
});
