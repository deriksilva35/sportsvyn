// lib/time/timeTbdGuard.test.mjs - "Time TBD" HAS ONE SPELLING (tue-10).
//
// The string lives in lib/time/display.js (TIME_TBD) and every surface prints it
// through kickoffTimeLabel / dateTimeKickoffLabel or the `tbd` prop on
// StandaloneTime / StandaloneDate / LocalTime / PlayWhen. A second typed copy is
// a second surface that can drift ("Time tbd", "TBD", "time TBD"), so this walks
// app/ components/ lib/ and fails on any other file that types the literal.
// A guard cannot see a file it does not name: it WALKS, and counts what it walked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OWNER = path.join('lib', 'time', 'display.js');
const SKIP_DIR = new Set(['node_modules', '.next', 'test-tmp', '.git']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|jsx|mjs|ts|tsx)$/.test(name) && !/\.test\.mjs$/.test(name)) out.push(p);
  }
  return out;
}

test('the literal "Time TBD" is typed in lib/time/display.js and nowhere else', () => {
  const files = ['app', 'components', 'lib'].flatMap((d) => walk(path.join(ROOT, d)));
  assert.ok(files.length > 500, `walked ${files.length} files - the guard is not seeing the tree`);
  const hits = [];
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    if (rel === OWNER) continue;
    // comments may name it; code may not
    const code = readFileSync(f, 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    if (/Time TBD/.test(code)) hits.push(rel);
  }
  assert.deepEqual(hits, [], `hard-coded 'Time TBD' outside ${OWNER}: use kickoffTimeLabel / the tbd prop`);
  assert.match(readFileSync(path.join(ROOT, OWNER), 'utf8'), /TIME_TBD = 'Time TBD'/);
});
