// app/app/data.js — server-only data layer for the /app deck.
//
// Self-contained: re-creates its own neon() HTTP client at module scope.
// Does NOT import from lib/db.js or any lib/ helper. Mirrors a small,
// read-only subset of the SQL the rest of the site uses.
//
// Each reader returns the shape its card consumes, or `null` for honest
// empty-state rendering. None throws on absence of real data — the
// player-power list and longform articles may not exist pre-tournament,
// and that case must render cleanly.

import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL not set in environment');
}

// Module-scope HTTP client. The Pool-inside-handler rule applies only
// to the WebSocket Pool/Client class — neon() is a per-call HTTPS
// fetch and is intentionally instantiated at module scope (same shape
// as lib/db.js, re-created here so /app stays self-contained).
const sql = neon(process.env.DATABASE_URL);

const WC_LEAGUE_SLUG = 'fifa-wc-2026';

// Hardcoded follow-set (placeholder until the auth-backed follow store
// lands in a later step). Names use exact teams.name / players.full_name.
const FOLLOWED_TEAMS   = new Set(['Mexico', 'Argentina']);
const FOLLOWED_PLAYERS = new Set(['L. Messi']);

// Static editorial copy keyed by match slug. When a slug isn't here,
// the NEXT UP card omits the lede/body and the "what to watch" block.
const NEXT_UP_STATIC_COPY = {
  // Mexico v South Africa opener (slug shape mirrors site convention).
  'mexico-vs-south-africa-2026-06-11': {
    lede: 'A reopened Azteca, a home crowd at full voice, a Bafana side that arrived more dangerous than the seeding implied.',
    body: 'Mexico starts the tournament as host with everything to gain and nothing yet to prove. South Africa is the kind of team that punishes a slow first half — quick on the break, organised in midfield, willing to sit and counter. The script writes itself only if Mexico lets it.',
    watch: [
      'Edson Álvarez vs Teboho Mokoena in midfield — first 20 minutes set the tempo.',
      'Set pieces: South Africa is taller on average and will hunt the second ball.',
    ],
  },
};

// =============================================================================
// 1. NEXT UP — next WC fixture + match-winner probability + opener copy.
// =============================================================================
export async function readNextUp() {
  const matchRows = await sql`
    SELECT m.id, m.slug, m.kickoff_at, m.venue,
           h.id AS home_id, h.name AS home_name, h.abbreviation AS home_abbreviation, h.flag_svg_path AS home_flag,
           a.id AS away_id, a.name AS away_name, a.abbreviation AS away_abbreviation, a.flag_svg_path AS away_flag
      FROM matches m
      JOIN teams h    ON h.id  = m.home_team_id
      JOIN teams a    ON a.id  = m.away_team_id
      JOIN leagues lg ON lg.id = m.league_id
     WHERE lg.slug = ${WC_LEAGUE_SLUG}
       AND m.kickoff_at > now()
     ORDER BY m.kickoff_at
     LIMIT 1
  `;
  if (matchRows.length === 0) return null;
  const m = matchRows[0];

  const match = {
    slug: m.slug,
    kickoff_at: m.kickoff_at,
    venue: m.venue,
    home: {
      id: m.home_id,
      name: m.home_name,
      abbreviation: m.home_abbreviation,
      flag_svg_path: m.home_flag,
      followed: FOLLOWED_TEAMS.has(m.home_name),
    },
    away: {
      id: m.away_id,
      name: m.away_name,
      abbreviation: m.away_abbreviation,
      flag_svg_path: m.away_flag,
      followed: FOLLOWED_TEAMS.has(m.away_name),
    },
  };

  // Win-probability (3 outcomes). Returns null when not yet priced.
  const probRows = await sql`
    SELECT selection_label, implied_probability::float AS pct
      FROM odds_markets
     WHERE match_id = ${m.id}
       AND market_scope = 'match'
       AND market_type  = 'match_winner'
       AND is_current   = true
  `;
  let winProb = null;
  if (probRows.length === 3) {
    const by = Object.fromEntries(probRows.map((r) => [r.selection_label, r.pct]));
    if (by.home != null && by.draw != null && by.away != null) {
      winProb = {
        home: Math.round(by.home),
        draw: Math.round(by.draw),
        away: Math.round(by.away),
        homeCode: m.home_abbreviation,
        awayCode: m.away_abbreviation,
      };
    }
  }

  const meta = formatNextUpMeta(m.kickoff_at, m.venue);
  const copy = NEXT_UP_STATIC_COPY[m.slug] ?? null;

  return {
    match,
    meta,
    winProb,
    lede: copy?.lede ?? null,
    body: copy?.body ?? null,
    watch: copy?.watch ?? null,
  };
}

