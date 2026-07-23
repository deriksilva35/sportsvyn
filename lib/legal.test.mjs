// Compliance: the non-affiliation line's content, and a guard that no user-facing
// source (app/ or components/) references the NFL stats vendor by name or BDL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NFL_NON_AFFILIATION } from './legal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

test('non-affiliation line names NFL, teams, players; hyphens only', () => {
  assert.match(NFL_NON_AFFILIATION, /not affiliated with, endorsed by, or sponsored by/);
  assert.match(NFL_NON_AFFILIATION, /National Football League/);
  assert.match(NFL_NON_AFFILIATION, /its teams, or its players/);
  assert.ok(!/[—–]/.test(NFL_NON_AFFILIATION), 'no em/en dashes');
});

function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.(js|jsx|mjs|css)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) acc.push(full);
  }
  return acc;
}

test('no user-facing vendor reference (balldontlie / BDL) in app/ or components/', () => {
  const files = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'components'))];
  const rx = /balldontlie|ball[ -]?dont[ -]?lie|\bBDL\b/i;
  const hits = files.filter((f) => rx.test(readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f));
  assert.deepEqual(hits, [], 'NFL stats vendor must never be named in user-facing source');
});
