// scripts/check-college-board.mjs - HELD DEVY PLAYERS ARE NOT DRAFTABLE, on a real
// league (read-only). The invariant lib/fantasy/collegeSurface.test.mjs asserted
// against PROD until 20 Oct; a test no longer reaches PROD, so the PROD check is
// this script. Run it after a Fantrax import or a college board rebuild.
//
//   set -a && . ./.env.local && set +a
//   node scripts/check-college-board.mjs            # DATABASE_URL (DEV)
//   node scripts/check-college-board.mjs --prod     # PROD_DATABASE_URL, SELECT only
//
// Exit 0 = holds (or nothing to check), 1 = a held player is on the board or the
// board is empty.
import { neon } from '@neondatabase/serverless';

const url = process.argv.includes('--prod') ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
if (!url) { console.error('no database url in env'); process.exit(2); }
const sql = neon(url);
console.log(`TARGET ${new URL(url).host} (read-only)`);
const [cfg] = await sql`SELECT id, teams FROM draft_configs WHERE source = 'fantrax' AND teams IS NOT NULL ORDER BY id LIMIT 1`;
if (!cfg) { console.log('no imported Fantrax league - nothing to check'); process.exit(0); }
const held = (cfg.teams ?? []).flatMap((t) => (t.minors ?? []).map((m) => String(m.fantraxId)));
const [{ d }] = await sql`SELECT max(snapshot_date) d FROM sim_player_pool WHERE source = 'fantrax'`;
const onBoard = await sql`SELECT ffc_player_id, name, league FROM sim_player_pool
   WHERE source = 'fantrax' AND snapshot_date = ${d} AND ffc_player_id = ANY(${held})`;
const byLeague = Object.fromEntries((await sql`SELECT league, count(*)::int n FROM sim_player_pool
   WHERE source = 'fantrax' AND snapshot_date = ${d} GROUP BY 1`).map((r) => [r.league, r.n]));
console.log(`config ${cfg.id}: ${held.length} held devy · snapshot ${new Date(d).toISOString().slice(0, 10)} · board ${JSON.stringify(byLeague)}`);
let ok = true;
if (onBoard.length) { ok = false; console.log(`HELD PLAYERS ARE DRAFTABLE: ${onBoard.map((r) => `${r.name} (${r.league})`).join(', ')}`); }
if ((byLeague.ncaaf ?? 0) <= 500) { ok = false; console.log(`college board under 500 rows (${byLeague.ncaaf ?? 0})`); }
if ((byLeague.nfl ?? 0) <= 300) { ok = false; console.log(`NFL board under 300 rows (${byLeague.nfl ?? 0})`); }
console.log(ok ? 'OK' : 'FAILED');
process.exit(ok ? 0 : 1);
