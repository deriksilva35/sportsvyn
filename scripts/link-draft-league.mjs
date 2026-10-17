// scripts/link-draft-league.mjs - THE ONE-STEP MOVE of a Fantrax draft league
// into a player league (Leagues slice 3, option B, fri-3).
//
//   node scripts/link-draft-league.mjs --config <id>                 DEV, dry run
//   node scripts/link-draft-league.mjs --config <id> --apply         DEV
//   DATABASE_URL="$PROD_DATABASE_URL" node scripts/link-draft-league.mjs --config 225 --prod          PROD dry run
//   DATABASE_URL="$PROD_DATABASE_URL" node scripts/link-draft-league.mjs --config 225 --prod --apply  PROD (GO only)
//
// Credentials from the environment only (CLAUDE.md). lib/db.js reads
// DATABASE_URL, so PROD is reached by setting it to PROD_DATABASE_URL, and the
// script REFUSES unless --prod is given exactly when they match - a typo cannot
// point a "DEV" run at PROD or the reverse.
//
// WHAT IT WRITES (lib/leagues/draftLink.js linkConfigToNewLeague, one statement):
// a player league (kind 'fantasy', owner = the importer, size = teams_count,
// fresh code and link), every draft member as a league member with a join line,
// and draft_configs.league_id. The draft side - members, claims, keepers,
// invites, runs, picks - is counted before and after and must not move.
// UNDO: UPDATE draft_configs SET league_id = NULL WHERE id = <config>;
//       DELETE FROM player_leagues WHERE id = <league>;   (members/events cascade)

import { linkConfigToNewLeague } from '../lib/leagues/draftLink.js';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const PROD = process.argv.includes('--prod');
const APPLY = process.argv.includes('--apply');
const configId = Number(arg('--config'));

const isProd = process.env.DATABASE_URL && process.env.DATABASE_URL === process.env.PROD_DATABASE_URL;
if (PROD !== Boolean(isProd)) {
  console.error(PROD ? 'refusing: --prod given but DATABASE_URL is not PROD_DATABASE_URL'
    : 'refusing: DATABASE_URL is PROD - pass --prod to mean it');
  process.exit(2);
}
if (!Number.isInteger(configId) || configId <= 0) { console.error('usage: --config <id> [--prod] [--apply]'); process.exit(2); }

const host = new URL(process.env.DATABASE_URL).host;
console.log(`TARGET ${PROD ? 'PROD' : 'DEV'} ${host} · config ${configId} · ${APPLY ? 'APPLY' : 'dry run'}`);

const res = await linkConfigToNewLeague(configId, { apply: APPLY });
if (!res.ok) { console.error(`REFUSED: ${res.reason} (${res.code})`); process.exit(1); }
const p = res.plan;
console.log(`league: "${p.league.name}" · kind fantasy · owner user ${p.league.ownerId} · size ${p.league.maxMembers} (= teams)`);
console.log(`members: ${p.members.length} (users ${p.members.map((m) => m.userId).join(', ')})`);
console.log(`draft side BEFORE: ${JSON.stringify(res.before)}`);
if (res.dryRun) { console.log('DRY RUN - nothing written. Add --apply to write.'); process.exit(0); }

console.log(`wrote: league ${res.leagueId} · ${res.wrote.members} members · ${res.wrote.events} join lines · ${res.wrote.linked} link`);
console.log(`draft side AFTER:  ${JSON.stringify(res.after)}`);
const same = JSON.stringify(res.before) === JSON.stringify(res.after);
console.log(`draft side unchanged: ${same ? 'YES' : 'NO'}`);
console.log(`checks: ${JSON.stringify(res.checks)}`);
if (!same || !res.checks.ok) { console.error('A CHECK FAILED - see above; undo per the header'); process.exit(1); }
console.log('OK');
