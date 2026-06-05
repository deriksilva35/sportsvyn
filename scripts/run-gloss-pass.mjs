// scripts/run-gloss-pass.mjs
//
// Manual gloss-pass invocation for dev. Bypasses the cron's live/recent
// window filter and processes a specific match by id or slug, using the
// SAME runGlossPassForMatch helper the cron route calls. The dry-run
// proved the generator + envelope + gates; this script proves the
// live-DB write path on dev data.
//
// Dev only. Loads .env.local (DEV branch DATABASE_URL + ANTHROPIC_API_KEY).
// Refuses to run if DATABASE_URL points at winter-dawn (prod).
//
// Run:
//   node scripts/run-gloss-pass.mjs --match-id=218
//   node scripts/run-gloss-pass.mjs --slug=wales-vs-ghana-2026-06-02
//
// What this proves (the verification checklist):
//   1. Gloss writes land in the right rows (per-event log)
//   2. Idempotency — re-running is a no-op (no double-write)
//   3. Empty-string sentinel — dropped events get '', not NULL
//   4. Gate-failing glosses are NEVER persisted as text
//
// What you do AFTER this passes: visit the match page on dev to
// confirm the render layer; flip an event's is_current=false and
// confirm VAR-lockstep.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env.local');

// Minimal .env.local loader (no dotenv dep). Quoted values: strip the
// surrounding double-quotes. Skips comment / blank lines.
function loadEnvLocal(p) {
  let text;
  try { text = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq < 0) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnvLocal(envPath);

function assertDevHost() {
  const u = process.env.DATABASE_URL;
  if (!u) throw new Error('DATABASE_URL missing — populate .env.local');
  const host = new URL(u).hostname;
  if (host.includes('winter-dawn')) {
    throw new Error(`DATABASE_URL points at prod (${host}) — this script is dev-only`);
  }
  console.log(`✓ dev-host: ${host}`);
}

function parseArgs() {
  const args = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

assertDevHost();
if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY missing — populate .env.local');
}
console.log(`✓ ANTHROPIC_API_KEY present`);

const { sql } = await import('../lib/db.js');
const { runGlossPassForMatch } = await import('../lib/glossPass.js');

const args = parseArgs();
let matchId = args['match-id'] ? Number(args['match-id']) : null;

if (!matchId && args.slug) {
  const rows = await sql`SELECT id FROM matches WHERE slug = ${args.slug}`;
  if (rows.length === 0) {
    console.error(`No match for slug "${args.slug}"`);
    process.exit(1);
  }
  matchId = rows[0].id;
}

if (!matchId) {
  console.error('usage: node scripts/run-gloss-pass.mjs --match-id=<n> | --slug=<s>');
  process.exit(1);
}

const r = await runGlossPassForMatch(matchId);
if (r.error) {
  console.error(`ERR: ${r.error} (match_id=${matchId})`);
  process.exit(1);
}

console.log(`\n${'='.repeat(80)}`);
console.log(`Match #${r.match_id}: ${r.slug}`);
console.log(`Candidates (qualifying + gloss IS NULL): ${r.candidates}`);
console.log('='.repeat(80));

if (r.results.length === 0) {
  console.log('(nothing to do — no NULL-gloss qualifying events on this match)');
} else {
  for (const e of r.results) {
    const minute = e.minute_extra ? `${e.minute}+${e.minute_extra}'` : `${e.minute}'`;
    const tag = `${minute.padStart(6)}  ${(e.event_type ?? '?').padEnd(5)} · ${(e.detail ?? '').padEnd(15)}`;
    const player = e.player ?? '?';
    console.log(`\n  ${tag}  ${player}`);
    if (e.raced) {
      console.log(`    RACED — another writer beat us, no row updated (already had a gloss)`);
    } else if (e.outcome === 'kept') {
      console.log(`    KEPT:    "${e.gloss}"`);
    } else if (e.outcome === 'dropped') {
      console.log(`    DROPPED: ${e.reason}    (wrote '' sentinel)`);
    } else if (e.outcome === 'error') {
      console.log(`    ERROR:   ${e.reason}    (wrote '' sentinel)`);
    }
  }
}

const kept    = r.results.filter((x) => x.outcome === 'kept').length;
const dropped = r.results.filter((x) => x.outcome === 'dropped').length;
const errored = r.results.filter((x) => x.outcome === 'error').length;
console.log(`\nSUMMARY: kept=${kept}  dropped=${dropped}  errored=${errored}`);
