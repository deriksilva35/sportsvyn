// lib/mlb/schedule.js - /mlb/v1/games -> matches rows. The shaping is PURE.
//
// NOTHING DOWNSTREAM EXISTS WITHOUT THESE ROWS. The live poller scopes by OUR
// table, not by the provider's payload - "we enumerate the rows WE hold as
// live-or-imminent and look each up" - so a league with no matches rows is a
// league the poller cannot see, whatever the feed says. This is the file that
// makes MLB visible to everything else.
//
// THE SLUG HAS NO WEEK IN IT, because baseball has none: 162 games over six
// months, identified by the day they are played. mlb-2026-09-22-tb-nyy. And
// matches.slug is GLOBALLY unique - not per league - so the mlb- prefix is
// load-bearing rather than decorative.
//
// DOUBLEHEADERS ARE REAL AND THE DATE IS NOT ENOUGH. The same two clubs play
// twice on one day several times a season, and today's own slate has one:
// TB @ NYY at 17:05Z and again at 23:05Z. The second game takes a -g2 suffix,
// decided by kickoff order within the pair so the same game gets the same slug
// on every re-import. Without it the second game silently collides with the
// first on a unique index and the import fails a row it will never explain.
//
// THE UPSERT IS KEYED ON bdl_game_id, NOT ON THE SLUG. PROD has a partial
// unique index on (league_id, external_ids->>'bdl_game_id') for exactly this,
// and the provider's id is the only thing about a game that cannot change - a
// postponement moves the date, which moves the slug.

import { fromBdlMlb } from './ingest.js';

const BDL = 'https://api.balldontlie.io';

