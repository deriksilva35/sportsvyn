// scripts/team-palette-export.mjs - team palettes for the iOS app, keyed by the
// abbreviation the site SENDS (lib/live/teamAbbr.js resolveAbbr, the value
// startLiveActivity carries), not by the stored column. Read-only.
//
//   set -a && . ./.env.local && set +a
//   node scripts/team-palette-export.mjs > exports/team-palettes.json
//
// MLB is keyed off the stored abbreviation alone: its game page passes
// shortName in camelCase, which resolveAbbr does not read (all 30 clubs have
// one). Football passes short_name, the middle of resolveAbbr's three sources.
// A key two teams would both send is REFUSED - printed to stderr, exit 1 -
// rather than written with whichever came last.

import { neon } from '@neondatabase/serverless';
import { resolveAbbr } from '../lib/live/teamAbbr.js';

const url = process.env.PROD_DATABASE_URL;
if (!url) { console.error('REFUSE: PROD_DATABASE_URL missing in env'); process.exit(1); }
const sql = neon(url);

const out = { generated: new Date().toISOString(), source: 'PROD teams.color_primary / color_secondary', key: 'the abbreviation startLiveActivity sends (resolveAbbr)' };
let bad = false;
for (const lg of ['cfb', 'mlb']) {
  const rows = await sql`
    SELECT t.name, t.abbreviation, t.short_name, t.color_primary, t.color_secondary,
           t.metadata->>'classification' AS cls
      FROM teams t JOIN leagues l ON l.id = t.league_id AND l.slug = ${lg}
     ORDER BY t.name`;
  const m = {};
  for (const r of rows) {
    const s = resolveAbbr(lg === 'mlb' ? { abbreviation: r.abbreviation, name: r.name } : r);
    if (!s.value) continue;
    if (m[s.value]) { console.error(`REFUSE: ${lg} ${s.value} is sent by both ${m[s.value].name} and ${r.name}`); bad = true; continue; }
    m[s.value] = {
      name: r.name,
      primary: r.color_primary ?? null,
      secondary: r.color_secondary ?? null,
      ...(lg === 'cfb' ? { fbs: r.cls === 'fbs' } : {}),
      ...(s.source !== 'abbreviation' ? { keySource: s.source } : {}),
    };
  }
  out[lg] = Object.fromEntries(Object.keys(m).sort().map((k) => [k, m[k]]));
}
if (bad) process.exit(1);
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
