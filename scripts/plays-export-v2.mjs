#!/usr/bin/env node
// scripts/plays-export-v2.mjs - a season's NFL + CFB plays as JSON lines, for
// the Mac's win-prob validation export (~/exports/winprob-<date>/).
//
// Same column set, key order and value shapes as that folder's plays.jsonl
// (id as the driver returns a BIGINT - a string; timestamps ISO-8601 UTC),
// PLUS the end-of-play state from migration 123. Written after the 2026 NFL
// re-import (scripts/nfl-plays-reimport.mjs) as plays-v2.jsonl, so the
// corrected offense_team_id and the new columns travel together.
//
// STREAMED: keyset pages of 2,000 by id, each written and dropped before the
// next is read - never the table in memory (8 GB droplet). Written to a .tmp
// and renamed, so a killed run leaves no half-file under the real name.
// SHA256SUMS is not touched; the sha256 line is printed for the caller.
//
//   set -a && . ./.env.local && set +a
//   node scripts/plays-export-v2.mjs --prod --out ~/exports/winprob-2026-10-02
//   ... [--season 2026] [--name plays-v2.jsonl] [--force]

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { once } from 'node:events';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };

const wantProd = has('--prod');
if (wantProd) {
  if (!process.env.PROD_DATABASE_URL) { console.error('--prod given but PROD_DATABASE_URL is not set'); process.exit(1); }
  process.env.DATABASE_URL = process.env.PROD_DATABASE_URL;
}
const outDir = valueOf('--out');
const name = valueOf('--name') ?? 'plays-v2.jsonl';
const season = Number(valueOf('--season') ?? 2026);
const PAGE = 2000;
if (!outDir) { console.error('usage: plays-export-v2.mjs --out <dir> [--prod] [--season 2026] [--name plays-v2.jsonl] [--force]'); process.exit(1); }
if (name === 'plays.jsonl') { console.error('refusing: plays.jsonl is the pre-fix snapshot and is not overwritten'); process.exit(1); }
const file = path.join(outDir, name);
if (fs.existsSync(file) && !has('--force')) { console.error(`refusing: ${file} exists (pass --force to replace it)`); process.exit(1); }

const { sql } = await import('../lib/db.js');
if (wantProd && process.env.DATABASE_URL !== process.env.PROD_DATABASE_URL) { console.error('refusing: --prod but DATABASE_URL is not PROD'); process.exit(1); }
const [col] = await sql`
  SELECT count(*)::int n FROM information_schema.columns
   WHERE table_name = 'plays' AND column_name IN ('end_down', 'end_distance', 'end_yards_to_goal')`;
if (col.n !== 3) { console.error('refusing: migration 123 (end-of-play columns) is not applied on this database'); process.exit(1); }

/** One page of plays after `afterId`, in id order. */
async function page(afterId) {
  return sql`
    SELECT p.id, p.match_id, l.slug AS league, p.provider_play_id, p.drive_id, p.drive_number, p.play_number,
           p.period, p.clock, p.down, p.distance, p.yards_to_goal, p.yards_gained, p.offense_team_id,
           p.play_type, p.text, p.home_score, p.away_score, p.scoring, p.created_at,
           p.end_down, p.end_distance, p.end_yards_to_goal
      FROM plays p JOIN matches m ON m.id = p.match_id JOIN leagues l ON l.id = m.league_id
     WHERE l.slug IN ('nfl', 'cfb') AND m.season_year = ${season} AND p.id > ${afterId}
     ORDER BY p.id LIMIT ${PAGE}`;
}

fs.mkdirSync(outDir, { recursive: true });
const tmp = `${file}.tmp`;
const out = fs.createWriteStream(tmp);
const hash = crypto.createHash('sha256');
const count = { nfl: 0, cfb: 0 };
let after = 0, pages = 0;
for (;;) {
  const rows = await page(after);
  if (!rows.length) break;
  pages++;
  for (const r of rows) {
    const line = `${JSON.stringify(r)}\n`;
    hash.update(line);
    if (!out.write(line)) await once(out, 'drain');
    count[r.league] = (count[r.league] ?? 0) + 1;
  }
  after = rows.at(-1).id;
}
out.end(); await once(out, 'finish');
fs.renameSync(tmp, file);
const digest = hash.digest('hex');
console.log(`${wantProd ? 'PROD' : 'dev'} ${season}: ${count.nfl + count.cfb} plays (nfl ${count.nfl}, cfb ${count.cfb}) in ${pages} page(s) -> ${file}`);
console.log(`sha256 line for SHA256SUMS:\n${digest}  ${name}`);
