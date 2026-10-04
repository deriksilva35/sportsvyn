// lib/clientGraph.test.mjs - NO CLIENT COMPONENT CAN REACH A SERVER-ONLY MODULE.
//
// RULING sun-12. bdl-errors-fail broke the production build: lib/bdl/http.js
// imports node:async_hooks, and a 'use client' card reached it through a chain
// of innocent-looking helpers (OctoberCard -> lib/mlb/cardLines.js ->
// lib/mlb/playsImport.js -> lib/bdl/http.js). The suite was green: node runs
// any import, and only the bundler knows a browser cannot. So this test walks
// what the bundler walks.
//
// A guard cannot see a file it does not name, so this one names none: it finds
// every 'use client' module under app/, components/ and lib/, follows every
// static and literal dynamic import it can resolve, and fails on any path to
//   - lib/db.js or lib/bdl/http.js (or anything importing 'server-only'),
//   - a node: builtin or a bare builtin name,
//   - the database driver.
// It stops at a 'use server' module: a client gets a reference to a server
// action, never its code. Then it COUNTS, so a walker that matched nothing
// cannot pass.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (f) => path.relative(REPO, f).split(path.sep).join('/');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'test-tmp') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.(m?js|jsx)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) acc.push(full);
  }
  return acc;
}

const cache = new Map();
const text = (f) => { if (!cache.has(f)) cache.set(f, strip(readFileSync(f, 'utf8'))); return cache.get(f); };
const directive = (f, d) => new RegExp(`^\\s*['"]${d}['"]`).test(text(f));

const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const SERVER_FILES = new Set(['lib/db.js', 'lib/bdl/http.js']);
const SERVER_PACKAGES = [/^@neondatabase\//, /^server-only$/, /^pg$/];

function specsOf(f) {
  const c = text(f);
  return [
    ...[...c.matchAll(/(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
    ...[...c.matchAll(/(?:^|[\s;])import\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
    ...[...c.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
  ];
}

function resolve(from, s) {
  let base;
  if (s.startsWith('.')) base = path.resolve(path.dirname(from), s);
  else if (s.startsWith('@/')) base = path.join(REPO, s.slice(2));
  else return null;
  for (const c of [base, `${base}.js`, `${base}.mjs`, `${base}.jsx`, path.join(base, 'index.js')]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** The first server-only thing reachable from `entry`, as a chain, or null. */
function offence(entry) {
  const seen = new Set();
  const stack = [[entry, [rel(entry)]]];
  while (stack.length) {
    const [f, chain] = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (SERVER_FILES.has(rel(f))) return chain.join(' -> ');
    if (f !== entry && directive(f, 'use server')) continue;
    for (const s of specsOf(f)) {
      if (BUILTINS.has(s) || SERVER_PACKAGES.some((rx) => rx.test(s))) return [...chain, s].join(' -> ');
      const next = resolve(f, s);
      if (next && !seen.has(next)) stack.push([next, [...chain, rel(next)]]);
    }
  }
  return null;
}

const CLIENTS = ['app', 'components', 'lib'].flatMap((d) => walk(path.join(REPO, d)))
  .filter((f) => directive(f, 'use client'));

test('every client component\'s import graph is free of server-only modules', () => {
  const bad = CLIENTS.map((f) => offence(f)).filter(Boolean);
  assert.deepEqual(bad, [], 'a client bundle cannot hold these - move the pure helper out, or the server code behind an action');
});

test('WALK AND COUNT: the walker sees the client components, and the door is marked server-only', () => {
  assert.ok(CLIENTS.length > 100, `client modules seen: ${CLIENTS.length}`);
  assert.ok(CLIENTS.some((f) => rel(f) === 'components/october/OctoberCard.js'), 'the card that broke the build is walked');
  // The door is NOT marked 'server-only': the droplet's poller and node --test
  // load it in plain node, where that marker throws (see lib/bdl/http.js).
  // So this walk is the guard, and it must keep seeing the chain that broke.
  assert.ok(CLIENTS.some((f) => rel(f) === 'components/fantasy/boardCopy.js' || rel(f) === 'components/fantasy/MovementBoard.js'));
});
