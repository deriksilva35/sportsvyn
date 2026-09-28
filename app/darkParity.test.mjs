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
import { darkGlobals, resolvedDark, diffDark, compareValues, reconcileIntent } from '../lib/brand/darkParity.js';

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

test('INTENT IS EXACT: undeclared, mismatched and stale all fail', () => {
  const d = [{ file: 'a.css', key: '.x { color }', before: null, after: '#fff', why: 'added' }];
  assert.deepEqual(reconcileIntent(d, [{ file: 'a.css', key: '.x { color }', after: '#fff' }]),
    { undeclared: [], mismatched: [], stale: [] }, 'declared exactly -> passes');
  assert.equal(reconcileIntent(d, []).undeclared.length, 1, 'an undeclared change fails');
  assert.equal(reconcileIntent(d, [{ file: 'a.css', key: '.x { color }', after: '#000' }]).mismatched.length, 1,
    'a declared change with a different value fails');
  assert.equal(reconcileIntent([], [{ file: 'a.css', key: '.x { color }', after: '#fff' }]).stale.length, 1,
    'a stale entry fails - the file is not a whitelist');
});

test('the intent file is well-formed: { changes: [{ file, key, after }] }', () => {
  // It is emptied in the commit that lands a declared change, so main carries
  // none between branches; the guard above is what enforces that it matches.
  const intent = JSON.parse(readFileSync(path.join(REPO, 'lib/brand/parity-intent.json'), 'utf8'));
  assert.ok(Array.isArray(intent.changes));
  for (const c of intent.changes) {
    assert.equal(typeof c.file, 'string'); assert.equal(typeof c.key, 'string');
    assert.ok(c.after === null || typeof c.after === 'string');
  }
});

test('@theme TOKENS RESOLVE, so a changed --color-* is caught', () => {
  const g1 = darkGlobals(':root { --tok-page: #0A0A0A; }\n@theme { --color-ink: var(--tok-page); --color-paper-warm: #F5F5F2; }\n@theme inline { --font-x: serif; }');
  assert.equal(g1['--color-paper-warm'], '#F5F5F2', '@theme is read');
  assert.equal(g1['--font-x'], 'serif', '@theme inline is read');
  const page = '.a { color: var(--color-paper-warm); background: var(--color-ink); }';
  const before = resolvedDark(page, g1);
  assert.equal(before.get('.a { color }'), '#f5f5f2', 'no ?--color- left');
  const g2 = darkGlobals(':root { --tok-page: #0A0A0A; }\n@theme { --color-ink: var(--tok-page); --color-paper-warm: #1A1A1A; }');
  const d = diffDark(before, resolvedDark(page, g2));
  assert.equal(d.length, 1);
  assert.equal(d[0].key, '.a { color }');
  assert.match(d[0].why, /luminance/);
});

test(`THE DARK PAGE RESOLVES THE SAME as ${BASE} (luminance <= 1.2%, no shape change)`, () => {
  try { git('rev-parse', '--verify', BASE); } catch { assert.fail(`base ${BASE} is not available - fetch it`); }
  const files = git('ls-files', '*.css').split('\n').filter(Boolean);
  const gBase = darkGlobals(atBase('app/globals.css') ?? '');
  const gHead = darkGlobals(atHead('app/globals.css'));
  const report = [];
  const all = [];
  let compared = 0;
  for (const f of files) {
    const before = atBase(f);
    if (before == null) continue; // new on this branch
    compared += 1;
    const diffs = diffDark(resolvedDark(before, gBase), resolvedDark(atHead(f), gHead));
    for (const d of diffs) all.push({ file: f, ...d });
  }
  assert.ok(compared > 50, `compared ${compared} stylesheets - the walk found too few`);
  const intent = JSON.parse(readFileSync(path.join(REPO, 'lib/brand/parity-intent.json'), 'utf8')).changes ?? [];
  const { undeclared, mismatched, stale } = reconcileIntent(all, intent);
  const line = (d) => `${d.file}: ${d.key}  ${d.before ?? '(none)'} -> ${d.after ?? '(none)'}  [${d.why}]`;
  for (const d of undeclared) report.push(`UNDECLARED ${line(d)}`);
  for (const d of mismatched) report.push(`MISMATCH ${line(d)} (declared ${d.declared})`);
  for (const c of stale) report.push(`STALE intent entry, no such change: ${c.file}: ${c.key}`);
  assert.equal(report.length, 0, `${report.length} problem(s) vs ${BASE} (intent: ${intent.length} declared):\n${report.join('\n')}`);
});
