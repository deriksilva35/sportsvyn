#!/usr/bin/env node
// scripts/dev-orphan-sweep.mjs - LIST the test fixtures left on DEV, and on
// request delete them with an undo file. DEV only.
//
//   set -a && . ./.env.local && set +a
//   node scripts/dev-orphan-sweep.mjs                        # list (the default, read-only)
//   node scripts/dev-orphan-sweep.mjs --apply --dry-run      # write the undo file, print counts, delete nothing
//   node scripts/dev-orphan-sweep.mjs --apply                # write the undo file, then delete
//   node scripts/dev-orphan-sweep.mjs --undo <file.jsonl>    # put every row back (idempotent)
//
//   --older-than <minutes>  (default 30) only rows older than this are touched
//   --out <file>            where --apply writes the undo file
//                           (default test-tmp/dev-sweep-undo-<ISO>.jsonl)
//
// WHY. A killed test run skips ALL of its teardown, not just the table you
// were thinking about. On 25 Sep a suite stopped mid-file left pickem.test's
// league, teams, matches and contest on DEV; the check after the kill looked
// only for sentinel MATCHES, found none, and the next suite failed on a
// duplicate league slug. This lists every kind of fixture the suite creates.
//
// HOW A ROW IS RECOGNISED - by the conventions the tests already follow, not
// by a list of prefixes that would go stale the next time a test is written:
//   users     an email on a reserved test domain (@example.invalid, *.test)
//   player_leagues  a name with "test"/"sentinel", or a sentinel owner
//   leagues   a slug that starts with sentinel- or contains "test"
//   teams     in a fixture league, or a slug like a fixture's
//   matches   in a fixture league, or a slug like a fixture's
//   contests  a sport that is not a real league's slug, or a board naming a
//             fixture match
// Anything it prints is a candidate, not a verdict: read it before deleting.
//
// --apply USES THE SAME RULES (without the display LIMITs) and then follows
// every foreign key that points at a row it will delete, read live from
// pg_constraint - it never leans on ON DELETE CASCADE to do the work quietly:
//   CASCADE / NO ACTION / RESTRICT   the child row is deleted explicitly, and
//                                    its own children are followed in turn
//   SET NULL                         the column is nulled explicitly (deleting
//                                    there would walk out of the fixture into
//                                    real data), the old value kept for undo
// EVERY deleted row and every nulled value goes into the undo file BEFORE
// anything is deleted: JSONL, one line per row, in execution order -
//   {"table":"device_tokens","nulled":{"pk":{...},"set":{"user_id":12}}}
//   {"table":"contest_entries","row":{...}}       children before parents
// --undo reads it backwards: rows re-inserted parents first with their
// original ids (ON CONFLICT DO NOTHING, so a second run is a no-op), then the
// nulled columns put back where they are still NULL.
//
// A RUNNING SUITE OWNS ITS ROWS. Every candidate must have a created_at older
// than --older-than minutes; a row without created_at follows the row that
// pulled it in. If ANY row in a fixture's tree is young - a contest entry a
// suite wrote a minute ago against an old sentinel user - the whole fixture
// it hangs from is left alone. The delete itself runs as ONE transaction, and
// before each table is emptied it checks that nothing new points at it; a
// row that appeared since the plan was made aborts the whole transaction
// rather than being cascaded away outside the undo file.
//
// IT REFUSES PROD: DATABASE_URL equal to PROD_DATABASE_URL, or reaching the
// same host (pooled or direct). --apply and --undo also refuse when
// PROD_DATABASE_URL is missing, since then nothing was compared.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import {
  parseArgs, refuseReason, fkTreatment, deletionOrder, restoreTableOrder, isYoung, rootOf, qi,
} from '../lib/testing/devSweepPlan.mjs';

let args;
try { args = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`USAGE: ${e.message}`); process.exit(2); }

const url = process.env.DATABASE_URL;
const refused = refuseReason({ url, prodUrl: process.env.PROD_DATABASE_URL, mode: args.mode });
if (refused) { console.error(`REFUSE: ${refused}`); process.exit(1); }
const sql = neon(url);
const MODE_LABEL = { list: 'LIST ONLY', apply: args.dryRun ? 'APPLY --dry-run (deletes nothing)' : 'APPLY', undo: 'UNDO' }[args.mode];
console.log(`TARGET ${new URL(url).host} | FP ${crypto.createHash('sha256').update(url).digest('hex').slice(0, 12)} | ${MODE_LABEL}`);

