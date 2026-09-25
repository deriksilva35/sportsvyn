#!/usr/bin/env node
// scripts/dev-orphan-sweep.mjs - LIST the test fixtures left on DEV. Read-only.
//
//   set -a && . ./.env.local && set +a
//   node scripts/dev-orphan-sweep.mjs
//
// WHY. A killed test run skips ALL of its teardown, not just the table you
// were thinking about. On 25 Sep a suite stopped mid-file left pickem.test's
// league, teams, matches and contest on DEV; the check after the kill looked
// only for sentinel MATCHES, found none, and the next suite failed on a
// duplicate league slug. This lists every kind of fixture the suite creates.
//
// HOW A ROW IS RECOGNISED - by the conventions the tests already follow, not
// by a list of prefixes that would go stale the next time a test is written:
//   users     an email on a reserved test domain (@example.invalid, *.test)
//   leagues   a slug that starts with sentinel- or contains "test"
//   teams     in a fixture league, or a slug like a fixture's
//   matches   in a fixture league, or a slug like a fixture's
//   contests  a sport that is not a real league's slug, or a board naming a
//             fixture match
// Anything it prints is a candidate, not a verdict: read it before deleting.
//
// IT DELETES NOTHING, and it refuses to run against PROD - PROD's fixtures
// are a different question with a different answer.

import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) { console.error('REFUSE: DATABASE_URL missing in env'); process.exit(1); }
if (process.env.PROD_DATABASE_URL && url === process.env.PROD_DATABASE_URL) {
  console.error('REFUSE: DATABASE_URL is PROD. This sweep is for DEV.'); process.exit(1);
}
const sql = neon(url);
console.log(`TARGET ${new URL(url).host} | FP ${crypto.createHash('sha256').update(url).digest('hex').slice(0, 12)} | LIST ONLY`);

const SLUG_RX = '(^sentinel-|test|^prefsroute-)';
const EMAIL_RX = '(@example\\.invalid$|@[a-z0-9.-]*\\.test$)';

const leagues = await sql`SELECT id, slug, created_at FROM leagues WHERE slug ~* ${SLUG_RX} ORDER BY created_at`;
const leagueIds = leagues.map((l) => l.id);
const teams = await sql`
  SELECT id, slug, league_id, created_at FROM teams
   WHERE league_id = ANY(${leagueIds}) OR slug ~* ${SLUG_RX} ORDER BY created_at LIMIT 500`;
const matches = await sql`
  SELECT id, slug, league_id, status, created_at FROM matches
   WHERE league_id = ANY(${leagueIds}) OR slug ~* ${SLUG_RX} ORDER BY created_at LIMIT 500`;
const matchIds = matches.map((m) => m.id);
const real = (await sql`SELECT slug FROM leagues WHERE NOT (slug ~* ${SLUG_RX})`).map((r) => r.slug);
const contests = await sql`
  SELECT c.id, c.game_type, c.sport, c.season_year, c.created_at FROM contests c
   WHERE NOT (c.sport = ANY(${real}))
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.board) = 'array' THEN c.board ELSE '[]'::jsonb END) g
                  WHERE (g->>'match_id') ~ '^[0-9]+$' AND (g->>'match_id')::int = ANY(${matchIds}))
   ORDER BY c.created_at LIMIT 500`;
const users = await sql`SELECT id, email, created_at FROM users WHERE email ~* ${EMAIL_RX} ORDER BY created_at DESC LIMIT 50`;
const [{ n: userCount }] = await sql`SELECT count(*)::int n FROM users WHERE email ~* ${EMAIL_RX}`;

const day = (d) => new Date(d).toISOString().slice(0, 16).replace('T', ' ');
const show = (name, rows, fmt) => {
  console.log(`\n${name}: ${rows.length}`);
  for (const r of rows.slice(0, 50)) console.log(`  ${fmt(r)}`);
  if (rows.length > 50) console.log(`  ... and ${rows.length - 50} more`);
};
show('leagues', leagues, (r) => `${String(r.id).padStart(6)}  ${r.slug}  (${day(r.created_at)})`);
show('teams', teams, (r) => `${String(r.id).padStart(6)}  ${r.slug}  league ${r.league_id}  (${day(r.created_at)})`);
show('matches', matches, (r) => `${String(r.id).padStart(6)}  ${r.slug}  ${r.status}  (${day(r.created_at)})`);
show('contests', contests, (r) => `${String(r.id).padStart(6)}  ${r.game_type} ${r.sport} ${r.season_year ?? ''}  (${day(r.created_at)})`);
console.log(`\nusers: ${userCount}${userCount > users.length ? ` (newest ${users.length} shown)` : ''}`);
for (const r of users) console.log(`  ${String(r.id).padStart(6)}  ${r.email}  (${day(r.created_at)})`);

const total = leagues.length + teams.length + matches.length + contests.length + userCount;
console.log(`\n${total ? `${total} fixture row(s) on DEV. Read them before deleting; nothing was changed.` : 'DEV is clean: no fixture rows.'}`);
