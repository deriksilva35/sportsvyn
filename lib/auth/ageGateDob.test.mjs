// lib/auth/ageGateDob.test.mjs - THE DATE OF BIRTH IS NEVER PUBLIC.
//
// users.date_of_birth (migration 124) may be named only by the files that
// write it, gate on it, or strip it. This walks every source file under app/,
// lib/ and components/, plus the root modules, and fails on any other file
// that names the column - a board reader, an OG image, an API payload, a
// profile page. It counts what it walked, so a walker that saw nothing fails.
//
// And because a column can leak without being named, it also forbids the
// shapes that would carry it implicitly: SELECT * / users.* / RETURNING * over
// users, and an auth adapter that hands the full row to the session.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rel = (f) => path.relative(REPO, f).split(path.sep).join('/');

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.(js|jsx|mjs|ts|tsx)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) acc.push(full);
  }
  return acc;
}

const sources = () => [
  ...walk(path.join(REPO, 'app')), ...walk(path.join(REPO, 'lib')), ...walk(path.join(REPO, 'components')),
  ...['auth.js', 'proxy.js'].map((f) => path.join(REPO, f)).filter(existsSync),
];

// The only files allowed to name the column, and why.
const ALLOWED = {
  'lib/auth/ageGateDb.js': 'reads it for the gate, writes it once',
  'lib/auth/ageGate.js': 'the pure verdict over the gate read (gateVerdict)',
  'auth.js': 'strips it from every adapter user (session.user)',
};

test('only the gate names date_of_birth (walked and counted)', () => {
  const files = sources();
  assert.ok(files.length > 500, `the walker saw ${files.length} files - it is not walking the tree`);
  const hits = files.filter((f) => /date_of_birth|dateOfBirth/.test(readFileSync(f, 'utf8'))).map(rel).sort();
  assert.deepEqual(hits, Object.keys(ALLOWED).sort(),
    'a file outside the allowlist names the date of birth - it must never reach a public reader');
});

test('no reader selects the whole users row', () => {
  const rx = /SELECT\s+\*\s+FROM\s+users\b|\busers\.\*|(?:INSERT INTO|UPDATE)\s+users\b[^`]*RETURNING\s+\*|row_to_json\(\s*users\b|to_jsonb?\(\s*users\b/i;
  const hits = sources().filter((f) => rx.test(readFileSync(f, 'utf8'))).map(rel);
  assert.deepEqual(hits, [], 'a SELECT * over users would carry date_of_birth into whatever renders it');
});

test('the session user never carries it: every adapter user read is stripped', () => {
  const t = readFileSync(path.join(REPO, 'auth.js'), 'utf8');
  assert.match(t, /return r \? \{ \.\.\.r, user: withoutDob\(r\.user\) \} : r;/, 'getSessionAndUser strips the row');
  for (const m of ['getUser', 'getUserByEmail', 'getUserByAccount']) {
    assert.match(t, new RegExp(`${m}: async \\([^)]*\\) => withoutDob\\(await baseAdapter\\.${m}\\(`), `${m} strips the row`);
  }
});

test('the gate reads it as text, and only the gate reads it', () => {
  const t = readFileSync(path.join(REPO, 'lib/auth/ageGateDb.js'), 'utf8');
  assert.equal((t.match(/SELECT date_of_birth::text AS date_of_birth FROM users/g) ?? []).length, 1, 'one read');
  assert.equal((t.match(/UPDATE users SET date_of_birth = /g) ?? []).length, 1, 'one write');
  assert.match(t, /AND date_of_birth IS NULL/, 'written once, never overwritten');
});
