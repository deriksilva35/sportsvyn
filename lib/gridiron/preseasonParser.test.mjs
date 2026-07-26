// Parser tested against the REAL content/preseason-edition-0.md. Pure, no env.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePreseasonEditions } from './preseasonParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const md = readFileSync(path.resolve(__dirname, '..', '..', 'content', 'preseason-edition-0.md'), 'utf8');
const boards = parsePreseasonEditions(md);
const by = Object.fromEntries(boards.map((b) => [b.slug, b]));

test('parses the five boards in order', () => {
  assert.deepEqual(boards.map((b) => b.slug), ['nfl-power', 'nfl-mvp-offense', 'nfl-mvp-defense', 'cfb-top25', 'cfb-heisman']);
});

test('nfl-power: 32 entries, dark horses 16-20, rank-only 25', () => {
  const b = by['nfl-power'];
  assert.equal(b.entries.length, 32);
  assert.equal(b.entries[0].label, 'Los Angeles Rams');
  assert.equal(b.entries[0].teamTag, null); // team board — no comma split
  assert.deepEqual(b.entries.filter((e) => e.band === 'dark_horse').map((e) => e.rank), [16, 17, 18, 19, 20]);
  assert.equal(b.entries.find((e) => e.rank === 16).label, 'Cincinnati Bengals'); // first dark horse
  const ro = b.entries.find((e) => e.rank === 25);
  assert.equal(ro.label, 'New Orleans Saints');
  assert.equal(ro.read, null); // rank-only row
});

test('nfl-mvp-defense: dark-horse band starts at 11 (top 10)', () => {
  const b = by['nfl-mvp-defense'];
  assert.equal(b.entries.length, 15);
  assert.deepEqual(b.entries.filter((e) => e.band === 'dark_horse').map((e) => e.rank), [11, 12, 13, 14, 15]);
});

test('player boards split "Name, Team" (incl. internal periods)', () => {
  const b = by['nfl-mvp-offense'];
  assert.equal(b.entries[0].label, 'Josh Allen');
  assert.equal(b.entries[0].teamTag, 'Buffalo');
  const stroud = b.entries.find((e) => e.rank === 15);
  assert.equal(stroud.label, 'C.J. Stroud');
  assert.equal(stroud.teamTag, 'Houston');
});

test('cfb-top25: ranks 13-15 absent, rank-only 22 + 23', () => {
  const b = by['cfb-top25'];
  const ranks = b.entries.map((e) => e.rank);
  assert.ok(![13, 14, 15].some((r) => ranks.includes(r)));
  assert.equal(b.entries[0].label, 'Ohio State');
  assert.deepEqual(b.entries.filter((e) => e.read == null).map((e) => e.rank).sort((a, c) => a - c), [22, 23]);
});

test('every read + label is hyphens-only (no em/en dashes)', () => {
  for (const b of boards) {
    for (const e of b.entries) {
      if (e.read) assert.ok(!/[—–]/.test(e.read), `dash in ${b.slug} r${e.rank}`);
      assert.ok(!/[—–]/.test(e.label), `dash in label ${e.label}`);
    }
  }
});
