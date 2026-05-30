// scripts/backfill-groups.mjs — populate matches.group_code for WC fixtures.
//
// API-Sports's `league.round` for the 2026 World Cup carries only matchday
// ("Group Stage - 1/2/3"), not the group letter. So this script pulls group
// memberships from /standings via lib/wcGroups, hard-asserts the data is
// sane (12 groups × 4 teams = 48 distinct teams, no duplicates), prints the
// full A–L listing for human eyeball, then UPDATEs matches.group_code for
// every WC group-stage row using the home (or away, as fallback) team's
// api_sports id as the join key. Idempotent — re-running only touches rows
// whose stored value differs.
//
// Refuses to write any row if the integrity assertions fail.

import { sql } from '../lib/db.js';
import { fetchWcGroups, assertWcGroupsIntegrity } from '../lib/wcGroups.js';

console.log('=== Fetching WC group standings ===');
const { groups, map, duplicates } = await fetchWcGroups();
console.log(`groups returned: ${groups.length}`);
console.log(`teams mapped:    ${map.size}`);

const issues = assertWcGroupsIntegrity({ groups, map, duplicates });
if (issues.length) {
  console.error('\n*** INTEGRITY FAILURE ***');
  for (const i of issues) console.error('  ✗ ' + i);
  console.error('\nNo writes performed. Fix the upstream source or the filter, then retry.');
  process.exit(1);
}

console.log('\n=== Full group listing (eyeball against the official draw) ===');
for (const g of groups) {
  console.log(`  Group ${g.letter}: ${g.teams.map((t) => t.name).join(', ')}`);
}

const [{ id: leagueId }] = await sql`SELECT id FROM leagues WHERE slug='fifa-wc-2026'`;
if (!leagueId) {
  console.error('No fifa-wc-2026 league row — run import-wc.mjs first.');
  process.exit(1);
}

const matches = await sql`
  SELECT
    m.id, m.slug, m.group_code,
    h.external_ids->>'api_sports' AS home_api_id,
    a.external_ids->>'api_sports' AS away_api_id,
    h.name AS home, a.name AS away
  FROM matches m
  LEFT JOIN teams h ON h.id = m.home_team_id
  LEFT JOIN teams a ON a.id = m.away_team_id
  WHERE m.league_id = ${leagueId} AND m.stage = 'group'
`;
console.log(`\n=== Updating matches.group_code (candidates: ${matches.length}) ===`);

let updated = 0;
let alreadySet = 0;
let unresolved = 0;
for (const m of matches) {
  // Either team's api_id should map to the group; both should agree since
  // every group-stage match is intra-group. Prefer home, fall back to away
  // (defensive — the standings source should be authoritative for both).
  const fromHome = map.get(m.home_api_id);
  const fromAway = map.get(m.away_api_id);
  const letter = fromHome ?? fromAway ?? null;
  if (!letter || !/^[A-L]$/.test(letter)) {
    unresolved++;
    console.log(`  [unresolved] ${m.home} vs ${m.away}  home_api=${m.home_api_id} away_api=${m.away_api_id}`);
    continue;
  }
  if (fromHome && fromAway && fromHome !== fromAway) {
    console.log(`  [WARN cross-group match!] ${m.home} (${fromHome}) vs ${m.away} (${fromAway}) — using ${letter}`);
  }
  if (m.group_code === letter) {
    alreadySet++;
    continue;
  }
  await sql`UPDATE matches SET group_code = ${letter}, updated_at = now() WHERE id = ${m.id}`;
  updated++;
}

console.log(`\nsummary: updated=${updated}  already_set=${alreadySet}  unresolved=${unresolved}`);

console.log('\n=== Final distribution (expect A..L × 6) ===');
const dist = await sql`
  SELECT group_code, count(*)::int AS n
  FROM matches
  WHERE league_id = ${leagueId} AND stage='group'
  GROUP BY group_code
  ORDER BY group_code NULLS LAST
`;
for (const r of dist) console.log(`  Group ${r.group_code ?? '(NULL)'}: ${r.n}`);
