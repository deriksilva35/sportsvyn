// scripts/daily-backfill-games.mjs - games played (and a kicker's XP) onto stored Daily boards.
// DRY RUN BY DEFAULT.
//
//   set -a && . ./.env.local && set +a
//   node scripts/daily-backfill-games.mjs                  # DEV, dry run
//   node scripts/daily-backfill-games.mjs --apply          # DEV, write
//   node scripts/daily-backfill-games.mjs --prod           # PROD (PROD_DATABASE_URL), dry run
//   node scripts/daily-backfill-games.mjs --prod --apply   # PROD, write
//
// For every daily_boards row, each best_roster entry and each board card player is
// matched to nfl_player_season_totals on season_year + raw_name + team_key + position.
// Exactly one match -> games (and xp for PK) are stored on the entry; otherwise the
// entry is left alone and prints no /wk. Idempotent. best_roster is an ARRAY: whole
// entries are rewritten and the whole array written back (never `||`).
// One season's source rows are read at a time (a few thousand), never the table.

import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { indexSource, backfillBoard } from '../lib/daily/backfillGames.js';

const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const APPLY = args.includes('--apply');
const url = PROD ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
if (!url) { console.error('REFUSE: database url missing in env'); process.exit(1); }
const sql = neon(url);
console.log(`TARGET ${new URL(url).host} | FP ${crypto.createHash('sha256').update(url).digest('hex').slice(0, 12)} | ${APPLY ? 'APPLY' : 'DRY RUN'}`);

const seasons = (await sql`SELECT DISTINCT season_year FROM daily_boards ORDER BY 1`).map((r) => r.season_year);
const tot = { boards: 0, changed: 0, entries: 0, withGames: 0, cards: 0, cardsWithGames: 0, written: 0 };
const lacking = [];
for (const season of seasons) {
  const src = indexSource(await sql`
    SELECT raw_name, team_key, position, games, xp FROM nfl_player_season_totals WHERE season_year = ${season}`);
  const boards = await sql`SELECT id, edition_date, best_roster, board FROM daily_boards WHERE season_year = ${season} ORDER BY id`;
  let sEntries = 0; let sWith = 0;
  for (const b of boards) {
    const r = backfillBoard(b, src);
    tot.boards += 1; tot.entries += r.entries; tot.withGames += r.withGames; tot.cards += r.cards; tot.cardsWithGames += r.cardsWithGames;
    sEntries += r.entries; sWith += r.withGames;
    if (r.changed) {
      tot.changed += 1;
      if (APPLY) {
        await sql`UPDATE daily_boards SET best_roster = ${JSON.stringify(r.best_roster)}::jsonb, board = ${JSON.stringify(r.board)}::jsonb WHERE id = ${b.id}`;
        tot.written += 1;
      }
    }
  }
  if (sWith < sEntries) lacking.push(`${season} (${sWith}/${sEntries} entries have games)`);
}
console.log(`boards ${tot.boards} | would change ${tot.changed} | written ${tot.written}`);
console.log(`best_roster entries ${tot.entries} | with games ${tot.withGames}`);
console.log(`board card players ${tot.cards} | with games ${tot.cardsWithGames}`);
console.log(`seasons lacking games: ${lacking.length ? lacking.join(', ') : 'none'}`);
if (!APPLY) console.log('\nDRY RUN ONLY.');
