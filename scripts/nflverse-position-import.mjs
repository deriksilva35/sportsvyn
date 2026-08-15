// scripts/nflverse-position-import.mjs - fill nfl_player_seasons for one season.
//
// Resolution order and the suffix rule live in lib/gridiron/positionMatch.js,
// which is pure; this file is the plumbing around it - fetch, query, upsert,
// count. Keeping the decision out of the script is what lets the four rules be
// tested without a database.
//
// THE OVERRIDE TABLE IS INACTIVE BY DEFAULT. lib/gridiron/override-seed.json
// carries a proposed nflverse_name per unmatched BDL player, every one marked
// `resolved: false`. Only rows a human has flipped to true are loaded. A
// proposal is not a mapping.
//
// TARGET DATABASE is whatever DATABASE_URL points at - no --prod flag, no
// connection string in this file. Source with
// `set -a && . ./.env.local && set +a`. The fingerprint printed at startup
// identifies the target without echoing the credential.
//
// Usage:  node scripts/nflverse-position-import.mjs 2019 [--dry]

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../lib/db.js';
import { loadPlayers, loadRoster, ourTeam } from '../lib/gridiron/nflverse.js';
import { resolveOne, toOurPosition, normalizeSuffixAware } from '../lib/gridiron/positionMatch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const season = Number(args.find((a) => /^\d{4}$/.test(a)));
const dry = args.includes('--dry');
if (!Number.isInteger(season)) {
  console.error('usage: node scripts/nflverse-position-import.mjs <season> [--dry]');
  process.exit(1);
}

const fingerprint = crypto.createHash('sha256').update(String(process.env.DATABASE_URL)).digest('hex').slice(0, 12);

function loadOverrides() {
  const p = path.join(__dirname, '..', 'lib', 'gridiron', 'override-seed.json');
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const m = new Map();
  let proposed = 0;
  for (const e of j.entries ?? []) {
    if (!e.resolved) { proposed += 1; continue; }        // a proposal is not a mapping
    if (e.nflverse_gsis) m.set(normalizeSuffixAware(e.bdl_name), { gsis: e.nflverse_gsis });
  }
  return { overrides: m, proposedButUnconfirmed: proposed };
}

export async function importSeason(year, { apply = true, log = console.log } = {}) {
  const { overrides, proposedButUnconfirmed } = loadOverrides();

  // ---- BDL side: only players WITH stat rows that season -------------------
  const bdl = await sql`
    SELECT np.id, np.full_name,
           array_agg(DISTINCT t.abbreviation) AS teams,
           sum(COALESCE(s.pass_att,0))::int  AS pass_att,
           sum(COALESCE(s.rush_att,0))::int  AS rush_att,
           sum(COALESCE(s.rec,0))::int       AS rec,
           sum(COALESCE(s.fga,0))::int       AS fga
      FROM nfl_player_game_stats s
      JOIN matches m ON m.id = s.match_id
      JOIN nfl_players np ON np.id = s.nfl_player_id
      JOIN teams t ON t.id = s.team_id
      JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = 'nfl' AND m.season_year = ${year}
     GROUP BY np.id, np.full_name`;
  const candidates = bdl.map((r) => ({
    id: r.id, fullName: r.full_name, teams: r.teams,
    totals: { pass_att: r.pass_att, rush_att: r.rush_att, rec: r.rec, fga: r.fga },
  }));
  const producers = new Set(candidates.filter((c) =>
    c.totals.pass_att + c.totals.rush_att + c.totals.rec + c.totals.fga > 0).map((c) => c.id));

  // ---- nflverse side: roster stints joined to players.csv BY GSIS ----------
  // NEVER by name. 4% of roster rows carry a different name than players.csv -
  // roster_2020 says "Nick Westbrook" where players.csv says
  // "Nick Westbrook-Ikhine" - so a name join silently loses them. Both
  // spellings are then tried against BDL.
  const players = await loadPlayers({ log: (m) => log(`  ${m}`) });
  const byGsis = new Map(players.map((p) => [p.gsis_id, p]));
  const stints = new Map();
  for (const r of await loadRoster(year, { log: (m) => log(`  ${m}`) })) {
    if (!r.gsis_id) continue;
    if (!stints.has(r.gsis_id)) stints.set(r.gsis_id, { names: new Set(), teams: new Set(), rosterPos: r.position });
    const e = stints.get(r.gsis_id);
    e.names.add(r.full_name);
    e.teams.add(ourTeam(r.team));
  }

  const rules = { override: 0, unique: 0, team: 0, profile: 0 };
  const refused = [];
  const rows = [];
  const claimed = new Set();

  for (const [gsis, st] of stints) {
    const p = byGsis.get(gsis);
    const position = p?.position ?? st.rosterPos;
    if (!position) continue;
    // Try every spelling nflverse knows for this player.
    let best = null;
    for (const name of [p?.display_name, ...st.names].filter(Boolean)) {
      const r = resolveOne(
        { name, gsis, position, teams: st.teams, birthDate: p?.birth_date },
        candidates.filter((c) => !claimed.has(c.id)),
        overrides,
      );
      if (r.ok) { best = r; break; }
      if (!best || (r.candidates ?? 0) > (best.candidates ?? 0)) best = r;
    }
    if (!best?.ok) {
      // Only worth reporting if this player actually produced - a practice-squad
      // name with no stat row has nothing to attach a position to.
      continue;
    }
    claimed.add(best.playerId);
    rules[best.rule] = (rules[best.rule] ?? 0) + 1;
    rows.push({ id: best.playerId, position: toOurPosition(position), gsis, rule: best.rule });
  }

  // Which producers ended up WITHOUT a position row - the number that matters.
  const got = new Set(rows.map((r) => r.id));
  for (const c of candidates) {
    if (producers.has(c.id) && !got.has(c.id)) refused.push(c.fullName);
  }

  if (apply && rows.length) {
    for (let i = 0; i < rows.length; i += 500) {
      const ch = rows.slice(i, i + 500);
      await sql`
        INSERT INTO nfl_player_seasons (nfl_player_id, season_year, position, matched_by, gsis_id)
        SELECT * FROM unnest(
          ${ch.map((r) => r.id)}::int[], ${ch.map(() => year)}::int[],
          ${ch.map((r) => r.position)}::text[], ${ch.map((r) => r.rule)}::text[], ${ch.map((r) => r.gsis)}::text[])
        ON CONFLICT (nfl_player_id, season_year) DO UPDATE
          SET position = EXCLUDED.position, matched_by = EXCLUDED.matched_by, gsis_id = EXCLUDED.gsis_id`;
    }
  }

  return {
    season: year, rules, written: rows.length,
    producers: producers.size,
    producersWithPosition: [...producers].filter((id) => got.has(id)).length,
    refused, proposedButUnconfirmed,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`nflverse-position-import  season=${season}  target=${fingerprint}${dry ? '  (DRY)' : ''}`);
  const r = await importSeason(season, { apply: !dry });
  const pct = (100 * r.producersWithPosition / (r.producers || 1)).toFixed(1);
  console.log(`  rules: ${JSON.stringify(r.rules)}  written=${r.written}`);
  console.log(`  offensive producers ${r.producersWithPosition}/${r.producers} carry a position  (${pct}%)`);
  console.log(`  refused: ${r.refused.length}${r.refused.length ? ` -> ${r.refused.slice(0, 12).join(', ')}` : ''}`);
  console.log(`  override rows proposed but unconfirmed (inactive): ${r.proposedButUnconfirmed}`);
  console.log(JSON.stringify(r));
}
