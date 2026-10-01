// lib/brand/hexCensus.js - how many colours are written down OUTSIDE the tokens.
//
// THE REBRAND'S RATCHET (R0 records it, R2 drives it down). A colour literal in a
// component is a colour the token layer (app/globals.css --tok-*) cannot move: the
// arcade theme flips everything that reads a token and nothing that does not. This
// counts them, per file, so the ratchet test (app/tokens.test.mjs) can refuse any
// file that gains one.
//
// COUNTED: #rgb / #rrggbb / #rrggbbaa and rgb()/rgba() literals, in .css/.js/.mjs
// under app/, components/ and lib/. A var(--x, #fallback) counts too - it is cheap
// to retoken but it is still a literal, and R2 retires the fallbacks as well.
// NOT COUNTED: tests; the token sources themselves (app/globals.css); and colour
// DATA that is not theme - lib/mlb/teamColors.js and lib/nba/teamColors.js (club
// colours) and lib/brand/ (the mark's own fill, the contrast helper, and this file).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const CENSUS_ROOTS = ['app', 'components', 'lib'];
export const CENSUS_EXEMPT = ['app/globals.css', 'lib/mlb/teamColors.js', 'lib/nba/teamColors.js', 'lib/brand/'];
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
const RGB = /\brgba?\(/g;

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name !== 'node_modules' && !name.startsWith('.')) walk(p, out); continue; }
    if (/\.(css|js|mjs)$/.test(name) && !/\.test\.mjs$/.test(name)) out.push(p);
  }
  return out;
}

/** { total, byFile: { 'app/x.css': n, ... } } for the repo at `repo`. Files with 0 are left out. */
export function hexCensus(repo) {
  const byFile = {};
  let total = 0;
  for (const root of CENSUS_ROOTS) {
    for (const abs of walk(path.join(repo, root), [])) {
      const rel = path.relative(repo, abs).split(path.sep).join('/');
      if (CENSUS_EXEMPT.some((e) => (e.endsWith('/') ? rel.startsWith(e) : rel === e))) continue;
      const t = readFileSync(abs, 'utf8');
      const n = (t.match(HEX) ?? []).length + (t.match(RGB) ?? []).length;
      if (n) { byFile[rel] = n; total += n; }
    }
  }
  return { total, byFile: Object.fromEntries(Object.entries(byFile).sort()) };
}
