// scripts/footballdbImportDryRun.test.mjs - the Data Keeper's job script writes NOTHING without --apply.
//
// crew/bin/data-keeper runs the top data-queue job's `dry-run` command (crew/lib/dataKeeper.mjs
// refuses one that carries an apply flag, and runs it as the read-only crew_reader). This pins the
// script's own default, the third layer: run exactly the queue's footballdb dry-run command, with
// no flags, against the test database, and check that the only two tables it can write
// (lib/footballdb/identity.js createPlayer -> nfl_players, lib/footballdb/seasonTxn.js ->
// nfl_player_season_totals) did not change.
//
// Scoped so a parallel test file cannot make it flake: season totals are compared only for the
// job's own source and seasons (server-side count + md5, with xmin so even an identical rewrite
// shows), and nfl_players only for rows newer than the run's start whose full_name is a name in the
// job's own workbooks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../lib/db.js';
import { parseQueue } from '../crew/lib/dataKeeper.mjs';
import { readWorkbook } from '../lib/footballdb/xlsxReader.js';
import { toSeasonRows } from '../lib/footballdb/parse.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKBOOK_DIR = path.join(ROOT, '.data', 'footballdb', 'NFL_Player_Stats_1980-1999');

const totalsFingerprint = async (years) => {
  const [r] = await sql`
    SELECT count(*)::int AS n,
           md5(COALESCE(string_agg(t.xmin::text || t::text, '|' ORDER BY t.nfl_player_id, t.season_year, t.team_key), '')) AS h
    FROM nfl_player_season_totals t
    WHERE t.source = 'footballdb' AND t.season_year = ANY(${years})`;
  return r;
};

test('footballdb-import with no flags (the queue\'s dry-run command) writes nothing to the database', async () => {
  const jobs = parseQueue(readFileSync(path.join(ROOT, 'docs', 'crew', 'data-queue.md'), 'utf8'));
  const job = jobs.find((j) => j.fields.parser === 'footballdb-import' && !j.checked);
  assert.ok(job, 'an open footballdb-import job in docs/crew/data-queue.md');
  const [node, script, ...args] = job.fields['dry-run'].split(/\s+/);
  assert.equal(node, 'node');
  assert.equal(script, 'scripts/footballdb-import.mjs');
  assert.ok(!args.some((a) => /apply/i.test(a)), 'the dry-run command carries no apply flag');
  assert.ok(job.fields.apply.includes('--apply'), 'writing takes an explicit --apply');

  const [lo, hi] = args.find((a) => /^\d{4}(-\d{4})?$/.test(a)).split('-').map(Number);
  const years = Array.from({ length: (hi ?? lo) - lo + 1 }, (_, i) => lo + i);
  const names = new Set();
  for (const y of years) for (const r of toSeasonRows(readWorkbook(path.join(WORKBOOK_DIR, `NFL_${y}_Player_Stats.xlsx`)))) names.add(r.rawName);
  assert.ok(names.size > 0, 'the job\'s workbooks have rows');

  const before = await totalsFingerprint(years);
  const [{ max: maxIdBefore }] = await sql`SELECT COALESCE(max(id), 0)::bigint AS max FROM nfl_players`;

  const run = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, env: process.env, encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /WRITES {3}NO — dry run/);
  assert.match(run.stdout, /DRY RUN — nothing written/);

  assert.deepEqual(await totalsFingerprint(years), before, 'nfl_player_season_totals unchanged for the job\'s seasons');
  const [{ n: minted }] = await sql`
    SELECT count(*)::int AS n FROM nfl_players WHERE id > ${maxIdBefore} AND full_name = ANY(${[...names]})`;
  assert.equal(minted, 0, 'no nfl_players row minted for a name in the job\'s workbooks');
});
