// scripts/ranking-entries-resolve-teams.mjs — attach team_id to ranking_entries.
//
// WHY THIS IS A SCRIPT AND NOT A ONE-OFF. Editorial lists are seeded by paste:
// somebody writes 32 team names into an edition, and nothing in that gesture
// carries a team id. Every future edition of nfl-power arrives the same way, so
// this runs again on every Tuesday re-seed that does not set team_id itself.
//
// EXACT NAME MATCH, SCOPED TO THE LIST'S OWN LEAGUE. No fuzzy matching, no
// ILIKE, no contains: "St. Francis" is three different schools and a loose
// comparison is how a Pennsylvania row ends up attached to an Indiana club.
// A row that does not resolve is REPORTED AND LEFT ALONE - a wrong team_id is
// worse than a null one, because a null renders no record and a wrong one
// renders somebody else's.
//
// Usage:  set -a && . ./.env.local && set +a
//         node scripts/ranking-entries-resolve-teams.mjs [--apply] [list-slug ...]
// Default is a DRY RUN. Nothing is written without --apply.

import { neon } from '@neondatabase/serverless';

const url = process.env.PROD_DATABASE_URL;
if (!url) throw new Error('PROD_DATABASE_URL missing in env');
const sql = neon(url);

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const lists = args.filter((a) => !a.startsWith('--'));
const TARGETS = lists.length ? lists : ['nfl-power', 'cfb-top25'];

let unresolvedTotal = 0;

for (const listSlug of TARGETS) {
  const rows = await sql`
    SELECT e.id, e.rank, e.selection_label, e.team_id AS current_team_id,
           lg.slug AS league, t.id AS resolved_id, t.abbreviation
      FROM ranking_entries e
      JOIN ranking_editions ed ON ed.id = e.ranking_edition_id
                              AND ed.is_current AND ed.status = 'published'
      JOIN ranking_lists rl ON rl.id = ed.ranking_list_id
      JOIN leagues lg ON lg.id = rl.league_id
      LEFT JOIN teams t ON t.league_id = lg.id
                       AND lower(t.name) = lower(e.selection_label)
     WHERE rl.slug = ${listSlug}
     ORDER BY e.rank`;

  if (!rows.length) { console.log(`\n${listSlug}: no current published edition`); continue; }
  const unresolved = rows.filter((r) => r.resolved_id == null);
  const toWrite = rows.filter((r) => r.resolved_id != null && r.current_team_id !== r.resolved_id);
  unresolvedTotal += unresolved.length;

  console.log(`\n=== ${listSlug} (${rows[0].league}) — ${rows.length} entries`);
  console.log(`    resolved ${rows.length - unresolved.length}, unresolved ${unresolved.length}, to write ${toWrite.length}`);
  for (const r of rows) {
    console.log(`    #${String(r.rank).padStart(2)}  ${String(r.selection_label).padEnd(24)}`
      + `  ${r.resolved_id ?? 'UNRESOLVED'}  ${r.abbreviation ?? ''}`);
  }
  for (const r of unresolved) console.log(`    !! no team named ${JSON.stringify(r.selection_label)} in ${r.league}`);

  if (apply && toWrite.length) {
    for (const r of toWrite) {
      await sql`UPDATE ranking_entries SET team_id = ${r.resolved_id} WHERE id = ${r.id}`;
    }
    const [after] = await sql`
      SELECT count(*)::int n, count(team_id)::int with_team
        FROM ranking_entries e
        JOIN ranking_editions ed ON ed.id = e.ranking_edition_id AND ed.is_current AND ed.status='published'
        JOIN ranking_lists rl ON rl.id = ed.ranking_list_id
       WHERE rl.slug = ${listSlug}`;
    console.log(`    WROTE ${toWrite.length}. after: ${after.with_team}/${after.n} entries carry a team_id`);
  }
}

console.log(apply ? '\napplied.' : '\nDRY RUN - nothing written. Re-run with --apply.');
if (unresolvedTotal) {
  console.log(`${unresolvedTotal} unresolved entr${unresolvedTotal === 1 ? 'y' : 'ies'} left null on purpose.`);
}