const SLUG_RX = '(^sentinel-|test|^prefsroute-)';
const EMAIL_RX = '(@example\\.invalid$|@[a-z0-9.-]*\\.test$)';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHUNK = 1000;
const MAX_ROWS = 200_000; // a sweep this size is not a sweep of orphans: stop and look
const chunks = (arr, n = CHUNK) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

// =================================================================== list

async function listMode() {
  const leagues = await sql`SELECT id, slug, created_at FROM leagues WHERE slug ~* ${SLUG_RX} ORDER BY created_at`;
  const leagueIds = leagues.map((l) => l.id);
  const teams = await sql`
    SELECT id, slug, league_id, created_at FROM teams
     WHERE league_id = ANY(${leagueIds}) OR slug ~* ${SLUG_RX} ORDER BY created_at LIMIT 500`;
  const matches = await sql`
    SELECT id, slug, league_id, status, created_at FROM matches
     WHERE league_id = ANY(${leagueIds}) OR slug ~* ${SLUG_RX} ORDER BY created_at LIMIT 500`;
  const matchIds = matches.map((m) => m.id);
  const real = (await sql`SELECT slug FROM leagues WHERE NOT (slug ~* ${SLUG_RX})`).map((r) => r.slug);
  const contests = await sql`
    SELECT c.id, c.game_type, c.sport, c.season_year, c.created_at FROM contests c
     WHERE NOT (c.sport = ANY(${real}))
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.board) = 'array' THEN c.board ELSE '[]'::jsonb END) g
                    WHERE (g->>'match_id') ~ '^[0-9]+$' AND (g->>'match_id')::int = ANY(${matchIds}))
     ORDER BY c.created_at LIMIT 500`;
  const users = await sql`SELECT id, email, created_at FROM users WHERE email ~* ${EMAIL_RX} ORDER BY created_at DESC LIMIT 50`;
  const [{ n: userCount }] = await sql`SELECT count(*)::int n FROM users WHERE email ~* ${EMAIL_RX}`;

  // PLAYER LEAGUES (Leagues V1): a test's league is named with "test" or owned by
  // a sentinel user; an owner deleted first leaves owner_id NULL, so a "test"
  // name is enough on its own.
  const playerLeagues = await sql`
    SELECT l.id, l.name, l.created_at FROM player_leagues l LEFT JOIN users u ON u.id = l.owner_id
     WHERE l.name ~* 'test|sentinel' OR u.email ~* ${EMAIL_RX} ORDER BY l.created_at LIMIT 200`;

  const day = (d) => new Date(d).toISOString().slice(0, 16).replace('T', ' ');
  const show = (name, rows, fmt) => {
    console.log(`\n${name}: ${rows.length}`);
    for (const r of rows.slice(0, 50)) console.log(`  ${fmt(r)}`);
    if (rows.length > 50) console.log(`  ... and ${rows.length - 50} more`);
  };
  show('leagues', leagues, (r) => `${String(r.id).padStart(6)}  ${r.slug}  (${day(r.created_at)})`);
  show('teams', teams, (r) => `${String(r.id).padStart(6)}  ${r.slug}  league ${r.league_id}  (${day(r.created_at)})`);
  show('matches', matches, (r) => `${String(r.id).padStart(6)}  ${r.slug}  ${r.status}  (${day(r.created_at)})`);
  show('contests', contests, (r) => `${String(r.id).padStart(6)}  ${r.game_type} ${r.sport} ${r.season_year ?? ''}  (${day(r.created_at)})`);
  show('player_leagues', playerLeagues, (r) => `${String(r.id).padStart(6)}  ${r.name}  (${day(r.created_at)})`);
  console.log(`\nusers: ${userCount}${userCount > users.length ? ` (newest ${users.length} shown)` : ''}`);
  for (const r of users) console.log(`  ${String(r.id).padStart(6)}  ${r.email}  (${day(r.created_at)})`);

  const total = leagues.length + teams.length + matches.length + contests.length + playerLeagues.length + userCount;
  console.log(`\n${total ? `${total} fixture row(s) on DEV. Read them before deleting; nothing was changed.` : 'DEV is clean: no fixture rows.'}`);
}

