// lib/mlb/standings.js - the seeds the bracket hangs on.
//
// WHY THIS EXISTS AND THE BRACKET DOES NOT JUST COUNT WINS. A postseason seed
// is not "most wins in the league": division winners take 1-3 whatever their
// records, the three wild cards take 4-6, and ties break on head-to-head and
// then on intra-division record. The provider already computes it, publishes
// it as playoff_seed, and is the same feed the games come from. Deriving our
// own would be a second opinion that disagrees with the scoreboard on exactly
// the weekend it matters.
//
// IT GOES IN team_records, NOT A NEW TABLE. That table already holds wins,
// losses and playoff_seed for the NFL from the same provider, keyed
// (league_id, team_id, season, season_type) - the MLB rows are the same shape
// with baseball's own vocabulary in the columns football calls points_for.
//
// SEEDS 1-6 ARE THE BRACKET; 7-15 ARE STANDINGS. The feed numbers all fifteen
// clubs in a league. Nothing here truncates that - the number is stored as
// sent, and lib/mlb/bracket.js is the one place that knows six get in.

const BDL = 'https://api.balldontlie.io';

/** One season's standings, all thirty clubs in one call. */
export async function fetchMlbStandings(season) {
  const key = process.env.BDL_API_KEY;
  if (!key) throw new Error('BDL_API_KEY missing in env');
  const res = await fetch(`${BDL}/mlb/v1/standings?season=${encodeURIComponent(season)}`,
    { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`BDL ${res.status} on /mlb/v1/standings`);
  return (await res.json())?.data ?? [];
}

const num = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

/**
 * PURE. A standings row -> the columns team_records holds.
 *
 * points_for / points_against ARE RUNS, and that is not a fudge: the column
 * pair means "what this club scored and conceded" for every sport in the
 * table, and the NFL rows in it are points for the same reason these are runs.
 * The feed calls them points_for/points_against too.
 */
export function shapeMlbRecord(row, teamIdByBdl = new Map()) {
  const teamId = teamIdByBdl.get(String(row?.team?.id)) ?? null;
  if (!teamId) return null;
  return {
    teamId,
    wins: num(row?.wins),
    losses: num(row?.losses),
    // BASEBALL HAS NO TIES. 0, not null: it is a real count and it is zero,
    // and a null here would read as "we did not fetch it".
    ties: 0,
    pointsFor: num(row?.points_for),
    pointsAgainst: num(row?.points_against),
    playoffSeed: num(row?.playoff_seed),
    // American / National, and East / Central / West - the same two columns
    // the teams import already fills, so a reader never has to ask which
    // spelling of the league it is holding.
    conference: String(row?.team?.league ?? '').trim() || null,
    division: String(row?.team?.division ?? '').trim() || null,
    homeWins: num(row?.home_wins), homeLosses: num(row?.home_losses),
    awayWins: num(row?.road_wins), awayLosses: num(row?.road_losses),
  };
}

/** Upsert a season's records. Idempotent on (league_id, team_id, season, type). */
export async function writeMlbStandings(sql, leagueId, season, rows) {
  const teams = await sql`
    SELECT id, external_ids->>'bdl_team_id' AS pid FROM teams
     WHERE league_id = ${leagueId} AND jsonb_exists(external_ids, 'bdl_team_id')`;
  const teamIdByBdl = new Map(teams.map((t) => [t.pid, t.id]));
  let written = 0; const refused = [];
  for (const row of rows ?? []) {
    const r = shapeMlbRecord(row, teamIdByBdl);
    if (!r) { refused.push(row?.team?.abbreviation ?? row?.team?.id ?? '?'); continue; }
    await sql`
      INSERT INTO team_records (league_id, team_id, season, season_type,
        wins, losses, ties, points_for, points_against, playoff_seed,
        conference, division, home_wins, home_losses, away_wins, away_losses,
        data_provider, data_provider_synced_at, created_at, updated_at)
      VALUES (${leagueId}, ${r.teamId}, ${season}, 'regular',
        ${r.wins}, ${r.losses}, ${r.ties}, ${r.pointsFor}, ${r.pointsAgainst}, ${r.playoffSeed},
        ${r.conference}, ${r.division}, ${r.homeWins}, ${r.homeLosses}, ${r.awayWins}, ${r.awayLosses},
        'bdl', now(), now(), now())
      ON CONFLICT (league_id, team_id, season, season_type) DO UPDATE SET
        wins = EXCLUDED.wins, losses = EXCLUDED.losses, ties = EXCLUDED.ties,
        points_for = EXCLUDED.points_for, points_against = EXCLUDED.points_against,
        playoff_seed = EXCLUDED.playoff_seed,
        conference = EXCLUDED.conference, division = EXCLUDED.division,
        home_wins = EXCLUDED.home_wins, home_losses = EXCLUDED.home_losses,
        away_wins = EXCLUDED.away_wins, away_losses = EXCLUDED.away_losses,
        data_provider_synced_at = now(), updated_at = now()`;
    written += 1;
  }
  return { written, refused };
}
