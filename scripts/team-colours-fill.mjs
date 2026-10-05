#!/usr/bin/env node
// scripts/team-colours-fill.mjs - fill MISSING team colours (teams.color_primary
// / color_secondary) for CFB and the EPL. mon-22. Re-run whenever a new FCS
// opponent or a promoted club appears; it only ever fills NULLs.
//
//   CFB  ONE CFBD call (/teams?year=<year>, every division) through the door in
//        lib/cfbd/client.js, so it is counted. Joined on
//        teams.external_ids->>'cfbd_team_id' = CFBD id; color + alternateColor,
//        exactly what syncCfbTeams (lib/gridiron/sync.js) keeps for FBS. The
//        FCS stubs the game sync creates carry the id and nothing else.
//   EPL  the reviewed static table lib/soccer/teamColors.js, joined on slug.
//        No provider is called.
//
// A team is filled only when BOTH columns are NULL and the source has BOTH
// colours; the UPDATE re-checks both-NULL in SQL, so a colour written between
// the read and the write is never overwritten. Abbreviation is not touched;
// the count of CFB teams without one is reported.
//
//   set -a && . ./.env.local && set +a
//   node scripts/team-colours-fill.mjs                 # dry run, DEV (DATABASE_URL)
//   node scripts/team-colours-fill.mjs --apply         # writes, DEV
//   DATABASE_URL="$PROD_DATABASE_URL" node scripts/team-colours-fill.mjs [--apply]   # PROD
//   --year=2026   CFBD season for /teams (default: the current year)
//   --only=cfb|epl
import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { cfbdGet, withCfbdLedger } from '../lib/cfbd/client.js';
import { EPL_COLORS } from '../lib/soccer/teamColors.js';
import { cfbdColourMap, staticColourMap, planColourFill } from '../lib/teams/colourFill.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const year = Number(args.find((a) => a.startsWith('--year='))?.split('=')[1] ?? new Date().getUTCFullYear());
const only = args.find((a) => a.startsWith('--only='))?.split('=')[1] ?? null;
if (only && !['cfb', 'epl'].includes(only)) { console.error(`--only must be cfb or epl, got ${only}`); process.exit(1); }
if (!Number.isInteger(year) || year < 2000) { console.error(`bad --year ${year}`); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set.'); process.exit(1); }

const sql = neon(process.env.DATABASE_URL);
const fingerprint = crypto.createHash('sha256').update(String(process.env.DATABASE_URL)).digest('hex').slice(0, 12);
const isProd = process.env.PROD_DATABASE_URL && process.env.PROD_DATABASE_URL === process.env.DATABASE_URL;
console.log('='.repeat(74));
console.log(`TARGET        DATABASE_URL -> ${new URL(process.env.DATABASE_URL).host}${isProd ? '  (== PROD_DATABASE_URL)' : ''}`);
console.log(`FINGERPRINT   ${fingerprint}`);
console.log(`LEAGUES       ${only ?? 'cfb, epl'}   CFBD year ${year}`);
console.log(`WRITES        ${apply ? 'YES - --apply given' : 'NO - dry run'}`);
console.log('='.repeat(74));

async function counts(slug) {
  const [r] = await sql`
    SELECT count(*)::int AS teams,
           count(*) FILTER (WHERE t.color_primary IS NULL AND t.color_secondary IS NULL)::int AS none,
           count(*) FILTER (WHERE (t.color_primary IS NULL) <> (t.color_secondary IS NULL))::int AS half,
           count(*) FILTER (WHERE t.abbreviation IS NULL)::int AS no_abbr
      FROM teams t JOIN leagues l ON l.id = t.league_id WHERE l.slug = ${slug}`;
  return r;
}
const fmt = (c) => `${c.teams} teams, ${c.teams - c.none - c.half} coloured, ${c.none} with none, ${c.half} half`;

async function leagueTeams(slug, keyExpr) {
  const rows = await sql`
    SELECT t.id, t.name, t.slug, t.color_primary, t.color_secondary, t.abbreviation, t.metadata,
           t.external_ids->>'cfbd_team_id' AS cfbd_id
      FROM teams t JOIN leagues l ON l.id = t.league_id WHERE l.slug = ${slug} ORDER BY t.name, t.id`;
  return rows.map((r) => ({ ...r, key: keyExpr(r) }));
}

async function writeFills(fills) {
  let updated = 0; const skipped = [];
  for (const f of fills) {
    const r = await sql`
      UPDATE teams SET color_primary = ${f.primary}, color_secondary = ${f.secondary}, updated_at = now()
       WHERE id = ${f.id} AND color_primary IS NULL AND color_secondary IS NULL
       RETURNING id`;
    if (r.length) updated += 1; else skipped.push(f.id);
  }
  return { updated, skipped };
}

async function runLeague(slug, label, teams, colours, extra = () => {}) {
  const before = await counts(slug);
  const plan = planColourFill(teams, colours);
  console.log(`\n--- ${label} (league '${slug}') ---`);
  console.log(`before   ${fmt(before)}`);
  extra(before, teams);
  console.log(`plan     ${plan.fills.length} to fill, ${plan.unfilled.length} unfilled, ${plan.alreadyColoured} already coloured (untouched)`);
  for (const f of plan.fills) console.log(`  FILL  ${slug}  ${f.name.padEnd(28)} id=${String(f.id).padEnd(5)} ${f.primary} ${f.secondary}  ${f.source}`);
  for (const u of plan.unfilled) console.log(`  UNFILLED  ${slug}  ${u.name.padEnd(28)} id=${String(u.id).padEnd(5)} key=${u.key ?? '-'}  ${u.reason}`);
  if (apply) {
    const w = await writeFills(plan.fills);
    console.log(`applied  ${w.updated} updated${w.skipped.length ? `, ${w.skipped.length} skipped (a colour appeared since the read): ${w.skipped.join(', ')}` : ''}`);
  }
  const after = apply ? await counts(slug) : { ...before, none: before.none - plan.fills.length };
  console.log(`after    ${fmt(after)}${apply ? '' : '   (projected)'}`);
  return { slug, before, after, fills: plan.fills.length, unfilled: plan.unfilled };
}

const results = [];

if (!only || only === 'cfb') {
  const teams = await leagueTeams('cfb', (r) => r.cfbd_id);
  const needed = teams.some((t) => t.color_primary == null && t.color_secondary == null && t.cfbd_id);
  let colours = new Map(); let calls = 0;
  if (needed) {
    const { value, ledger } = await withCfbdLedger(() => cfbdGet(`/teams?year=${year}`));
    calls = ledger.calls;
    colours = cfbdColourMap(value);
    console.log(`\nCFBD /teams?year=${year}: ${value.length} rows, ${calls} call(s)${ledger.quota ? `, quota remaining ${ledger.quota.remaining}` : ''}`);
  } else {
    console.log('\nCFB: no colourless team with a cfbd_team_id - CFBD not called');
  }
  results.push(await runLeague('cfb', 'CFB', teams, colours, (_b, ts) => {
    const fcs = ts.filter((t) => t.metadata?.classification === 'fcs');
    console.log(`abbr     ${ts.filter((t) => t.abbreviation == null).length} CFB teams have NULL abbreviation (${fcs.filter((t) => t.abbreviation == null).length} of ${fcs.length} FCS) - not touched here`);
  }));
}

if (!only || only === 'epl') {
  const teams = await leagueTeams('epl', (r) => r.slug);
  const inDb = new Set(teams.map((t) => t.slug));
  const tableOnly = Object.keys(EPL_COLORS).filter((s) => !inDb.has(s));
  results.push(await runLeague('epl', 'EPL', teams, staticColourMap(EPL_COLORS, 'lib/soccer/teamColors.js'), () => {
    if (tableOnly.length) console.log(`table    ${tableOnly.length} slug(s) in the table but not in the DB: ${tableOnly.join(', ')}`);
  }));
}

console.log(`\n${'='.repeat(74)}\nSUMMARY (${apply ? 'applied' : 'dry run'}, fingerprint ${fingerprint})`);
for (const r of results) {
  console.log(`  ${r.slug.padEnd(4)} none ${r.before.none} -> ${r.after.none}   fill ${r.fills}   unfilled ${r.unfilled.length}${r.unfilled.length ? `: ${r.unfilled.map((u) => `${u.name} (${u.reason})`).join('; ')}` : ''}`);
}