// =================================================================== catalog

async function loadCatalog() {
  const fks = await sql`
    SELECT c.conname::text AS conname, cr.relname::text AS child, pr.relname::text AS parent, c.confdeltype::text AS action,
           (SELECT array_agg(a.attname::text ORDER BY k.n) FROM unnest(c.conkey) WITH ORDINALITY k(attnum, n)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols,
           (SELECT array_agg(format_type(a.atttypid, a.atttypmod) ORDER BY k.n) FROM unnest(c.conkey) WITH ORDINALITY k(attnum, n)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS types,
           (SELECT array_agg(a.attname::text ORDER BY k.n) FROM unnest(c.confkey) WITH ORDINALITY k(attnum, n)
              JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) AS pcols
      FROM pg_constraint c
      JOIN pg_class cr ON cr.oid = c.conrelid JOIN pg_namespace cn ON cn.oid = cr.relnamespace
      JOIN pg_class pr ON pr.oid = c.confrelid JOIN pg_namespace pn ON pn.oid = pr.relnamespace
     WHERE c.contype = 'f' AND cn.nspname = 'public' AND pn.nspname = 'public'
     ORDER BY pr.relname, cr.relname, c.conname`;
  for (const f of fks) fkTreatment(f.action); // an unhandled action fails here, before anything is read
  const byParent = new Map();
  for (const f of fks) { if (!byParent.has(f.parent)) byParent.set(f.parent, []); byParent.get(f.parent).push(f); }
  return { fks, byParent };
}

const metaCache = new Map();
async function tableMeta(table) {
  if (metaCache.has(table)) return metaCache.get(table);
  const cols = await sql`
    SELECT a.attname::text AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attgenerated AS gen, a.attidentity AS ident
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = ${table} AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum`;
  const pk = await sql`
    SELECT a.attname::text AS name FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN unnest(i.indkey) WITH ORDINALITY k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
     WHERE n.nspname = 'public' AND c.relname = ${table} AND i.indisprimary ORDER BY k.ord`;
  if (!cols.length) throw new Error(`table ${table} not found`);
  const type = Object.fromEntries(cols.map((c) => [c.name, c.type]));
  const meta = {
    table,
    cols: cols.map((c) => c.name),
    insertCols: cols.filter((c) => !c.gen).map((c) => c.name),
    identityAlways: cols.some((c) => c.ident === 'a'),
    pk: pk.map((r) => r.name),
    pkTypes: pk.map((r) => type[r.name]),
    type,
  };
  metaCache.set(table, meta);
  return meta;
}

// A WHERE fragment matching `alias`.(cols) against a list of value tuples.
// One column: a typed = ANY($n) so the index is used. Several: compared as jsonb arrays.
function matchClause(alias, cols, types, tuples, params) {
  if (cols.length === 1) {
    params.push(tuples.map((t) => (t[0] !== null && typeof t[0] === 'object' ? JSON.stringify(t[0]) : t[0])));
    return `${alias}.${qi(cols[0])} = ANY($${params.length}::${types[0]}[])`;
  }
  params.push(JSON.stringify(tuples));
  return `jsonb_build_array(${cols.map((c) => `${alias}.${qi(c)}`).join(', ')}) = ANY(ARRAY(SELECT jsonb_array_elements($${params.length}::jsonb)))`;
}

const keyOf = (row, cols) => JSON.stringify(cols.map((c) => row[c]));
const nodeId = (table, key) => `${table}|${key}`;

// =================================================================== seeds

async function pageRows(build) {
  const out = [];
  let last = 0;
  for (;;) {
    const rows = await build(last);
    for (const r of rows) out.push(r.r);
    if (rows.length < CHUNK) break;
    last = rows[rows.length - 1].id;
    if (out.length > MAX_ROWS) throw new Error(`more than ${MAX_ROWS} seed rows: refusing`);
  }
  return out;
}

