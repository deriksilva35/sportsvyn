// app/darkParity.test.mjs - THE DARK PAGE DOES NOT MOVE.
//
// Every stylesheet in the repo, resolved on the dark page (no data-theme),
// on THIS tree and on the base branch (origin/main, or DARK_PARITY_BASE),
// compared rule by rule. See lib/brand/darkParity.js for the rule and the
// 28 Sep incident that made it. A failure prints every changed declaration.
//
// NEW STYLESHEETS are compared against nothing and so are not counted here:
// a file main does not have cannot have moved main's pixels.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { darkGlobals, resolvedDark, diffDark, compareValues } from '../lib/brand/darkParity.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.DARK_PARITY_BASE || 'origin/main';
const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const atBase = (f) => { try { return git('show', `${BASE}:${f}`); } catch { return null; } };
const atHead = (f) => readFileSync(path.join(REPO, f), 'utf8');

test('the comparator: grey steps pass, everything else fails', () => {
  assert.equal(compareValues('1px solid #2a2a2a', '1px solid #2e2e2e'), null, 'a grey step is within 1.2%');
  assert.equal(compareValues('#111', '#141414'), null);
  assert.match(compareValues('#d4ff00', '#141414'), /luminance/);
  assert.match(compareValues('rgba(212,255,0,.07)', '#141414'), /alpha/);
  assert.match(compareValues('14px', '20px'), /shape/);
  assert.match(compareValues('1px solid #2a2a2a', '2px solid #2a2a2a'), /shape/);
  assert.match(compareValues('linear-gradient(160deg,#1a2000,#141414)', '#141414'), /shape/);
  assert.equal(compareValues(null, 'block'), 'added');
  assert.equal(compareValues('flex', null), 'removed');
});

test(`THE DARK PAGE RESOLVES THE SAME as ${BASE} (luminance <= 1.2%, no shape change)`, () => {
  try { git('rev-parse', '--verify', BASE); } catch { assert.fail(`base ${BASE} is not available - fetch it`); }
  const files = git('ls-files', '*.css').split('\n').filter(Boolean);
  const gBase = darkGlobals(atBase('app/globals.css') ?? '');
  const gHead = darkGlobals(atHead('app/globals.css'));
  const report = [];
  let compared = 0;
  for (const f of files) {
    const before = atBase(f);
    if (before == null) continue; // new on this branch
    compared += 1;
    const diffs = diffDark(resolvedDark(before, gBase), resolvedDark(atHead(f), gHead));
    for (const d of diffs) report.push(`${f}: ${d.key}  ${d.before ?? '(none)'} -> ${d.after ?? '(none)'}  [${d.why}]`);
  }
  assert.ok(compared > 50, `compared ${compared} stylesheets - the walk found too few`);
  assert.equal(report.length, 0, `${report.length} dark-page change(s) vs ${BASE}:\n${report.join('\n')}`);
});
