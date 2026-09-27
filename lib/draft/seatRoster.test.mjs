// lib/draft/seatRoster.test.mjs - a roster is the picks at the player's SEAT (ruling 27 Sep).
//
// THE PREDICATE UNDER TEST IS THE ONE IN THE FILE. It is read out of
// lib/draft/entry.js and evaluated by Postgres against a 12-team snake written as
// VALUES - so what is proven is the SQL the bridge runs, not a copy of it. The
// case that forced the ruling is jam's week-3 room: seat 1, where the timer's two
// picks were filed as 'ai' and the label-based bridge counted six of eight.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(REPO, '.env.local'));
const { sql } = await import('../db.js');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

/** The CASE ... END = d.pick_position predicate, lifted out of a file with its aliases. */
function seatPredicate(file, pickAlias) {
  const s = src(file);
  const m = new RegExp(`\\(CASE WHEN ${pickAlias}\\.round % 2 = 1[\\s\\S]*?END\\) = d\\.pick_position`).exec(s);
  assert.ok(m, `${file} carries the seat predicate`);
  return m[0];
}

for (const [file, alias] of [['lib/draft/entry.js', 'dp'], ['lib/draft/roomRoster.js', 'p']]) {
  test(`${file}: seat 1 of 12 owns picks 1, 24, 25, 48, 49, 72, 73, 96 - and only those - whatever picked_by says`, async () => {
    const pred = seatPredicate(file, alias);
    const rows = await sql.query(`
      SELECT ${alias}.overall_pick FROM (
        SELECT gs AS overall_pick, ((gs - 1) / 12) + 1 AS round,
               CASE WHEN gs IN (24, 25) THEN 'ai' ELSE 'user' END AS picked_by
          FROM generate_series(1, 96) gs) ${alias},
        (SELECT 1 AS pick_position) d, (SELECT 12 AS teams_count) c
       WHERE ${pred}
       ORDER BY 1`);
    assert.deepEqual(rows.map((r) => r.overall_pick), [1, 24, 25, 48, 49, 72, 73, 96]);
  });
}

test('neither reader filters on picked_by any more', () => {
  for (const [file, fn] of [['lib/draft/entry.js', 'export async function bridgeRoster'], ['lib/draft/roomRoster.js', 'export async function picksForRoom']]) {
    const s = src(file); const body = s.slice(s.indexOf(fn), s.indexOf('`;', s.indexOf(fn)));
    assert.doesNotMatch(body, /picked_by = 'user'/, `${file} counts by seat`);
  }
});
