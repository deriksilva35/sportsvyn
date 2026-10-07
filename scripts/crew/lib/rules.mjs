// ~/crew/lib/rules.mjs - run Watcher rules from docs/crew/watch-rules.md (the ONE source of the SQL).
// Usage: node rules.mjs G1 G2 ... | node rules.mjs --prefix G|P   (CREW_DB_URL = a crew_reader URL)
// A rule FIRES when its query returns rows. Read-only: crew_reader cannot write.
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
const HOME = process.env.HOME;
const require = createRequire(`${HOME}/deploy/sportsvyn/current/package.json`);
const { neon } = require('@neondatabase/serverless');
const file = process.env.WATCH_RULES ?? `${HOME}/deploy/sportsvyn/current/docs/crew/watch-rules.md`;
if (!existsSync(file)) { console.error(`no rules file at ${file} (not deployed yet? set WATCH_RULES)`); process.exit(2); }
const md = readFileSync(file, 'utf8');
const rules = [];
for (const sec of md.split(/^## /m).slice(1)) {
  const m = sec.match(/^([A-Z]\d+) - (.*)$/m); if (!m) continue;
  const q = sec.match(/```sql\n([\s\S]*?)```/); if (!q) continue;
  rules.push({ id: m[1], title: m[2].trim(), sql: q[1] });
}
const args = process.argv.slice(2);
const pi = args.indexOf('--prefix');
const want = pi >= 0 ? rules.filter((r) => args[pi + 1].split(',').some((p) => r.id.startsWith(p))) : rules.filter((r) => args.includes(r.id));
const sql = neon(process.env.CREW_DB_URL);
let fired = 0, failed = 0;
for (const r of want) {
  try {
    const rows = await sql.query(r.sql);
    if (!rows.length) { console.log(`ok     ${r.id}  ${r.title}`); continue; }
    fired++;
    console.log(`FIRES  ${r.id}  ${r.title}  (${rows.length} row${rows.length > 1 ? 's' : ''})`);
    for (const row of rows.slice(0, 5)) console.log('         ' + JSON.stringify(row).slice(0, 200));
  } catch (e) { failed++; console.log(`ERROR  ${r.id}  ${r.title}: ${e.message.slice(0, 120)}`); }
}
console.log(`${want.length} rules: ${fired} firing, ${failed} errored (${file.includes('/deploy/') ? 'deployed rules' : file})`);
process.exit(failed ? 2 : fired ? 1 : 0);