async function loadSeeds(cutoff) {
  const fixtureLeagueIds = (await sql`SELECT id FROM leagues WHERE slug ~* ${SLUG_RX}`).map((r) => r.id);
  const fixtureMatchIds = (await sql`SELECT id FROM matches WHERE league_id = ANY(${fixtureLeagueIds}) OR slug ~* ${SLUG_RX}`).map((r) => r.id);
  const real = (await sql`SELECT slug FROM leagues WHERE NOT (slug ~* ${SLUG_RX})`).map((r) => r.slug);
  return {
    leagues: await pageRows((last) => sql`
      SELECT to_jsonb(t.*) r, t.id FROM leagues t
       WHERE t.slug ~* ${SLUG_RX} AND t.created_at < ${cutoff} AND t.id > ${last} ORDER BY t.id LIMIT ${CHUNK}`),
    teams: await pageRows((last) => sql`
      SELECT to_jsonb(t.*) r, t.id FROM teams t
       WHERE (t.league_id = ANY(${fixtureLeagueIds}) OR t.slug ~* ${SLUG_RX}) AND t.created_at < ${cutoff} AND t.id > ${last}
       ORDER BY t.id LIMIT ${CHUNK}`),
    matches: await pageRows((last) => sql`
      SELECT to_jsonb(t.*) r, t.id FROM matches t
       WHERE (t.league_id = ANY(${fixtureLeagueIds}) OR t.slug ~* ${SLUG_RX}) AND t.created_at < ${cutoff} AND t.id > ${last}
       ORDER BY t.id LIMIT ${CHUNK}`),
    contests: await pageRows((last) => sql`
      SELECT to_jsonb(c.*) r, c.id FROM contests c
       WHERE (NOT (c.sport = ANY(${real}))
              OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.board) = 'array' THEN c.board ELSE '[]'::jsonb END) g
                          WHERE (g->>'match_id') ~ '^[0-9]+$' AND (g->>'match_id')::int = ANY(${fixtureMatchIds})))
         AND c.created_at < ${cutoff} AND c.id > ${last}
       ORDER BY c.id LIMIT ${CHUNK}`),
    player_leagues: await pageRows((last) => sql`
      SELECT to_jsonb(l.*) r, l.id FROM player_leagues l LEFT JOIN users u ON u.id = l.owner_id
       WHERE (l.name ~* 'test|sentinel' OR u.email ~* ${EMAIL_RX}) AND l.created_at < ${cutoff} AND l.id > ${last}
       ORDER BY l.id LIMIT ${CHUNK}`),
    users: await pageRows((last) => sql`
      SELECT to_jsonb(t.*) r, t.id FROM users t
       WHERE t.email ~* ${EMAIL_RX} AND t.created_at < ${cutoff} AND t.id > ${last} ORDER BY t.id LIMIT ${CHUNK}`),
  };
}

// =================================================================== closure

// From the seed rows, follow every FK that points at a collected row.
// Returns { nodes, dels: Map<table, Map<key, nodeId>>, nulls: Map<id, {...}> }.
async function closure(catalog, seeds, excludedRoots) {
  const nodes = new Map(); // nodeId -> { table, key, row, via }
  const dels = new Map();
  const nulls = new Map();
  const queue = [];
  const addDel = async (table, row, via) => {
    const meta = await tableMeta(table);
    if (!meta.pk.length) throw new Error(`${table} has no primary key: cannot delete or restore its rows exactly`);
    const key = keyOf(row, meta.pk);
    const id = nodeId(table, key);
    if (nodes.has(id)) return;
    nodes.set(id, { table, key, row, via });
    if (!dels.has(table)) dels.set(table, new Map());
    dels.get(table).set(key, id);
    queue.push(id);
    if (nodes.size > MAX_ROWS) throw new Error(`closure passed ${MAX_ROWS} rows: refusing`);
  };
  for (const [table, rows] of Object.entries(seeds)) {
    for (const row of rows) {
      const meta = await tableMeta(table);
      if (excludedRoots.has(nodeId(table, keyOf(row, meta.pk)))) continue;
      await addDel(table, row, null);
    }
  }
  // Breadth-first, a parent table's new rows at a time.
  while (queue.length) {
    const batch = queue.splice(0, queue.length);
    const byTable = new Map();
    for (const id of batch) { const n = nodes.get(id); if (!byTable.has(n.table)) byTable.set(n.table, []); byTable.get(n.table).push(id); }
    for (const [parent, ids] of byTable) {
      for (const fk of catalog.byParent.get(parent) ?? []) {
        const refToNode = new Map();
        for (const id of ids) {
          const vals = fk.pcols.map((c) => nodes.get(id).row[c]);
          if (vals.some((v) => v == null)) continue;
          const k = JSON.stringify(vals);
          if (!refToNode.has(k)) refToNode.set(k, id);
        }
        const tuples = [...refToNode.keys()].map((k) => JSON.parse(k));
        const childMeta = await tableMeta(fk.child);
        for (const part of chunks(tuples)) {
          const params = [];
          const where = matchClause('c', fk.cols, fk.types, part, params);
          const rows = await sql.query(`SELECT to_jsonb(c.*) AS r FROM ${qi(fk.child)} c WHERE ${where}`, params);
          for (const { r } of rows) {
            const via = refToNode.get(keyOf(r, fk.cols));
            if (!via) throw new Error(`${fk.child}.${fk.cols} row did not map back to its ${parent} parent (type mismatch?)`);
            if (fkTreatment(fk.action) === 'delete') { await addDel(fk.child, r, via); continue; }
            if (!childMeta.pk.length) throw new Error(`${fk.child} has no primary key: cannot null and restore its rows exactly`);
            const key = keyOf(r, childMeta.pk);
            nulls.set(`${fk.child}|${key}|${fk.conname}`, {
              table: fk.child, key, via, row: r, conname: fk.conname,
              pk: Object.fromEntries(childMeta.pk.map((c) => [c, r[c]])),
              set: Object.fromEntries(fk.cols.map((c) => [c, r[c]])),
            });
          }
        }
      }
    }
  }
  // A row that is itself deleted needs no nulling first.
  for (const [k, n] of nulls) if (dels.get(n.table)?.has(n.key)) nulls.delete(k);
  return { nodes, dels, nulls };
}