function formatNextUpMeta(kickoffAt, venue) {
  const tz = 'America/New_York';
  const d = new Date(kickoffAt);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d);
  const md  = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' }).format(d);
  const t   = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
  const venuePart = venue ? ` · ${venue}` : '';
  return `${day} ${md} · ${t} ET${venuePart}`;
}

// =============================================================================
// 2. POWER RANKINGS Top 5 — team-power list, current published edition.
// =============================================================================
export async function readTeamPowerTop5() {
  const rows = await sql`
    SELECT e.rank,
           t.name        AS name,
           t.abbreviation AS abbreviation,
           t.flag_svg_path AS flag_svg_path,
           e.score::float AS score
      FROM ranking_entries e
      JOIN ranking_editions ed ON ed.id = e.ranking_edition_id
      JOIN ranking_lists    rl ON rl.id = ed.ranking_list_id
      JOIN leagues          lg ON lg.id = rl.league_id
      JOIN teams            t  ON t.id  = e.team_id
     WHERE rl.slug         = 'team-power'
       AND lg.slug         = ${WC_LEAGUE_SLUG}
       AND ed.is_current   = true
       AND ed.status       = 'published'
     ORDER BY e.rank ASC
     LIMIT 5
  `;
  if (rows.length === 0) return null;
  return rows.map((r) => ({
    rank: r.rank,
    name: r.name,
    abbreviation: r.abbreviation,
    flag_svg_path: r.flag_svg_path,
    score: Number(r.score),
    followed: FOLLOWED_TEAMS.has(r.name),
  }));
}

// =============================================================================
// 3. PLAYER OF THE TOURNAMENT Top 5 — player-power list (does NOT exist yet).
// Returns null cleanly when the list / current published edition is absent.
// When the list lands, this reader returns rows automatically.
// =============================================================================
export async function readPlayerPotTop5() {
  // Guard 1: does the list even exist? Avoids any join error if other
  // ranking_entries columns shift before the list is published.
  const listCheck = await sql`
    SELECT 1 FROM ranking_lists WHERE slug = 'player-power' LIMIT 1
  `;
  if (listCheck.length === 0) return null;

  try {
    const rows = await sql`
      SELECT e.rank,
             p.full_name AS name,
             p.position  AS pos,
             p.slug      AS player_slug,
             nat.name    AS country,
             e.score::float AS score
        FROM ranking_entries e
        JOIN ranking_editions ed ON ed.id = e.ranking_edition_id
        JOIN ranking_lists    rl ON rl.id = ed.ranking_list_id
        JOIN leagues          lg ON lg.id = rl.league_id
        JOIN players          p  ON p.id  = e.player_id
        LEFT JOIN teams       nat ON nat.id = p.current_team_id
       WHERE rl.slug       = 'player-power'
         AND lg.slug       = ${WC_LEAGUE_SLUG}
         AND ed.is_current = true
         AND ed.status     = 'published'
       ORDER BY e.rank ASC
       LIMIT 5
    `;
    if (rows.length === 0) return null;
    return rows.map((r) => ({
      rank: r.rank,
      name: r.name,
      country: r.country ?? null,
      pos: r.pos ?? null,
      player_slug: r.player_slug,
      score: Number(r.score),
      followed: FOLLOWED_PLAYERS.has(r.name),
    }));
  } catch {
    // Schema may evolve before the list is published; do not break the
    // deck if so. Empty-state instead.
    return null;
  }
}

