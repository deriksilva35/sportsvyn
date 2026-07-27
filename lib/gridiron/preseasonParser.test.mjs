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

test('cfb-top25: contiguous 1-25, dark horses 16-20, footer, no rank-only', () => {
  const b = by['cfb-top25'];
  assert.equal(b.entries.length, 25);
  assert.deepEqual(b.entries.map((e) => e.rank).sort((a, c) => a - c), Array.from({ length: 25 }, (_, i) => i + 1));
  assert.deepEqual(b.entries.filter((e) => e.band === 'dark_horse').map((e) => e.rank), [16, 17, 18, 19, 20]);
  assert.equal(b.entries.filter((e) => e.read == null).length, 0); // every entry now has a read
  assert.equal(b.entries[0].label, 'Ohio State');
  assert.equal(b.entries[15].label, 'Penn State'); // rank 16, first dark horse (explicit number)
});

test('cfb-top25: "Named and left off" parsed as a footer note', () => {
  const b = by['cfb-top25'];
  assert.ok(b.footer, 'footer present');
  assert.match(b.footer, /Tennessee/);
  assert.match(b.footer, /Auburn/);
  assert.match(b.footer, /absent here, on purpose/);
  assert.ok(!/[—–]/.test(b.footer), 'footer hyphens only');
});

test('every read + label is hyphens-only (no em/en dashes)', () => {
  for (const b of boards) {
    for (const e of b.entries) {
      if (e.read) assert.ok(!/[—–]/.test(e.read), `dash in ${b.slug} r${e.rank}`);
      assert.ok(!/[—–]/.test(e.label), `dash in label ${e.label}`);
    }
  }
});
