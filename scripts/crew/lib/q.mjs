// ~/crew/lib/q.mjs - run read-only SQL as crew_reader. Usage: node q.mjs <file.sql | -e "SQL"> [--json]
// The role itself is read-only (no write grants, default_transaction_read_only on).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(`${process.env.HOME}/deploy/sportsvyn/current/package.json`);
const { neon } = require('@neondatabase/serverless');
const url = process.env.CREW_DB_URL; if (!url) { console.error('CREW_DB_URL not set'); process.exit(2); }
const a = process.argv.slice(2); const json = a.includes('--json');
const text = a[0] === '-e' ? a[1] : readFileSync(a[0], 'utf8');
const rows = await neon(url).query(text);
if (json) { console.log(JSON.stringify(rows)); process.exit(0); }
if (!rows.length) { console.log('(no rows)'); process.exit(0); }
const cols = Object.keys(rows[0]);
const cell = (v) => v instanceof Date ? v.toISOString().replace('.000Z', 'Z') : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
const w = cols.map((c) => Math.min(60, Math.max(c.length, ...rows.map((r) => cell(r[c]).length))));
console.log(cols.map((c, i) => c.padEnd(w[i])).join('  '));
for (const r of rows) console.log(cols.map((c, i) => cell(r[c]).slice(0, 60).padEnd(w[i])).join('  '));