// =============================================================================
// 4. WATCH SCORES Today — top 5 by composite for today's PT slate.
// =============================================================================
export async function readWatchScoresToday() {
  const rows = await sql`
    SELECT m.slug,
           ht.name         AS home_name,
           at.name         AS away_name,
           ht.abbreviation AS home_abbr,
           at.abbreviation AS away_abbr,
           h.composite::float AS composite
      FROM matches m
      JOIN teams ht ON ht.id = m.home_team_id
      JOIN teams at ON at.id = m.away_team_id
      JOIN LATERAL (
        SELECT MAX(composite_score)::float AS composite
          FROM match_watch_score_history h
         WHERE h.match_id = m.id
      ) h ON h.composite IS NOT NULL
     WHERE (m.kickoff_at AT TIME ZONE 'America/Los_Angeles')::date
         = (now()         AT TIME ZONE 'America/Los_Angeles')::date
     ORDER BY h.composite DESC
     LIMIT 5
  `;
  if (rows.length === 0) return null;
  return rows.map((r) => ({
    home: r.home_name,
    away: r.away_name,
    homeAbbr: r.home_abbr,
    awayAbbr: r.away_abbr,
    score: Number(r.composite),
    followed: FOLLOWED_TEAMS.has(r.home_name) || FOLLOWED_TEAMS.has(r.away_name),
  }));
}

// =============================================================================
// 5. THE READ — most recent published longform.
// Preference: type='feature'. Fallback: feature OR recap with longest body.
// Returns null when nothing published yet.
// =============================================================================
export async function readTheRead() {
  // Primary: latest feature.
  let rows = await sql`
    SELECT slug, title, subtitle, type, published_at,
           coalesce(length(body), 0) AS body_len
      FROM articles
     WHERE status = 'published'
       AND type   = 'feature'
     ORDER BY published_at DESC NULLS LAST
     LIMIT 1
  `;
  if (rows.length === 0) {
    // Fallback: feature or recap with the longest body.
    rows = await sql`
      SELECT slug, title, subtitle, type, published_at,
             coalesce(length(body), 0) AS body_len
        FROM articles
       WHERE status = 'published'
         AND type   IN ('feature', 'recap')
       ORDER BY coalesce(length(body), 0) DESC, published_at DESC NULLS LAST
       LIMIT 1
    `;
  }
  if (rows.length === 0) return null;
  const r = rows[0];
  const bodyLen = Number(r.body_len) || 0;
  const words = Math.max(1, Math.round(bodyLen / 5.5));
  const minutes = Math.max(1, Math.round(words / 250));
  return {
    slug: r.slug,
    title: r.title,
    excerpt: r.subtitle ?? null,
    kicker: r.type === 'feature' ? 'Feature' : 'Match Recap',
    words,
    read_time_min: minutes,
    type: r.type,
  };
}

// =============================================================================
// 6. THE MARKET — odds as explanation (NOT a ranked ladder).
// Computes one de-vigged shortest-priced read for the explainer prose.
// Returns null when there are no current tournament_winner rows.
// =============================================================================
export async function readTheMarket() {
  const rows = await sql`
    SELECT t.name AS team_name,
           t.abbreviation AS abbreviation,
           om.implied_probability::float AS implied_prob
      FROM odds_markets om
      JOIN teams t ON t.id = om.team_id
      JOIN leagues lg ON lg.id = om.league_id
     WHERE lg.slug = ${WC_LEAGUE_SLUG}
       AND om.market_type = 'tournament_winner'
       AND om.is_current  = true
       AND om.team_id IS NOT NULL
       AND om.implied_probability IS NOT NULL
     ORDER BY om.implied_probability DESC
  `;
  if (rows.length === 0) return null;
  const sum = rows.reduce((acc, r) => acc + (r.implied_prob ?? 0), 0);
  if (!(sum > 0)) return null;
  const top = rows[0];
  return {
    topName: top.team_name,
    topAbbr: top.abbreviation,
    topPctDevig: (top.implied_prob / sum) * 100,
    totalCount: rows.length,
  };
}
