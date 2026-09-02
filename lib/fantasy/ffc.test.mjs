// lib/fantasy/ffc.test.mjs — the FFC pool upsert's conflict target, against DEV.
// node --test. Read-only: it inspects information_schema and this repo's source,
// and writes nothing.
//
// WHY THIS TEST EXISTS. snapshotPool upserts with an ON CONFLICT inference list.
// Postgres matches such a list against a unique index EXACTLY - a list that is
// short by one column matches NOTHING and the statement throws. So the list is
// not a detail of the query, it is a copy of the table's unique key, and a copy
// goes stale silently.
//
// It did. 083 added `source` to the key; the list kept naming four columns; the
// daily cron threw from then on and took matchPoolIdentities down with it. The
// suite was green the whole time, because nothing compared the two.
//
// NEITHER SIDE OF THIS ASSERTION IS A LITERAL. The expected columns are read out
// of the LIVE unique index via information_schema, and the actual columns are
// parsed out of ffc.js's own source. Writing the six names into this file would
// only prove the test agrees with itself, and would keep agreeing after the next
// key change - which is exactly the failure it is here to catch.

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
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const { neon } = await import('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

const src = (rel) => readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf8');

/** The columns of the unique key the pool upsert has to name, from the database. */
async function uniqueKeyColumns(table) {
  const rows = await sql`
    SELECT a.attname AS col, k.ord
      FROM pg_constraint c
      JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.conrelid = ${table}::regclass AND c.contype = 'u'
     ORDER BY k.ord`;
  return rows.map((r) => r.col);
}

/** The columns ffc.js actually names in its ON CONFLICT, from the source. */
function conflictColumnsInSource() {
  const m = src('lib/fantasy/ffc.js').match(/ON CONFLICT \(([^)]*)\)/);
  assert.ok(m, 'ffc.js must still upsert with an ON CONFLICT inference list');
  return m[1].split(',').map((s) => s.trim()).filter(Boolean);
}

test('the pool upsert names the table\'s whole unique key - both sides read, neither written here', async () => {
  const key = await uniqueKeyColumns('sim_player_pool');
  const named = conflictColumnsInSource();
  assert.ok(key.length > 0, 'sim_player_pool must have a unique constraint to infer against');
  // Order does not matter to Postgres; membership does. Compare as sets, so a
  // reordering of the key is not a false failure.
  assert.deepEqual([...named].sort(), [...key].sort(),
    `ffc.js ON CONFLICT names (${named.join(', ')}) but the live unique key is (${key.join(', ')}). ` +
    'A short list matches no index and the statement throws at runtime - this is what broke the ' +
    'adp-snapshot cron on 2026-09-02 (sync_runs 18646).');
});

test('the conflict target is not merely a prefix of the key - the 083 regression, pinned', async () => {
  const key = await uniqueKeyColumns('sim_player_pool');
  const named = conflictColumnsInSource();
  // The break was a strict-subset list, which reads as plausible and fails only
  // in Postgres. Assert the exact condition that was true while it was broken.
  const missing = key.filter((c) => !named.includes(c));
  assert.deepEqual(missing, [], `the unique key has ${missing.join(', ')} and the upsert never names them`);
  const extra = named.filter((c) => !key.includes(c));
  assert.deepEqual(extra, [], `the upsert names ${extra.join(', ')}, which is not in the unique key`);
});

test('the statement Postgres will actually run is accepted by Postgres', async () => {
  // The strongest form: ask the database to PLAN the real inference list, rather
  // than trusting that two matching column lists means the query parses.
  //
  // A REAL SESSION, NOT THE HTTP DRIVER. The first cut of this used
  // sql`BEGIN` / sql`ROLLBACK` around a neon() http call - and every statement
  // over that driver is its own transaction, so the ROLLBACK rolled back
  // nothing and the probe row was written to DEV for real. Client holds one
  // connection, so the transaction is a transaction. The assertion at the foot
  // is what caught it and stays as the guard.
  const { Client } = await import('@neondatabase/serverless');
  const named = conflictColumnsInSource().join(', ');
  const probe = `probe-ffc-test-${process.pid}`;
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('BEGIN');
    // If the inference list matches no unique index, THIS is where Postgres
    // throws - which is exactly how production failed, and the failure the two
    // column-list tests above can only infer.
    await c.query(
      `INSERT INTO sim_player_pool (snapshot_date, scoring_format, teams_count, ffc_player_id,
         name, position, adp)
       VALUES ('1999-01-01', 'ppr', 12, $1, 'Conflict Target Probe', 'RB', 1)
       ON CONFLICT (${named}) DO UPDATE SET name = EXCLUDED.name`, [probe]);
    // And it is idempotent: the second run must take the DO UPDATE branch.
    await c.query(
      `INSERT INTO sim_player_pool (snapshot_date, scoring_format, teams_count, ffc_player_id,
         name, position, adp)
       VALUES ('1999-01-01', 'ppr', 12, $1, 'Conflict Target Probe II', 'RB', 2)
       ON CONFLICT (${named}) DO UPDATE SET name = EXCLUDED.name`, [probe]);
    const inTx = await c.query('SELECT count(*)::int n FROM sim_player_pool WHERE ffc_player_id = $1', [probe]);
    assert.equal(inTx.rows[0].n, 1, 'the upsert must update in place, not insert a second row');
    await c.query('ROLLBACK');
  } finally {
    await c.end();
  }
  const left = await sql`SELECT count(*)::int n FROM sim_player_pool WHERE ffc_player_id = ${probe}`;
  assert.equal(left[0].n, 0, 'the probe row must not survive the rollback');
});
