// scripts/generate-daily-card-intro.mjs
//
// Manual trigger for the Daily Card intro generator. DEV-only host
// guard. Stores the result as pending_review — caller approves via
// /admin/daily-card before it surfaces on the homepage.
//
// Usage:
//   node scripts/generate-daily-card-intro.mjs            # today (PT)
//   node scripts/generate-daily-card-intro.mjs 2026-06-11 # specific day

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
loadEnvLocal(path.resolve(__dirname, '..', '.env.local'));

const host = new URL(process.env.DATABASE_URL).hostname;
if (host.includes('winter-dawn')) {
  console.error('REFUSE: this script targets DEV only; saw PROD host', host);
  process.exit(1);
}
console.log('✓ host (DEV):', host);

const { sql } = await import('../lib/db.js');
const { runDailyCardIntroForDay } = await import('../lib/dailyCardIntro.js');

let ptDay = process.argv[2];
if (!ptDay) {
  const r = await sql`SELECT to_char((now() AT TIME ZONE 'America/Los_Angeles')::date, 'YYYY-MM-DD') AS d`;
  ptDay = r[0].d;
}

console.log('Generating Daily Card intro for PT day:', ptDay);
const result = await runDailyCardIntroForDay({ ptDay });

if (!result.ok) {
  console.error('GEN FAILED:', result.error);
  if (result.raw) console.error('raw:', result.raw.slice(0, 800));
  process.exit(2);
}

console.log('\n=== ENVELOPE SUMMARY (what the AI saw) ===');
console.log('  slate:           ' + result.envelope.slate.length + ' fixtures');
console.log('  live_matches:    ' + result.envelope.live_matches.length);
console.log('  next_fixtures:   ' + result.envelope.next_fixtures.length);
console.log('  power_five:      ' + result.envelope.power_five.length + ' teams');

console.log('\n=== VALIDATION ===');
console.log('  validation.ok:   ' + result.validation.ok);
console.log('  word_count:      ' + result.validation.word_count);
if (!result.validation.ok) {
  console.log('  issues:');
  for (const i of result.validation.issues) console.log('    · ' + i);
}

console.log('\n=== STORED ROW (status=pending_review) ===');
console.log('  id:              ' + result.row.id);
console.log('  pt_day:          ' + result.row.pt_day);
console.log('  status:          ' + result.row.status);
console.log('  generated_at:    ' + result.row.generated_at);

console.log('\n=== BODY (NOT YET PUBLISHED) ===');
console.log(result.row.body);

console.log('\n→ review/approve at /admin/daily-card (DEV)');
console.log('  homepage continues to show the static placeholder until status=published');