// =================================================================== apply

async function applyMode() {
  const [{ cutoff }] = await sql`SELECT (now() - ${args.olderThan}::float8 * interval '1 minute') AS cutoff`;
  const cutoffMs = new Date(cutoff).getTime();
  console.log(`older-than ${args.olderThan} min: only rows created before ${new Date(cutoffMs).toISOString()}`);
  const catalog = await loadCatalog();
  const seeds = await loadSeeds(cutoff);

  // Close over the FKs; if any row in a fixture's tree is young, drop that
  // fixture's seed and close again, until nothing young is left.
  const excluded = new Set();
  let plan;
  for (let round = 0; ; round++) {
    if (round > 50) throw new Error('age guard did not settle in 50 rounds');
    plan = await closure(catalog, seeds, excluded);
    const before = excluded.size;
    for (const [id, n] of plan.nodes) if (isYoung(n.row, cutoffMs)) excluded.add(rootOf(plan.nodes, id));
    for (const n of plan.nulls.values()) if (isYoung(n.row, cutoffMs)) excluded.add(rootOf(plan.nodes, n.via));
    if (excluded.size === before) break;
  }

  const tables = [...plan.dels.keys()];
  const order = deletionOrder(tables, catalog.fks.map((f) => ({ child: f.child, parent: f.parent, action: f.action })));

  // ---- the undo file, written in full before anything changes
  const outFile = path.resolve(args.outFile ?? path.join(REPO, 'test-tmp', `dev-sweep-undo-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const ws = fs.createWriteStream(outFile, { flags: 'wx' });
  const write = (obj) => new Promise((res) => { if (ws.write(`${JSON.stringify(obj)}\n`)) res(); else ws.once('drain', res); });
  for (const n of plan.nulls.values()) await write({ table: n.table, nulled: { pk: n.pk, set: n.set } });
  for (const t of order) for (const id of plan.dels.get(t).values()) await write({ table: t, row: plan.nodes.get(id).row });
  await new Promise((res, rej) => ws.end((e) => (e ? rej(e) : res())));

  // ---- the report
  const seedCount = (t) => [...plan.dels.get(t)?.values() ?? []].filter((id) => !plan.nodes.get(id).via).length;
  const nullCounts = new Map();
  for (const n of plan.nulls.values()) { const k = `${n.table}.${Object.keys(n.set).join(',')}`; nullCounts.set(k, (nullCounts.get(k) ?? 0) + 1); }
  console.log(`\nleft alone by the age guard: ${excluded.size} fixture(s) with a row younger than ${args.olderThan} min`);
  console.log('\nDELETE, in order (children first):');
  let totalDel = 0;
  for (const t of order) {
    const n = plan.dels.get(t).size; totalDel += n;
    const s = seedCount(t);
    console.log(`  ${t.padEnd(30)} ${String(n).padStart(6)}${s ? `  (${s} recognised fixture${s === 1 ? '' : 's'}, ${n - s} dependent)` : '  (dependent)'}`);
  }
  console.log('\nSET NULL, before any delete:');
  if (!nullCounts.size) console.log('  none');
  for (const [k, n] of nullCounts) console.log(`  ${k.padEnd(30)} ${String(n).padStart(6)}`);
  console.log(`\nundo file: ${outFile}`);
  console.log(`  ${totalDel} row(s) to delete, ${plan.nulls.size} column value(s) to null`);

  if (args.dryRun) { console.log('\n--dry-run: nothing was deleted.'); return; }
  if (!totalDel && !plan.nulls.size) { console.log('\nNothing to do.'); return; }

  // ---- one transaction: nulls, then per table (children first) a guard and the delete
  const queries = [];
  const tag = [];
  const nullGroups = new Map();
  for (const n of plan.nulls.values()) {
    const k = `${n.table}|${n.conname}`;
    if (!nullGroups.has(k)) nullGroups.set(k, { table: n.table, cols: Object.keys(n.set), pks: [] });
    nullGroups.get(k).pks.push(Object.values(n.pk));
  }
  for (const g of nullGroups.values()) {
    const meta = await tableMeta(g.table);
    for (const part of chunks(g.pks)) {
      const params = [];
      const where = matchClause('t', meta.pk, meta.pkTypes, part, params);
      queries.push(sql.query(`WITH u AS (UPDATE ${qi(g.table)} t SET ${g.cols.map((c) => `${qi(c)} = NULL`).join(', ')} WHERE ${where} RETURNING 1) SELECT count(*)::int n FROM u`, params));
      tag.push(['null', g.table]);
    }
  }
  const delTuples = (t) => [...plan.dels.get(t).keys()].map((k) => JSON.parse(k));
  for (const t of order) {
    const meta = await tableMeta(t);
    const rows = [...plan.dels.get(t).values()].map((id) => plan.nodes.get(id).row);
    // Guard: nothing outside the plan may still point at these rows.
    for (const fk of catalog.fks.filter((f) => f.parent === t)) {
      const refs = [...new Set(rows.map((r) => fk.pcols.map((c) => r[c])).filter((v) => v.every((x) => x != null)).map((v) => JSON.stringify(v)))].map((k) => JSON.parse(k));
      const childMeta = await tableMeta(fk.child);
      const own = plan.dels.has(fk.child) ? delTuples(fk.child) : [];
      for (const part of chunks(refs)) {
        const params = [];
        const where = matchClause('c', fk.cols, fk.types, part, params);
        const notOwn = own.length ? ` AND NOT (${matchClause('c', childMeta.pk, childMeta.pkTypes, own, params)})` : '';
        params.push(`SWEEP GUARD: ${fk.child}(${fk.cols}) has rows pointing at ${t} that were not in the plan - nothing was deleted`);
        // The cast sits OUTSIDE the CASE: a ($n::text)::int inside a branch is a
        // constant the planner folds - and raises - whether or not EXISTS is true.
        queries.push(sql.query(`SELECT (CASE WHEN EXISTS (SELECT 1 FROM ${qi(fk.child)} c WHERE ${where}${notOwn}) THEN $${params.length}::text ELSE '0' END)::int AS n`, params));
        tag.push(['guard', t]);
      }
    }
    for (const part of chunks(delTuples(t))) {
      const params = [];
      const where = matchClause('t', meta.pk, meta.pkTypes, part, params);
      queries.push(sql.query(`WITH d AS (DELETE FROM ${qi(t)} t WHERE ${where} RETURNING 1) SELECT count(*)::int n FROM d`, params));
      tag.push(['delete', t]);
    }
  }
  const results = await sql.transaction(queries);
  const done = new Map();
  results.forEach((rows, i) => {
    const [kind, t] = tag[i];
    if (kind === 'guard') return;
    const k = `${kind} ${t}`;
    done.set(k, (done.get(k) ?? 0) + rows[0].n);
  });
  console.log('\nAPPLIED (one transaction):');
  for (const [k, n] of done) console.log(`  ${k.padEnd(36)} ${String(n).padStart(6)}`);
  console.log(`\nTo put it all back:\n  node scripts/dev-orphan-sweep.mjs --undo ${outFile}`);
}

// =================================================================== undo

async function* undoLines(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    n++;
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { throw new Error(`${file}:${n} is not JSON`); }
    if (!obj.table || !(obj.row || obj.nulled)) throw new Error(`${file}:${n} is not an undo line`);
    yield obj;
  }
}

async function undoMode() {
  const file = path.resolve(args.undoFile);
  if (!fs.existsSync(file)) { console.error(`REFUSE: no such undo file ${file}`); process.exit(1); }
  // Pass 1: which tables, in file order.
  const tableOrder = [];
  const seen = new Set();
  let nulledLines = 0;
  for await (const l of undoLines(file)) {
    if (l.nulled) { nulledLines++; continue; }
    if (!seen.has(l.table)) { seen.add(l.table); tableOrder.push(l.table); }
  }
  let failed = 0;
  console.log('\nRE-INSERT, parents first (ON CONFLICT DO NOTHING):');
  for (const t of restoreTableOrder(tableOrder)) {
    const meta = await tableMeta(t);
    const cols = meta.insertCols.map(qi).join(', ');
    const text = `WITH ins AS (INSERT INTO ${qi(t)} (${cols})${meta.identityAlways ? ' OVERRIDING SYSTEM VALUE' : ''}
      SELECT ${cols} FROM jsonb_populate_recordset(NULL::${qi(t)}, $1::jsonb) ON CONFLICT DO NOTHING RETURNING 1)
      SELECT count(*)::int n FROM ins`;
    let seenRows = 0; let inserted = 0; let buf = [];
    const flush = async () => {
      if (!buf.length) return;
      try { const [{ n }] = await sql.query(text, [JSON.stringify(buf)]); inserted += n; }
      catch (e) { failed += buf.length; console.error(`  ${t}: ${buf.length} row(s) failed: ${e.message}`); }
      buf = [];
    };
    for await (const l of undoLines(file)) {
      if (l.table !== t || !l.row) continue;
      buf.push(l.row); seenRows++;
      if (buf.length >= 500) await flush();
    }
    await flush();
    console.log(`  ${t.padEnd(30)} ${String(inserted).padStart(6)} inserted / ${seenRows} in file${inserted < seenRows ? ' (the rest already there)' : ''}`);
  }
  console.log('\nRESTORE nulled columns (only where still NULL):');
  if (!nulledLines) console.log('  none');
  else {
    const groups = new Map();
    for await (const l of undoLines(file)) {
      if (!l.nulled) continue;
      const k = `${l.table}|${Object.keys(l.nulled.set).join(',')}`;
      if (!groups.has(k)) groups.set(k, { table: l.table, cols: Object.keys(l.nulled.set), recs: [] });
      groups.get(k).recs.push({ ...l.nulled.pk, ...l.nulled.set });
    }
    for (const g of groups.values()) {
      const meta = await tableMeta(g.table);
      let restored = 0;
      for (const part of chunks(g.recs, 500)) {
        const text = `WITH u AS (UPDATE ${qi(g.table)} t SET ${g.cols.map((c) => `${qi(c)} = x.${qi(c)}`).join(', ')}
            FROM jsonb_populate_recordset(NULL::${qi(g.table)}, $1::jsonb) x
           WHERE ${meta.pk.map((c) => `t.${qi(c)} = x.${qi(c)}`).join(' AND ')} AND ${g.cols.map((c) => `t.${qi(c)} IS NULL`).join(' AND ')}
          RETURNING 1) SELECT count(*)::int n FROM u`;
        try { const [{ n }] = await sql.query(text, [JSON.stringify(part)]); restored += n; }
        catch (e) { failed += part.length; console.error(`  ${g.table}: ${part.length} value(s) failed: ${e.message}`); }
      }
      console.log(`  ${`${g.table}.${g.cols}`.padEnd(30)} ${String(restored).padStart(6)} restored / ${g.recs.length} in file`);
    }
  }
  if (failed) { console.error(`\n${failed} row(s)/value(s) could not be restored - see above.`); process.exit(1); }
  console.log('\nUndo complete. Running it again changes nothing.');
}

// =================================================================== run
// Last, so every const above is initialised before a mode reads it.

if (args.mode === 'list') await listMode();
else if (args.mode === 'apply') await applyMode();
else await undoMode();
