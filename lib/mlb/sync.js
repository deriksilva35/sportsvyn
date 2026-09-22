// lib/mlb/sync.js - the league row and the thirty teams. PURE shaping, with a
// writer that is idempotent and a dry run that writes nothing.
//
// THE SHAPE COMES FROM THE FEED, NOT FROM A LIST TYPED HERE.
// /mlb/v1/teams carries, per club: id, slug, abbreviation, display_name,
// short_display_name, name, location, league ("American"|"National") and
// division ("East"|"Central"|"West"). That is every column teams needs except
// the colours, which BDL does not send at all - see lib/mlb/teamColors.js.
//
// THE SLUG IS THE FEED'S. BDL already ships "baltimore-orioles", which is
// exactly the convention this database uses for the NFL
// ("pittsburgh-steelers") and CFB ("west-georgia"). Deriving our own from the
// display name would produce the same string by a longer route and would drift
// the first time a club is renamed.
//
// conference/division: teams.current_conference and current_division are the
// columns the NFL already uses for "AFC" / "East", and American/National maps
// onto them without inventing a third pair. The standings payload spells them
// "American League" and "AL Cent"; the TEAMS payload spells them "American"
// and "East", and this reads the teams payload.

import { sportOf } from '../live/vocabulary.js';

export const MLB_LEAGUE_SLUG = 'mlb';
const BDL = 'https://api.balldontlie.io';

/** One page of /mlb/v1/teams. Thirty clubs fit in one call. */
export async function fetchMlbTeams() {
  const key = process.env.BDL_API_KEY;
  if (!key) throw new Error('BDL_API_KEY missing in env');
  const res = await fetch(`${BDL}/mlb/v1/teams?per_page=100`, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`BDL ${res.status} on /mlb/v1/teams`);
  const j = await res.json();
  return j?.data ?? [];
}

/**
 * PURE. Feed rows -> the columns teams holds. A row missing a slug or an
 * abbreviation is REPORTED, not written: both are join keys downstream (the
 * poller matches on external_ids, the colour table on abbreviation) and a null
 * in either is a team that silently never matches anything again.
 */
export function shapeMlbTeams(rows = []) {
  const teams = []; const rejected = [];
  for (const r of rows ?? []) {
    const slug = String(r?.slug ?? '').trim();
    const abbreviation = String(r?.abbreviation ?? '').trim();
    if (!slug || !abbreviation || r?.id == null) {
      rejected.push({ id: r?.id ?? null, slug: slug || null, abbreviation: abbreviation || null });
      continue;
    }
    teams.push({
      slug,
      abbreviation,
      name: String(r.display_name ?? '').trim() || slug,
      shortName: String(r.short_display_name ?? r.name ?? '').trim() || null,
      conference: String(r.league ?? '').trim() || null,
      division: String(r.division ?? '').trim() || null,
      externalIds: { bdl_team_id: String(r.id) },
    });
  }
  return { teams, rejected };
}

/** The league row, exactly as the other leagues are shaped. */
export function mlbLeagueRow() {
  return {
    slug: MLB_LEAGUE_SLUG,
    name: 'Major League Baseball',
    shortName: 'MLB',
    // 'baseball' IS A NEW VALUE FOR leagues.sport. Nothing in the product has
    // ever had one - migrations/079_standings.sql says in so many words that
    // "MLB, NBA and NHL join in September/October by inserting" - and
    // lib/live/vocabulary.js sportOf('mlb') already answers 'baseball', so the
    // two halves agree by construction rather than by memory.
    sport: sportOf(MLB_LEAGUE_SLUG),
    // The NFL's own value. MLB plays a regular season and a postseason, and
    // the string is the one the gridiron leagues already use for that shape.
    seasonType: 'season-and-postseason',
    externalIds: { bdl_sport: 'mlb' },
  };
}

/** Upsert the league. Returns its id. Idempotent. */
export async function upsertMlbLeague(sql) {
  const l = mlbLeagueRow();
  const [row] = await sql`
    INSERT INTO leagues (slug, name, short_name, sport, season_type, external_ids, created_at, updated_at)
    VALUES (${l.slug}, ${l.name}, ${l.shortName}, ${l.sport}, ${l.seasonType},
            ${JSON.stringify(l.externalIds)}::jsonb, now(), now())
    ON CONFLICT (slug) DO UPDATE SET
      name = EXCLUDED.name, short_name = EXCLUDED.short_name,
      sport = EXCLUDED.sport, season_type = EXCLUDED.season_type,
      -- THE EXISTING external_ids SURVIVE. A second provider added later must
      -- not be wiped by a re-run of this one, which is the shallow-merge trap
      -- the house rule is about: || is one level deep and that is exactly the
      -- depth this object has.
      external_ids = leagues.external_ids || EXCLUDED.external_ids,
      updated_at = now()
    RETURNING id`;
  return row.id;
}

/** Upsert the thirty teams. Idempotent; returns counts and what it refused. */
export async function upsertMlbTeams(sql, leagueId, rows) {
  const { teams, rejected } = shapeMlbTeams(rows);
  let written = 0;
  for (const t of teams) {
    const r = await sql`
      INSERT INTO teams (league_id, slug, name, short_name, abbreviation,
                         current_conference, current_division, external_ids, created_at, updated_at)
      VALUES (${leagueId}, ${t.slug}, ${t.name}, ${t.shortName}, ${t.abbreviation},
              ${t.conference}, ${t.division}, ${JSON.stringify(t.externalIds)}::jsonb, now(), now())
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name, short_name = EXCLUDED.short_name,
        abbreviation = EXCLUDED.abbreviation,
        current_conference = EXCLUDED.current_conference,
        current_division = EXCLUDED.current_division,
        external_ids = teams.external_ids || EXCLUDED.external_ids,
        updated_at = now()
      RETURNING id`;
    written += r.length;
  }
  return { written, shaped: teams.length, rejected };
}
