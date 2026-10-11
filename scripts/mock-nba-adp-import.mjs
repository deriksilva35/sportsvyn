#!/usr/bin/env node
// scripts/mock-nba-adp-import.mjs - load the NBA mock's ADP list into mock_nba_adp (sun-7).
//
//   node scripts/mock-nba-adp-import.mjs [--apply] [--file lib/mockNba/data/adp-2026-10-11.tsv]
//
// Reads the TSV (rank, name, team, positions - nothing else), matches it to the
// season's stored pool (nba_mock_pool on DATABASE_URL), prints matched /
// unmatched / team differences, and with --apply replaces the table. Dry run by
// default. PROD: DATABASE_URL="$PROD_DATABASE_URL" (credential from the env only).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseAdpList, matchAdp, storeAdp } from '../lib/mockNba/adp.js';
import { readNbaMockPool } from '../lib/mockNba/pool.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const fi = args.indexOf('--file');
const file = fi >= 0 ? args[fi + 1] : 'lib/mockNba/data/adp-2026-10-11.tsv';
const sourceDate = (path.basename(file).match(/(\d{4}-\d{2}-\d{2})/) ?? [])[1];
if (!sourceDate) { console.error('file name must carry the list date (YYYY-MM-DD)'); process.exit(2); }

const list = parseAdpList(readFileSync(file, 'utf8'));
const pool = await readNbaMockPool();
if (!pool?.rows?.length) { console.error('no stored pool - build it first'); process.exit(1); }
const { matched, unmatched, staleTeams } = matchAdp(list, pool.rows);
console.log(`list ${list.length} / pool ${pool.rows.length} (built ${pool.builtAt}) / matched ${matched.length} / unmatched ${unmatched.length} / team differs ${staleTeams.length}`);
console.log('UNMATCHED:'); for (const u of unmatched) console.log(`  ${u.rank}\t${u.name}\t${u.team ?? ''}`);
console.log('TEAM DIFFERS (list -> ours, ours kept):'); for (const s of staleTeams) console.log(`  ${s.rank}\t${s.name}\t${s.listTeam} -> ${s.ourTeam}`);
if (!apply) { console.log('dry run - pass --apply to write'); process.exit(0); }
console.log(`stored ${await storeAdp(matched, sourceDate)} rows (source_date ${sourceDate})`);
