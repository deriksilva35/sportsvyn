// lib/nba/sync.js - the NBA league row and its thirty current teams. PURE
// shaping, an idempotent writer, and a dry run that writes nothing. The shape
// of lib/mlb/sync.js, deliberately.
//
// THIRTY, NOT EIGHTY-NINE. /nba/v1/teams returns 89 rows: the thirty current
// franchises (BDL ids 1-30, each with a conference and a division) and 59
// historical ones (Anderson Packers, Baltimore Bullets ...) with BLANK
// conference and division. Measured 1 Oct 2026. The filter is the conference,
// which is the fact that makes a team current - not the id range, which is a
// property of how BDL happened to number them.
//
// THE SLUG IS DERIVED, because BDL's NBA teams carry none (unlike MLB's):
// "Boston Celtics" -> boston-celtics, the convention every other league here
// already uses. LA Clippers -> la-clippers, as the provider spells it.
//
// conference/division ride teams.current_conference / current_division, the
// columns the NFL and MLB already use: "East"/"West" and "Atlantic" etc.

import { sportOf } from '../live/vocabulary.js';
import { bdlFetch } from '../bdl/http.js';

export const NBA_LEAGUE_SLUG = 'nba';

/** Every /nba/v1/teams row. One call: 89 rows fit in a page of 100. */
export async function fetchNbaTeams({ fetchImpl = fetch, key = process.env.BDL_API_KEY } = {}) {
  if (!key) throw new Error('BDL_API_KEY missing in env');
  const res = await bdlFetch(`/nba/v1/teams?per_page=100`, { key, fetchImpl, describe: (s) => `BDL ${s} on /nba/v1/teams` });
  const j = await res.json();
  return j?.data ?? [];
}

/** PURE. "Boston Celtics" -> "boston-celtics". */
export function teamSlug(fullName) {
  return String(fullName ?? '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** PURE. A current franchise is one the provider files under a conference. */
export const isCurrentTeam = (r) => ['east', 'west'].includes(String(r?.conference ?? '').trim().toLowerCase())
  && String(r?.division ?? '').trim() !== '';

/**
 * PURE. Feed rows -> the columns teams holds, current franchises only. A
 * current row missing an abbreviation or an id is REPORTED, not written: both
 * are join keys (the poller matches on bdl_team_id, the colours on the
 * abbreviation).
 */
export function shapeNbaTeams(rows = []) {
  const teams = []; const rejected = []; let historical = 0;
  for (const r of rows ?? []) {
    if (!isCurrentTeam(r)) { historical += 1; continue; }
    const abbreviation = String(r?.abbreviation ?? '').trim();
    const name = String(r?.full_name ?? '').trim();
    const slug = teamSlug(name);
    if (!slug || !abbreviation || r?.id == null) {
      rejected.push({ id: r?.id ?? null, slug: slug || null, abbreviation: abbreviation || null });
      continue;
    }
    teams.push({
      slug,
      abbreviation,
      name,
      shortName: String(r.name ?? '').trim() || null,
      conference: String(r.conference).trim(),
      division: String(r.division).trim(),
      externalIds: { bdl_team_id: String(r.id) },
    });
  }
  return { teams, rejected, historical };
}

/** The league row, shaped as the other leagues are. */
export function nbaLeagueRow() {
  return {
    slug: NBA_LEAGUE_SLUG,
    name: 'National Basketball Association',
    shortName: 'NBA',
    // sportOf('nba') answers 'basketball' since the thu-17 seam, so the row and
    // the vocabulary agree by construction.
    sport: sportOf(NBA_LEAGUE_SLUG),
    seasonType: 'season-and-postseason',
    externalIds: { bdl_sport: 'nba' },
  };
}

/** Upsert the league. Returns its id. Idempotent. */
export async function upsertNbaLeague(sql) {
  const l = nbaLeagueRow();
  const [row] = await sql`
    INSERT INTO leagues (slug, name, short_name, sport, season_type, external_ids, created_at, updated_at)
    VALUES (${l.slug}, ${l.name}, ${l.shortName}, ${l.sport}, ${l.seasonType},
            ${JSON.stringify(l.externalIds)}::jsonb, now(), now())
    ON CONFLICT (slug) DO UPDATE SET
      name = EXCLUDED.name, short_name = EXCLUDED.short_name,
      sport = EXCLUDED.sport, season_type = EXCLUDED.season_type,
      -- external_ids is one level deep, so || keeps a second provider's key.
      external_ids = leagues.external_ids || EXCLUDED.external_ids,
      updated_at = now()
    RETURNING id`;
  return row.id;
}

/** Upsert the thirty teams. Idempotent; returns counts and what it refused. */
export async function upsertNbaTeams(sql, leagueId, rows) {
  const { teams, rejected, historical } = shapeNbaTeams(rows);
  let written = 0;
  for (const t of teams) {
    const r = await sql`
      INSERT INTO teams (league_id, slug, name, short_name, abbreviation,
                         current_conference, current_division, external_ids, created_at, updated_at)
      VALUES (${leagueId}, ${t.slug}, ${t.name}, ${t.shortName}, ${t.abbreviation},
              ${t.conference}, ${t.division}, ${JSON.stringify(t.externalIds)}::jsonb, now(), now())
      ON CONFLICT (league_id, slug) DO UPDATE SET
        name = EXCLUDED.name, short_name = EXCLUDED.short_name,
        abbreviation = EXCLUDED.abbreviation,
        current_conference = EXCLUDED.current_conference,
        current_division = EXCLUDED.current_division,
        external_ids = teams.external_ids || EXCLUDED.external_ids,
        updated_at = now()
      RETURNING id`;
    written += r.length;
  }
  return { written, shaped: teams.length, rejected, historical };
}
