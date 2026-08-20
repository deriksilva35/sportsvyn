// lib/leagues/core.test.mjs - codes, membership writes, and the scoped board.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const { CODE_ALPHABET, CODE_LENGTH, makeJoinCode, validateLeagueName } = await import('./core.js');

const REPO = path.resolve(__dirname, '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// join codes
// ---------------------------------------------------------------------------

test('the alphabet carries no lookalikes - codes get read aloud off phones', () => {
  for (const bad of ['0', 'O', '1', 'I', 'L']) {
    assert.ok(!CODE_ALPHABET.includes(bad), `${bad} in the alphabet`);
  }
  assert.ok(CODE_ALPHABET.length >= 28, 'enough symbols for the keyspace math');
});

test('codes are six chars, alphabet-only, and rng-driven', () => {
  for (let i = 0; i < 50; i += 1) {
    const c = makeJoinCode();
    assert.equal(c.length, CODE_LENGTH);
    for (const ch of c) assert.ok(CODE_ALPHABET.includes(ch), c);
  }
  // deterministic rng -> deterministic code (the seam the retry loop uses)
  assert.equal(makeJoinCode(() => 0), CODE_ALPHABET[0].repeat(CODE_LENGTH));
});

test('creation retries the code on UNIQUE collision, and only on that', () => {
  const t = stripComments(src('lib/leagues/core.js'));
  assert.match(t, /for \(let attempt = 0; attempt < 5/);
  assert.match(t, /player_leagues_join_code_key/, 'the retry keys on the constraint name');
  assert.match(t, /throw e/, 'every other failure surfaces');
});

// ---------------------------------------------------------------------------
// names
// ---------------------------------------------------------------------------

test('league names: trimmed, squashed, bounded', () => {
  assert.equal(validateLeagueName('  The   Boys  ').name, 'The Boys');
  assert.equal(validateLeagueName('ab').ok, false);
  assert.equal(validateLeagueName('x'.repeat(41)).ok, false);
  assert.equal(validateLeagueName('The Danville 12').ok, true);
});

// ---------------------------------------------------------------------------
// the naming landmine + the scoped board
// ---------------------------------------------------------------------------

test('nothing in lib/leagues touches the SPORTS `leagues` table', () => {
  const t = stripComments(src('lib/leagues/core.js'));
  assert.ok(!/FROM leagues\b/.test(t) && !/JOIN leagues\b/.test(t),
    'bare `leagues` is the NFL/CFB table - the migration 073 landmine');
});

test('the member scope is explicit ANY, never a falsy shortcut', () => {
  const t = stripComments(src('lib/weekly/live.js'));
  assert.match(t, /memberIds == null/, 'null means global');
  assert.match(t, /ANY\(\$\{memberIds\}\)/, 'an EMPTY league gets an empty board, not the world');
});

test('the league board inherits sealed-until-lock - scope cannot bypass the null', () => {
  const t = stripComments(src('lib/weekly/live.js'));
  const fn = t.slice(t.indexOf('export async function weeklyBoardTable'));
  const gate = fn.indexOf('if (!locked) return null');
  const scoped = fn.indexOf('ANY(');
  assert.ok(gate > -1 && gate < scoped, 'the pre-lock null precedes every scoped read');
});

test('membership gates visibility - leagueDetail returns null for non-members', () => {
  const t = stripComments(src('lib/leagues/core.js'));
  const fn = t.slice(t.indexOf('export async function leagueDetail'));
  assert.match(fn, /JOIN league_members m ON m\.league_id = l\.id AND m\.user_id = /);
  assert.match(fn, /if \(!lg\) return null/);
});

// ---------------------------------------------------------------------------
// the door and the share target
// ---------------------------------------------------------------------------

test('the share target carries the code through the sign-in law', () => {
  const t = stripComments(src('app/leagues/page.js'));
  assert.match(t, /joinDest = joinRaw \? `\/leagues\?join=/, 'the dest must remember why they came');
  assert.match(t, /requireSignInInShell\(\{ isShell, userId, dest: joinDest \}\)/);
  assert.match(t, /shellSigninHref\(joinDest, isShell\)/, 'web sign-in links carry it too');
});

test('a code-holder sees name + members, never a null - and never the roster', () => {
  const t = stripComments(src('lib/leagues/core.js'));
  const fn = t.slice(t.indexOf('export async function leagueByCode'));
  assert.match(fn, /count\(\*\)::int/, 'member COUNT only');
  assert.ok(!/JOIN users/.test(fn), 'the preview must not carry member identities');
  const prompt = stripComments(src('components/leagues/JoinPrompt.js'));
  assert.match(prompt, /doesn&rsquo;t match anything/, 'a dud code gets a sentence, not a 404');
  assert.match(prompt, /Sign in to join/, 'signed-out gets the law first, join after');
});

test('the lobby card lists leagues or pitches, and routes /leagues', () => {
  const t = stripComments(src('app/games/page.js'));
  assert.match(t, /Your leagues/);
  assert.match(t, /Start a league|Open your leagues/);
  assert.match(t, /href="\/leagues"/);
  assert.match(t, /myLeagues\(Number\(userId\)\)\.catch\(\(\) => \[\]\)/, 'caught like every lobby read');
});