/** One day's slate. */
export async function fetchMlbDay(dateIso) {
  const key = process.env.BDL_API_KEY;
  if (!key) throw new Error('BDL_API_KEY missing in env');
  const res = await fetch(`${BDL}/mlb/v1/games?dates[]=${encodeURIComponent(dateIso)}&per_page=100`,
    { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`BDL ${res.status} on /mlb/v1/games`);
  const j = await res.json();
  return j?.data ?? [];
}

/** The postseason bracket for a season, once it exists. */
export async function fetchMlbPostseason(season) {
  const key = process.env.BDL_API_KEY;
  if (!key) throw new Error('BDL_API_KEY missing in env');
  const res = await fetch(`${BDL}/mlb/v1/games?postseason=true&seasons[]=${season}&per_page=100`,
    { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`BDL ${res.status} on /mlb/v1/games`);
  const j = await res.json();
  return j?.data ?? [];
}

const lower = (v) => String(v ?? '').trim().toLowerCase();

/** PURE. The ET-ish calendar day a game belongs to, from its UTC kickoff.
 *  NOT a timezone conversion - the provider already states the date it files a
 *  game under, and the slug takes that rather than re-deriving one. */
export function gameDay(row) {
  const d = String(row?.date ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}

/**
 * PURE. Slugs for a whole slate, doubleheaders disambiguated.
 * Takes the WHOLE day so the -g2 decision can see both games; a per-row
 * function could not, and would either always or never add a suffix.
 */
export function slugsFor(rows = []) {
  const byPair = new Map();
  for (const r of rows) {
    const day = gameDay(r);
    const away = lower(r?.away_team?.abbreviation);
    const home = lower(r?.home_team?.abbreviation);
    if (!day || !away || !home || r?.id == null) continue;
    const pair = `${day}:${away}:${home}`;
    if (!byPair.has(pair)) byPair.set(pair, []);
    byPair.get(pair).push(r);
  }
  const out = new Map();
  for (const [pair, games] of byPair) {
    // ORDERED BY KICKOFF, THEN BY ID. Two games at the same stated time is not
    // a shape this feed has, but a stable tiebreak means a re-import cannot
    // swap which game is -g2.
    games.sort((a, b) => (new Date(a.date) - new Date(b.date)) || (Number(a.id) - Number(b.id)));
    const [day, away, home] = pair.split(':');
    games.forEach((g, i) => {
      out.set(String(g.id), `mlb-${day}-${away}-${home}${i ? `-g${i + 1}` : ''}`);
    });
  }
  return out;
}

/**
 * PURE. One row -> the columns matches holds.
 * @param teamIdByBdl Map(bdl_team_id -> our team id)
 */
export function shapeMlbMatch(row, slug, teamIdByBdl = new Map(), unmapped = {}, stage = null) {
  const n = fromBdlMlb(row, unmapped);
  const homeTeamId = teamIdByBdl.get(String(row?.home_team?.id)) ?? null;
  const awayTeamId = teamIdByBdl.get(String(row?.away_team?.id)) ?? null;
  // A GAME WITH A SIDE WE CANNOT RESOLVE IS NOT WRITTEN. Both team ids are
  // NOT NULL on this table for every existing league's rows, and a half-joined
  // match renders as a blank team on every surface that reads it.
  if (!slug || !homeTeamId || !awayTeamId || !row?.date || n.seasonPhase == null) return null;
  return {
    slug,
    homeTeamId,
    awayTeamId,
    kickoffAt: row.date,
    status: n.status,
    homeScore: n.homeScore,
    awayScore: n.awayScore,
    seasonYear: row.season == null ? null : Number(row.season),
    seasonPhase: n.seasonPhase,
    // BASEBALL HAS NO WEEKS. Null rather than a derived week number: every
    // reader that groups by week is football-shaped and must find nothing
    // here rather than something it can misuse.
    week: null,
    // THE ROUND, AND ONLY WHEN SOMEBODY KNOWS IT. Null on every regular-season
    // row and on any postseason row whose stage could not be established -
    // lib/mlb/series.js scopes on `stage IS NOT NULL` precisely so an unplaced
    // game is ABSENT from the bracket rather than grouped under a blank round.
    // The provider we import games from does not carry it; lib/mlb/postseason.js
    // is where it comes from.
    stage: stage ?? null,
    venue: n.venue,
    metadata: {
      line_score: n.lineScore,
      scoring_plays: n.scoringPlays,
      ...(n.liveState ? { live_state: n.liveState } : {}),
    },
    externalIds: { bdl_game_id: String(row.id) },
  };
}

/** Upsert one slate. Follows lib/gridiron/sync.js's lookup-then-write shape. */
/**
 * @param stageByGameId Map(bdl game id -> stage). Absent for a regular-season
 *   import; the postseason importer supplies it. A row with no entry keeps a
 *   NULL stage rather than inheriting the last one seen.
 */
export async function writeMlbMatches(sql, leagueId, rows, stageByGameId = new Map()) {
  const teams = await sql`
    SELECT id, external_ids->>'bdl_team_id' AS pid FROM teams
     WHERE league_id = ${leagueId} AND jsonb_exists(external_ids, 'bdl_team_id')`;
  const teamIdByBdl = new Map(teams.map((t) => [t.pid, t.id]));
  const slugs = slugsFor(rows);
  const unmapped = {};
  let inserted = 0; let updated = 0; const refused = [];

  for (const row of rows ?? []) {
    const g = shapeMlbMatch(row, slugs.get(String(row?.id)) ?? null, teamIdByBdl, unmapped,
      stageByGameId.get(String(row?.id)) ?? null);
    if (!g) { refused.push({ id: row?.id ?? null, slug: slugs.get(String(row?.id)) ?? null }); continue; }
    const ext = JSON.stringify(g.externalIds);
    const [existing] = await sql`
      SELECT id FROM matches
       WHERE league_id = ${leagueId} AND external_ids->>'bdl_game_id' = ${String(row.id)}
       LIMIT 1`;
    if (existing) {
      await sql`
        UPDATE matches SET
          slug = ${g.slug}, home_team_id = ${g.homeTeamId}, away_team_id = ${g.awayTeamId},
          kickoff_at = ${g.kickoffAt}, status = ${g.status},
          -- THE SAME GATE THE OTHER LEAGUES USE: a scheduled row's 0-0 is not
          -- a score, so it may only null; a live or final row's score wins,
          -- and a null from the provider preserves what we hold.
          home_score = CASE WHEN ${g.status} = 'scheduled' THEN NULL
                            ELSE COALESCE(${g.homeScore}::int, matches.home_score) END,
          away_score = CASE WHEN ${g.status} = 'scheduled' THEN NULL
                            ELSE COALESCE(${g.awayScore}::int, matches.away_score) END,
          season_year = ${g.seasonYear}, season_phase = ${g.seasonPhase}, venue = ${g.venue},
          -- A STAGE IS NEVER UNSET BY A LATER IMPORT THAT DOES NOT KNOW IT.
          -- The regular-season importer passes no stage map at all and reruns
          -- daily over a window that will, in October, contain postseason
          -- games; COALESCE is what stops it wiping the round off every one of
          -- them and emptying the bracket.
          stage = COALESCE(${g.stage}::text, matches.stage),
          -- ONE LEVEL DEEP IS ALL THIS NEEDS AND ALL IT GETS. Every key written
          -- here is top-level (line_score, scoring_plays, live_state), so a
          -- shallow merge replaces each wholesale, which is what a snapshot
          -- wants. A nested merge would be the trap the house rule names.
          metadata = COALESCE(matches.metadata, '{}'::jsonb)
                     || ${JSON.stringify(g.metadata)}::jsonb
                     || CASE WHEN ${g.status} = 'live' THEN '{}'::jsonb
                             ELSE '{"live_state": null}'::jsonb END,
          external_ids = matches.external_ids || ${ext}::jsonb,
          data_provider_synced_at = now(), updated_at = now()
        WHERE id = ${existing.id}`;
      updated += 1;
    } else {
      await sql`
        INSERT INTO matches (league_id, slug, home_team_id, away_team_id, kickoff_at, status,
                             home_score, away_score, season_year, season_phase, week, stage, venue,
                             metadata, external_ids, data_provider_synced_at, created_at, updated_at)
        VALUES (${leagueId}, ${g.slug}, ${g.homeTeamId}, ${g.awayTeamId}, ${g.kickoffAt}, ${g.status},
                ${g.status === 'scheduled' ? null : g.homeScore}, ${g.status === 'scheduled' ? null : g.awayScore},
                ${g.seasonYear}, ${g.seasonPhase}, ${g.week}, ${g.stage}, ${g.venue},
                ${JSON.stringify(g.metadata)}::jsonb, ${ext}::jsonb, now(), now(), now())`;
      inserted += 1;
    }
  }
  return { inserted, updated, refused, unmapped };
}
