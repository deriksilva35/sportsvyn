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

// PT-locked kickoff formatter — "3:00 PM PT". Mirrors the homepage's
// fmtKickoffPt (app/page.js) so the deck and the site read identically.
// Returns a finished STRING; the client never re-derives time from a Date,
// which is what sidesteps the KickoffTime hydration mismatch.
function fmtKickoffPt(kickoffAt) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(kickoffAt)) + ' PT';
}

// =============================================================================
// 0. TODAY'S CARD — today's PT World Cup slate + per-match peak Watch Score.
//
// The deck's lead card (replaces NEXT UP). Mirrors the homepage's
// SlateSection data path (app/page.js) WITHOUT importing it:
//
//   fixtures   ← readFixturesByPtDay (lib/scheduleData.js), reimplemented
//                locally and narrowed to the WC league AND today's PT day.
//                PT-day grouping is computed in SQL via AT TIME ZONE so a
//                00:00Z kickoff lands on the correct PT calendar day, not
//                the UTC one (the load-bearing detail scheduleData.js calls
//                out for the two 00:00Z-kickoff seeded fixtures).
//   watchScore ← getWatchScoresForDate (lib/watchScore.js), reimplemented
//                locally: each match's PEAK composite_score for the day,
//                INNER-joined to the history so matches with no ticks simply
//                don't appear in the map (→ watchScore null, never a fake 0).
//
// dateline and each kickoffLabel are formatted SERVER-SIDE, PT-locked, and
// returned as ready-to-render strings — the client does zero Date math.
//
// Never returns null: an empty slate is { dateline, fixtures: [], count: 0 }
// so the card renders an honest "No matches today" rather than collapsing.
// =============================================================================
export async function readTodaysCard() {
  // Today's PT calendar day, "YYYY-MM-DD" (en-CA yields the ISO-shaped date).
  const ptDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

  // Server-computed dateline, PT-locked (hydration-safe): "Wed, Jun 24".
  // Same shape as the homepage's fmtPtDate.
  const dateline = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short', month: 'short', day: 'numeric',
  }).format(new Date());

  // Today's WC fixtures, ordered by kickoff. Replicates readFixturesByPtDay's
  // join/filter, narrowed to one PT day and the WC league.
  const rows = await sql`
    SELECT
      m.id, m.slug, m.kickoff_at, m.status,
      m.home_score, m.away_score,
      h.name AS home_name, h.abbreviation AS home_abbreviation, h.flag_svg_path AS home_flag,
      a.name AS away_name, a.abbreviation AS away_abbreviation, a.flag_svg_path AS away_flag
    FROM matches m
    JOIN teams   h  ON h.id  = m.home_team_id
    JOIN teams   a  ON a.id  = m.away_team_id
    JOIN leagues lg ON lg.id = m.league_id
   WHERE lg.slug = ${WC_LEAGUE_SLUG}
     AND (m.kickoff_at AT TIME ZONE 'America/Los_Angeles')::date = ${ptDay}::date
   ORDER BY m.kickoff_at ASC, m.id ASC
  `;

  // Per-match PEAK Watch Score for the day. Replicates getWatchScoresForDate:
  // MAX(composite_score) per match via LATERAL, INNER on `composite IS NOT
  // NULL` so untracked matches drop out (and read as watchScore null below).
  const wsRows = await sql`
    SELECT m.id AS match_id, ws.composite::float AS composite
      FROM matches m
      JOIN leagues lg ON lg.id = m.league_id
      JOIN LATERAL (
        SELECT MAX(h.composite_score)::float AS composite
          FROM match_watch_score_history h
         WHERE h.match_id = m.id
      ) ws ON ws.composite IS NOT NULL
     WHERE lg.slug = ${WC_LEAGUE_SLUG}
       AND (m.kickoff_at AT TIME ZONE 'America/Los_Angeles')::date = ${ptDay}::date
  `;
  const watchByMatch = new Map();
  for (const r of wsRows) watchByMatch.set(r.match_id, Number(r.composite));

  const fixtures = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    home: {
      name: r.home_name,
      abbreviation: r.home_abbreviation,
      flag_svg_path: r.home_flag,
      followed: FOLLOWED_TEAMS.has(r.home_name),
    },
    away: {
      name: r.away_name,
      abbreviation: r.away_abbreviation,
      flag_svg_path: r.away_flag,
      followed: FOLLOWED_TEAMS.has(r.away_name),
    },
    kickoffLabel: fmtKickoffPt(r.kickoff_at),
    status: r.status,
    isLive: r.status === 'live',
    isFinal: r.status === 'final',
    home_score: r.home_score,
    away_score: r.away_score,
    watchScore: watchByMatch.get(r.id) ?? null,
  }));

  return { dateline, fixtures, count: fixtures.length };
}

// =============================================================================
// 1. NEXT UP — next WC fixture + match-winner probability + prematch copy.
//
// Editorial copy is sourced from the prematch analyst-pass row on `articles`
// (type='preview', score_type='watch', status='published'), associated to
// the match by articles.match_id. The /api/cron/prematch-analyst cron keeps
// this row fresh for every upcoming WC fixture within a 72h kickoff window,
// so NEXT UP is self-maintaining — no hand-keyed slug map.
//
// Mapping into the card shape:
//   lede  ← article.subtitle  (the 40-70 word watch_summary — purpose-built
//                              verdict prose, exactly lede shape)
//   body  ← article.body      (two-paragraph editorial preview)
//   watch ← null              (the analyst pass writes prose, not discrete
//                              bullets; the card hides the block on null
//                              rather than fabricate)
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

  // Prematch analyst-pass row. One row per match (the freeze invariant in
  // lib/aiPrematchRunner.js enforces single-row uniqueness on
  // match_id+type+score_type). Falls back to null cleanly when the cron
  // hasn't generated the row yet — card renders the bare fixture + win-prob.
  const previewRows = await sql`
    SELECT body, subtitle
      FROM articles
     WHERE match_id    = ${m.id}
       AND type        = 'preview'
       AND score_type  = 'watch'
       AND status      = 'published'
       AND body        IS NOT NULL
     ORDER BY published_at DESC NULLS LAST
     LIMIT 1
  `;
  const preview = previewRows[0] ?? null;

  return {
    match,
    meta,
    winProb,
    lede: preview?.subtitle ?? null,
    body: preview?.body ?? null,
    watch: null,
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
// Preference cascade: feature → recap → essay → any published non-preview
// (longest body wins the final fallback). Returns null when nothing published.
// =============================================================================
export async function readTheRead() {
  async function latestOfType(type) {
    return sql`
      SELECT slug, title, subtitle, type, published_at,
             coalesce(length(body), 0) AS body_len
        FROM articles
       WHERE status = 'published'
         AND type   = ${type}
       ORDER BY published_at DESC NULLS LAST
       LIMIT 1
    `;
  }

  let rows = await latestOfType('feature');
  if (rows.length === 0) rows = await latestOfType('recap');
  if (rows.length === 0) rows = await latestOfType('essay');
  if (rows.length === 0) {
    rows = await sql`
      SELECT slug, title, subtitle, type, published_at,
             coalesce(length(body), 0) AS body_len
        FROM articles
       WHERE status = 'published'
         AND type   <> 'preview'
       ORDER BY coalesce(length(body), 0) DESC, published_at DESC NULLS LAST
       LIMIT 1
    `;
  }
  if (rows.length === 0) return null;
  const r = rows[0];
  const bodyLen = Number(r.body_len) || 0;
  const words = Math.max(1, Math.round(bodyLen / 5.5));
  const minutes = Math.max(1, Math.round(words / 250));
  const KICKER_BY_TYPE = { feature: 'Feature', recap: 'Match Recap', essay: 'Essay' };
  return {
    slug: r.slug,
    title: r.title,
    excerpt: r.subtitle ?? null,
    kicker: KICKER_BY_TYPE[r.type] ?? 'Read',
    words,
    read_time_min: minutes,
    type: r.type,
  };
}

// =============================================================================
// 6. STATS — Golden Boot Top 5 + tournament totals.
// Self-contained CTE over match_events. Wave 1 source of truth: we never read
// player_match_stats / team_tournament_stats (both 0 rows on PROD — Wave 2).
// is_current = true on every match_events filter so VAR-reversed events drop
// out automatically. Returns null when no scorers yet, for honest empty state.
// =============================================================================
export async function readStatsTopScorers() {
  const scorers = await sql`
    WITH lg_matches AS (
      SELECT m.id FROM matches m
        JOIN leagues lg ON lg.id = m.league_id
       WHERE lg.slug = ${WC_LEAGUE_SLUG}
    ),
    scorer_stats AS (
      SELECT me.player_api_id,
             MAX(me.player_name) AS event_name,
             -- Event-level team identity. A scorer plays for ONE national
             -- team across all WC goal events, so MAX is just "pick any".
             -- This is the unambiguous flag source (vs guessing from
             -- home/away or trusting the players table to exist).
             MAX(me.team_api_id) AS team_api_id,
             COUNT(*) FILTER (
               WHERE me.detail NOT IN ('Own Goal', 'Goal cancelled', 'Missed Penalty')
             )::int AS goals
        FROM match_events me
       WHERE me.is_current = true
         AND me.event_type = 'Goal'
         AND me.player_api_id IS NOT NULL
         AND me.match_id IN (SELECT id FROM lg_matches)
       GROUP BY me.player_api_id
      HAVING COUNT(*) FILTER (
               WHERE me.detail NOT IN ('Own Goal', 'Goal cancelled', 'Missed Penalty')
             ) > 0
    ),
    assist_stats AS (
      SELECT me.assist_api_id, COUNT(*)::int AS assists
        FROM match_events me
       WHERE me.is_current = true
         AND me.event_type = 'Goal'
         AND me.detail NOT IN ('Own Goal', 'Goal cancelled', 'Missed Penalty')
         AND me.assist_api_id IS NOT NULL
         AND me.match_id IN (SELECT id FROM lg_matches)
       GROUP BY me.assist_api_id
    )
    SELECT
      COALESCE(p.full_name, s.event_name)  AS name,
      p.slug                                AS player_slug,
      p.position                            AS pos,
      t.name                                AS team_name,
      t.abbreviation                        AS team_abbr,
      t.flag_svg_path                       AS flag_svg_path,
      s.goals,
      COALESCE(a.assists, 0)::int          AS assists
    FROM scorer_stats s
    LEFT JOIN assist_stats a ON a.assist_api_id = s.player_api_id
    LEFT JOIN players p ON (p.external_ids->>'api_sports')::int = s.player_api_id
    -- Flag join: event-level team (s.team_api_id) is the scoring team for
    -- the goal event. Filtered to the WC league so the flag comes from the
    -- correct teams row when a national side has multiple league bindings.
    -- Independent of the players-row presence — works for scorers without
    -- a populated players entry.
    LEFT JOIN teams   t
      ON (t.external_ids->>'api_sports')::int = s.team_api_id
     AND t.league_id IN (SELECT id FROM leagues WHERE slug = ${WC_LEAGUE_SLUG})
    ORDER BY s.goals DESC, COALESCE(a.assists, 0) DESC, name ASC
    LIMIT 5
  `;
  if (scorers.length === 0) return null;

  const [matchTotals] = await sql`
    SELECT COUNT(*) FILTER (WHERE m.status IN ('final','live'))::int AS matches_played
      FROM matches m
      JOIN leagues lg ON lg.id = m.league_id
     WHERE lg.slug = ${WC_LEAGUE_SLUG}
  `;
  const [goalTotals] = await sql`
    SELECT COUNT(*)::int AS goals
      FROM match_events me
      JOIN matches m  ON m.id  = me.match_id
      JOIN leagues lg ON lg.id = m.league_id
     WHERE lg.slug = ${WC_LEAGUE_SLUG}
       AND me.is_current = true
       AND me.event_type = 'Goal'
       AND me.detail NOT IN ('Own Goal', 'Goal cancelled', 'Missed Penalty')
  `;

  const matchesPlayed = matchTotals?.matches_played ?? 0;
  const totalGoals    = goalTotals?.goals ?? 0;
  const avgGoalsPerMatch = matchesPlayed > 0
    ? Math.round((totalGoals / matchesPlayed) * 10) / 10
    : 0;

  return {
    scorers: scorers.map((r) => ({
      name: r.name,
      player_slug: r.player_slug ?? null,
      pos: r.pos ?? null,
      team_name: r.team_name ?? null,
      team_abbr: r.team_abbr ?? null,
      flag_svg_path: r.flag_svg_path ?? null,
      goals: Number(r.goals),
      assists: Number(r.assists),
      followed: FOLLOWED_PLAYERS.has(r.name),
    })),
    matches_played: matchesPlayed,
    total_goals: totalGoals,
    avg_goals_per_match: avgGoalsPerMatch,
  };
}

// =============================================================================
// 7. SCHEDULE — the whole WC tournament, PT-day grouped, for the in-shell
// Schedules screen (Strategy 1: lives inside the /app shell, nav persists).
//
// Generalizes readTodaysCard from a single PT day to the full tournament
// range. Mirrors lib/scheduleData.js's readFixturesByPtDay range query
// WITHOUT importing it; the range matches /schedule's LOAD_RANGE_* bounds.
//
// Everything the client needs is computed SERVER-SIDE, PT-locked:
//   · kickoffLabel ← fmtKickoffPt ("3:00 PM PT")  — no client Date math
//   · dayLabel     ← "Wednesday · Jun 24"          (PT calendar day)
//   · isToday / isLive / isFinal pre-derived
//   · grouping into ordered { ptDay, dayLabel, isToday, fixtures } done here
// so the component renders groups directly, sidestepping KickoffTime's
// visitor-local hydration dance entirely.
//
// Commit 2 adds the interactive scaffolding the in-shell lenses/scrubber/
// filters need — all still computed/shaped server-side:
//   · stage + group_code per fixture (Stage / Group filters)
//   · scorer pips goals:{home,away} per fixture (readScheduleGoalsLocal)
//   · ptToday + tournamentStart/End so the scrubber builds its contiguous
//     7-day strip (incl. empty days) without recomputing PT date math.
// =============================================================================

// Tournament load window — matches /schedule's LOAD_RANGE_START/END
// (app/schedule/page.js). Generous bounds; the DB only returns rows that
// exist, so the pre/post buffer is free.
const SCHEDULE_RANGE_START = '2026-06-08';
const SCHEDULE_RANGE_END   = '2026-07-31';

// Scorer pips for the loaded fixtures — replicates lib/scheduleData.js's
// readScheduleGoals locally (no lib/ import). Returns Map<match_id,
// {home:[],away:[]}> of "Player MM'" lines. is_current=true drops VAR-reversed
// goals; Missed Penalty is excluded (a chance, not a scoring event); own goals
// get a " (og)" suffix and are credited to the stored team_side.
async function readScheduleGoalsLocal(matchIds) {
  if (!Array.isArray(matchIds) || matchIds.length === 0) return new Map();
  const rows = await sql`
    SELECT match_id, minute, minute_extra, team_side, player_name, detail
      FROM match_events
     WHERE match_id = ANY(${matchIds})
       AND is_current = true
       AND event_type = 'Goal'
       AND (detail IS NULL OR detail <> 'Missed Penalty')
     ORDER BY match_id, minute ASC, COALESCE(minute_extra, 0) ASC, id ASC
  `;
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.match_id)) out.set(r.match_id, { home: [], away: [] });
    const bucket  = out.get(r.match_id);
    const minute  = r.minute_extra ? `${r.minute}+${r.minute_extra}′` : `${r.minute}′`;
    const ownGoal = r.detail === 'Own Goal' ? ' (og)' : '';
    const line    = `${r.player_name ?? '—'}${ownGoal} ${minute}`;
    (r.team_side === 'home' ? bucket.home : bucket.away).push(line);
  }
  return out;
}

// PT-locked day header from a 'YYYY-MM-DD' PT-day string → "Wednesday · Jun 24".
// pt_day is already the PT calendar day (computed in SQL via AT TIME ZONE), so
// reading its parts back as a UTC date is drift-free and deterministic.
function ptDayHeaderLabel(ptDay) {
  const [y, m, d] = ptDay.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }).format(dt);
  const md      = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(dt);
  return `${weekday} · ${md}`;
}

export async function readSchedule() {
  // Today's PT calendar day, "YYYY-MM-DD" — used to flag the "today" group.
  const ptToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

  // Full-tournament fixtures. Replicates readFixturesByPtDay's join/filter
  // across the whole range. PT-day computed in SQL (the load-bearing detail:
  // a 00:00Z kickoff lands on the correct PT calendar day, not the UTC one).
  const rows = await sql`
    SELECT
      m.id, m.slug, m.kickoff_at, m.status,
      m.home_score, m.away_score, m.stage, m.group_code,
      to_char((m.kickoff_at AT TIME ZONE 'America/Los_Angeles')::date, 'YYYY-MM-DD') AS pt_day,
      h.name AS home_name, h.flag_svg_path AS home_flag, h.flag_color_primary AS home_flag_color,
      a.name AS away_name, a.flag_svg_path AS away_flag, a.flag_color_primary AS away_flag_color
    FROM matches m
    JOIN teams   h  ON h.id  = m.home_team_id
    JOIN teams   a  ON a.id  = m.away_team_id
    JOIN leagues lg ON lg.id = m.league_id
   WHERE lg.slug = ${WC_LEAGUE_SLUG}
     AND (m.kickoff_at AT TIME ZONE 'America/Los_Angeles')::date >= ${SCHEDULE_RANGE_START}::date
     AND (m.kickoff_at AT TIME ZONE 'America/Los_Angeles')::date <= ${SCHEDULE_RANGE_END}::date
   ORDER BY m.kickoff_at ASC, m.id ASC
  `;

  // Scorer pips for every loaded match, one round-trip. Empty Map when no
  // events; each fixture defaults to { home:[], away:[] } below.
  const goalsByMatch = await readScheduleGoalsLocal(rows.map((r) => r.id));

  // Group into ordered days. Rows are already kickoff-ASC, so first-seen
  // pt_day order is chronological — no sort needed.
  const days = [];
  const byDay = new Map();
  for (const r of rows) {
    let group = byDay.get(r.pt_day);
    if (!group) {
      group = {
        ptDay: r.pt_day,
        dayLabel: ptDayHeaderLabel(r.pt_day),
        isToday: r.pt_day === ptToday,
        fixtures: [],
      };
      byDay.set(r.pt_day, group);
      days.push(group);
    }
    group.fixtures.push({
      id: r.id,
      slug: r.slug,
      stage: r.stage,
      group_code: r.group_code,
      home: {
        name: r.home_name,
        flag_svg_path: r.home_flag,
        flag_color: r.home_flag_color,
        followed: FOLLOWED_TEAMS.has(r.home_name),
      },
      away: {
        name: r.away_name,
        flag_svg_path: r.away_flag,
        flag_color: r.away_flag_color,
        followed: FOLLOWED_TEAMS.has(r.away_name),
      },
      kickoffLabel: fmtKickoffPt(r.kickoff_at),
      status: r.status,
      isLive: r.status === 'live',
      isFinal: r.status === 'final',
      home_score: r.home_score,
      away_score: r.away_score,
      goals: goalsByMatch.get(r.id) ?? { home: [], away: [] },
    });
  }

  // Bounds for the scrubber's contiguous window (incl. empty days). ptToday
  // lets it open on today without recomputing PT date math client-side.
  return {
    days,
    count: rows.length,
    ptToday,
    tournamentStart: days[0]?.ptDay ?? null,
    tournamentEnd:   days[days.length - 1]?.ptDay ?? null,
  };
}

// =============================================================================
// 8. MATCH — single match snapshot for the in-shell match view, fetched
// ON DEMAND (per-match; can't preload 104 matches in /app's Promise.all).
//
// COMMIT 1 = STATIC pre-match + recap modules only. Mirrors the queries in
// app/match/[slug]/page.js WITHOUT importing it (self-contained, no lib/):
//   · match + teams           (the spine)
//   · watch score             ← articles analyst row (composite + 5 dims +
//                               notes). NB: a DIFFERENT source than Today's
//                               Card, which used match_watch_score_history's
//                               LATERAL MAX — here it's the editorial article.
//   · preview prose           ← articles (same source/shape as readNextUp:
//                               prefer score_type='watch', subtitle→lede,
//                               body→paragraph split)
//   · win probability         ← odds_markets 3-way (retires at FT)
//   · where to watch          ← match_broadcasters
//   · brief (recap)           ← match_briefs latest row
//
// DEFERRED to Commit 2 (NOT queried here): lineups, full odds detail, form,
// key-moments timeline, power-rankings compare, edge pick, live polling.
//
// Times are pre-formatted server-side, PT-locked (no KickoffTime). Returns
// null when the slug doesn't resolve so the shell can show an honest error.
// =============================================================================

// "Wed, Jun 24 · 3:00 PM PT" — PT-locked full kickoff label for the match meta.
function fmtKickoffFull(kickoffAt) {
  const d = new Date(kickoffAt);
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
  return `${date} · ${time} PT`;
}

export async function readMatch(slug) {
  const matchRows = await sql`
    SELECT
      m.id, m.slug, m.status, m.kickoff_at, m.home_score, m.away_score,
      m.venue, m.stage, m.group_code, m.home_team_id, m.away_team_id,
      h.name AS home_name, h.flag_svg_path AS home_flag, h.flag_color_primary AS home_flag_color,
      a.name AS away_name, a.flag_svg_path AS away_flag, a.flag_color_primary AS away_flag_color
    FROM matches m
    LEFT JOIN teams h ON h.id = m.home_team_id
    LEFT JOIN teams a ON a.id = m.away_team_id
    WHERE m.slug = ${slug}
    LIMIT 1
  `;
  const m = matchRows[0];
  if (!m) return null;

  const isLive  = m.status === 'live';
  const isFinal = m.status === 'final';
  const state   = isLive ? 'live' : isFinal ? 'recap' : 'prematch';

  const [watchRows, previewRows, oddsRows, bcastRows, briefRows, liveWatchRows, momentRows] = await Promise.all([
    // Watch Score — articles analyst row (NOT the history LATERAL).
    sql`
      SELECT composite_score,
             stakes_score, quality_score, narrative_score, drama_score, moment_score,
             stakes_note, quality_note, narrative_note, drama_note, moment_note,
             watch_summary
        FROM articles
       WHERE match_id = ${m.id}
         AND type = 'preview' AND score_type = 'watch' AND status = 'published'
       ORDER BY updated_at DESC
       LIMIT 1
    `,
    // Preview prose — same source/shape as readNextUp ("Next Up").
    sql`
      SELECT subtitle, body
        FROM articles
       WHERE match_id = ${m.id}
         AND type = 'preview' AND status = 'published' AND body IS NOT NULL
       ORDER BY (score_type = 'watch') DESC, updated_at DESC
       LIMIT 1
    `,
    // Win probability — current 3-way match_winner odds.
    sql`
      SELECT selection_label, implied_probability::float AS pct, american_odds
        FROM odds_markets
       WHERE match_id = ${m.id}
         AND market_scope = 'match' AND market_type = 'match_winner' AND is_current = true
    `,
    // Where to watch — US broadcasters.
    sql`
      SELECT broadcaster_name, broadcaster_type, is_primary, language_code
        FROM match_broadcasters
       WHERE match_id = ${m.id} AND country_code = 'US'
       ORDER BY display_order
    `,
    // Brief — latest recap row.
    sql`
      SELECT headline, paragraph_1, paragraph_2, paragraph_3, published_at, generated_at
        FROM match_briefs
       WHERE match_id = ${m.id}
       ORDER BY generated_at DESC
       LIMIT 1
    `,
    // LIVE watch-score tick series (DB-only; written every minute by the
    // poll-live cron's captureLiveWatchScoreTick). Same query LiveWatchScore
    // uses. This is the LIVE composite series — DISTINCT from the static
    // editorial articles composite above; we keep both. The latest tick also
    // carries the live clock (minute / minute_extra / status_short).
    sql`
      SELECT minute, minute_extra, status_short,
             home_score, away_score, goals_count, lead_changes,
             composite_score::float AS composite_score, recorded_at
        FROM match_watch_score_history
       WHERE match_id = ${m.id}
       ORDER BY recorded_at ASC, id ASC
    `,
    // Key moments — newest-first event feed incl. AI gloss. Same query the
    // KeyMoments component uses; is_current drops VAR-cancelled goals.
    sql`
      SELECT id, minute, minute_extra, event_type, detail, team_side,
             player_name, assist_name, gloss
        FROM match_events
       WHERE match_id = ${m.id} AND is_current = true
       ORDER BY minute DESC, minute_extra DESC NULLS LAST, id DESC
       LIMIT 50
    `,
  ]);

  // Watch Score (composite + dims + notes), or null when untracked.
  const w = watchRows[0] ?? null;
  const watchScore = w && w.composite_score != null
    ? {
        composite: Number(w.composite_score),
        dims: {
          stakes: w.stakes_score, quality: w.quality_score, narrative: w.narrative_score,
          drama: w.drama_score, moment: w.moment_score,
        },
        notes: {
          stakes: w.stakes_note, quality: w.quality_note, narrative: w.narrative_note,
          drama: w.drama_note, moment: w.moment_note,
        },
        summary: w.watch_summary ?? null,
      }
    : null;

  // Preview prose — subtitle→lede, body→paragraphs (split on blank lines).
  const p = previewRows[0] ?? null;
  const preview = p
    ? {
        lede: p.subtitle ?? null,
        paragraphs: (p.body ?? '').split(/\n\n+/).map((s) => s.trim()).filter(Boolean),
      }
    : null;

  // Win probability — exactly home/draw/away; retires at full-time.
  let winProb = null;
  if (!isFinal && oddsRows.length === 3) {
    const by = Object.fromEntries(oddsRows.map((r) => [r.selection_label, r]));
    if (by.home && by.draw && by.away) {
      winProb = {
        home_pct: by.home.pct, draw_pct: by.draw.pct, away_pct: by.away.pct,
        home_american: by.home.american_odds, draw_american: by.draw.american_odds, away_american: by.away.american_odds,
      };
    }
  }

  // Favored side from the visible win-prob (draw doesn't count); null at FT.
  let favored = null;
  if (winProb) {
    if (winProb.home_pct > winProb.away_pct) favored = 'home';
    else if (winProb.away_pct > winProb.home_pct) favored = 'away';
  }

  const whereToWatch = bcastRows.map((r) => ({
    name: r.broadcaster_name,
    type: r.broadcaster_type,
    primary: r.is_primary,
    language: r.language_code,
  }));

  const b = briefRows[0] ?? null;
  const brief = b
    ? {
        headline: b.headline,
        paragraphs: [b.paragraph_1, b.paragraph_2, b.paragraph_3].filter(Boolean),
        published_at: b.published_at ?? b.generated_at ?? null,
      }
    : null;

  // LIVE watch-score series (tick history). Distinct from the editorial
  // `watchScore` composite above. `latest` drives the live number; the
  // series drives the trend + sparkline. null when no ticks (pre-kickoff).
  const series = liveWatchRows.map((r) => ({
    minute: r.minute,
    minute_extra: r.minute_extra,
    status_short: r.status_short,
    home_score: r.home_score,
    away_score: r.away_score,
    goals_count: r.goals_count,
    lead_changes: r.lead_changes,
    composite: Number(r.composite_score),
  }));
  const liveWatch = series.length > 0
    ? { series, latest: series[series.length - 1], baseline: series[0].composite }
    : null;

  // Live clock — the latest tick's minute / extra / period (DB-only, no
  // API-Sports). The LiveHero clock reads the same fields (status.elapsed →
  // minute, status.short → status_short). Consumed by the live header only.
  const liveClock = liveWatch
    ? {
        minute: liveWatch.latest.minute,
        minute_extra: liveWatch.latest.minute_extra,
        status_short: liveWatch.latest.status_short,
      }
    : null;

  const keyMoments = momentRows.map((r) => ({
    id: r.id,
    minute: r.minute,
    minute_extra: r.minute_extra,
    event_type: r.event_type,
    detail: r.detail,
    team_side: r.team_side,
    player_name: r.player_name,
    assist_name: r.assist_name,
    gloss: r.gloss,
  }));

  return {
    slug: m.slug,
    state,
    header: {
      home: { name: m.home_name, flag_svg_path: m.home_flag, flag_color: m.home_flag_color, followed: FOLLOWED_TEAMS.has(m.home_name) },
      away: { name: m.away_name, flag_svg_path: m.away_flag, flag_color: m.away_flag_color, followed: FOLLOWED_TEAMS.has(m.away_name) },
      home_score: m.home_score,
      away_score: m.away_score,
      favored,
    },
    meta: {
      kickoffLabel: fmtKickoffFull(m.kickoff_at),
      venue: m.venue ?? null,
      stage: m.stage ?? null,
    },
    watchScore,
    preview,
    winProb,
    whereToWatch,
    brief,
    // Live fields (DB-only; refreshed each tick when loadMatch is re-called).
    liveClock,
    liveWatch,
    keyMoments,
  };
}

// =============================================================================
// 9. RANKINGS — Team Power + Tournament MVP (player-power), both lists in one
// reader for the in-shell Rankings screen (lazy-loaded via loadRankings).
//
// Replicates lib/rankings.js's getCurrentEdition + getRankingsForPage +
// getPlayerRankingsForPage WITHOUT importing them. Both are the CURRENT
// published edition (is_current=true, status='published'). The AI blurb is
// the editor-approved row blurb from the editorial_blurbs table (blurb_type=
// 'ranking_row_blurb') — NOT articles — joined per ranking_entry with the
// same fingerprint guard the web uses (so a blurb only shows if it was
// approved against the current finals fingerprint). Top-10 carry a blurb;
// 11+ come back blurb=null naturally (no approved row blurb).
//
// Edition published_at is PT-pre-formatted server-side (no KickoffTime).
// A list with no current edition returns { empty: true } for an honest
// empty state (defensive — both are populated on PROD right now).
// =============================================================================

// PT-locked edition-updated label, e.g. "Jun 27, 9:00 AM PT".
function fmtRankUpdated(d) {
  if (!d) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(d)) + ' PT';
}
function editionLabelOf(ed) {
  return ed.edition_label
    ? `Edition ${ed.edition_number} · ${ed.edition_label}`
    : `Edition ${ed.edition_number}`;
}

export async function readRankings() {
  const currentEditionSql = (listSlug) => sql`
    SELECT ed.id, ed.edition_number, ed.edition_label, ed.published_at
      FROM ranking_editions ed
      JOIN ranking_lists rl ON rl.id = ed.ranking_list_id
      JOIN leagues lg       ON lg.id = rl.league_id
     WHERE rl.slug = ${listSlug} AND lg.slug = ${WC_LEAGUE_SLUG}
       AND ed.is_current = true AND ed.status = 'published'
     LIMIT 1
  `;

  const [teamEdRows, playerEdRows, teamRows, playerRows, finalsRows] = await Promise.all([
    currentEditionSql('team-power'),
    currentEditionSql('player-power'),
    // Team Power rows — replicates getRankingsForPage (record + blurb join).
    sql`
      SELECT
        e.rank, e.team_id,
        t.name AS team_name, t.slug AS team_slug,
        t.flag_svg_path AS team_flag_svg_path, t.flag_color_primary AS team_flag_color_primary,
        e.score::float AS score, e.movement_label,
        e.editorial_composite::float AS editorial_composite, e.sites_composite::float AS sites_composite,
        rec.wins, rec.draws, rec.losses, rec.gf, rec.ga, rec.matches_played,
        b.body AS blurb_body
      FROM ranking_entries e
      JOIN ranking_editions ed ON ed.id = e.ranking_edition_id
      JOIN ranking_lists rl    ON rl.id = ed.ranking_list_id
      JOIN leagues lg          ON lg.id = rl.league_id
      JOIN teams t             ON t.id  = e.team_id
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS fingerprint
          FROM matches m
         WHERE m.league_id = lg.id AND m.status = 'final'
           AND (m.home_team_id = t.id OR m.away_team_id = t.id)
      ) fp ON true
      LEFT JOIN LATERAL (
        SELECT
          count(*) FILTER (WHERE (m.home_team_id=t.id AND m.home_score>m.away_score) OR (m.away_team_id=t.id AND m.away_score>m.home_score))::int AS wins,
          count(*) FILTER (WHERE m.home_score = m.away_score)::int AS draws,
          count(*) FILTER (WHERE (m.home_team_id=t.id AND m.home_score<m.away_score) OR (m.away_team_id=t.id AND m.away_score<m.home_score))::int AS losses,
          COALESCE(sum(CASE WHEN m.home_team_id=t.id THEN m.home_score ELSE m.away_score END),0)::int AS gf,
          COALESCE(sum(CASE WHEN m.home_team_id=t.id THEN m.away_score ELSE m.home_score END),0)::int AS ga,
          count(*)::int AS matches_played
          FROM matches m
         WHERE m.league_id = lg.id AND m.status = 'final'
           AND (m.home_team_id = t.id OR m.away_team_id = t.id)
      ) rec ON true
      LEFT JOIN editorial_blurbs b
             ON b.ranking_entry_id = e.id
            AND b.blurb_type = 'ranking_row_blurb' AND b.status = 'editor_approved' AND b.is_current = true
            AND (b.approved_against_fingerprint IS NULL OR b.approved_against_fingerprint = fp.fingerprint)
      WHERE rl.slug = 'team-power' AND lg.slug = ${WC_LEAGUE_SLUG}
        AND ed.is_current = true AND ed.status = 'published'
      ORDER BY e.rank ASC
      LIMIT 48
    `,
    // Tournament MVP rows — replicates getPlayerRankingsForPage.
    sql`
      SELECT
        e.rank,
        COALESCE(p.known_as, p.full_name) AS player_name, p.slug AS player_slug, p.position AS player_position,
        nt.flag_svg_path AS team_flag_svg_path, nt.flag_color_primary AS team_flag_color_primary,
        e.score::float AS score, e.output_score::float AS production_score, e.impact_score::float AS impact_score,
        e.movement_label, b.body AS blurb_body
      FROM ranking_entries e
      JOIN ranking_editions ed ON ed.id = e.ranking_edition_id
      JOIN ranking_lists rl    ON rl.id = ed.ranking_list_id
      JOIN leagues lg          ON lg.id = rl.league_id
      JOIN players p           ON p.id  = e.player_id
      LEFT JOIN teams nt       ON nt.id = p.current_team_id
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS fingerprint
          FROM match_events me JOIN matches m ON m.id = me.match_id
         WHERE m.league_id = lg.id AND me.is_current = true
           AND (me.player_api_id = (p.external_ids->>'api_sports')::int
                OR me.assist_api_id = (p.external_ids->>'api_sports')::int)
      ) fp ON true
      LEFT JOIN editorial_blurbs b
             ON b.ranking_entry_id = e.id
            AND b.blurb_type = 'ranking_row_blurb' AND b.status = 'editor_approved' AND b.is_current = true
            AND (b.approved_against_fingerprint IS NULL OR b.approved_against_fingerprint = fp.fingerprint)
      WHERE rl.slug = 'player-power' AND lg.slug = ${WC_LEAGUE_SLUG}
        AND ed.is_current = true AND ed.status = 'published'
      ORDER BY e.rank ASC
      LIMIT 50
    `,
    // Finals count → group-stage points are dropped once knockouts begin (>72).
    sql`SELECT count(*)::int AS n FROM matches m JOIN leagues lg ON lg.id = m.league_id WHERE lg.slug = ${WC_LEAGUE_SLUG} AND m.status = 'final'`,
  ]);

  const showPoints = (finalsRows[0]?.n ?? 0) <= 72;

  const teamEd = teamEdRows[0] ?? null;
  const teams = teamEd
    ? {
        editionLabel: editionLabelOf(teamEd),
        updatedLabel: fmtRankUpdated(teamEd.published_at),
        showPoints,
        rows: teamRows.map((r) => ({
          rank: r.rank,
          name: r.team_name,
          slug: r.team_slug,
          flag_svg_path: r.team_flag_svg_path,
          flag_color: r.team_flag_color_primary,
          score: r.score,
          movement: r.movement_label,
          editorial: r.editorial_composite,
          sites: r.sites_composite,
          wins: r.wins, draws: r.draws, losses: r.losses, gf: r.gf, ga: r.ga,
          matches_played: r.matches_played,
          followed: FOLLOWED_TEAMS.has(r.team_name),
          blurb: r.blurb_body ?? null,
        })),
      }
    : { empty: true };

  const playerEd = playerEdRows[0] ?? null;
  const players = playerEd
    ? {
        editionLabel: editionLabelOf(playerEd),
        updatedLabel: fmtRankUpdated(playerEd.published_at),
        rows: playerRows.map((r) => ({
          rank: r.rank,
          name: r.player_name,
          slug: r.player_slug,
          position: r.player_position,
          flag_svg_path: r.team_flag_svg_path,
          flag_color: r.team_flag_color_primary,
          score: r.score,
          movement: r.movement_label,
          production: r.production_score,
          impact: r.impact_score,
          followed: FOLLOWED_PLAYERS.has(r.player_name),
          blurb: r.blurb_body ?? null,
        })),
      }
    : { empty: true };

  return { teams, players };
}

// =============================================================================
// 10. BRACKET — knockout (vertical round-by-round) + group standings, for the
// in-shell Bracket screen (lazy-loaded via loadBracket).
//
// Replicates lib/bracket.js's getKnockoutBracket + getGroupStandings WITHOUT
// importing them. Two deltas vs the web reader:
//   · KNOCKOUT: adds m.slug (the web cell wasn't tappable; the app opens the
//     in-shell match view from resolved cells, which needs the slug), and
//     pre-derives dateLabel (PT) / isFinal / isLive / winner side. Grouped
//     server-side into ordered rounds (R32→…→Final).
//   · GROUP STANDINGS: computed in JS from group membership + final matches
//     with STANDARD tiebreakers (points → GD → GF → name) — NOT the full
//     FIFA-2026 head-to-head chain (lib/bracket's orderGroup/sortClusterFifa2026
//     are too intricate to port self-contained). Advancement badges
//     (computeAdvancement) are OMITTED — settled now that the group stage is
//     complete; the knockout bracket itself shows who advanced.
//
// Times are PT-pre-formatted server-side (no KickoffTime).
// =============================================================================

const BRACKET_GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
const BRACKET_STAGE_ORDER = ['round_of_32', 'round_of_16', 'quarter', 'semi', 'third_place', 'final'];
const BRACKET_ROUND_LABEL = {
  round_of_32: 'Round of 32', round_of_16: 'Round of 16', quarter: 'Quarters',
  semi: 'Semis', third_place: 'Third Place', final: 'Final',
};

// PT short knockout date, e.g. "JUN 28" (matches the web's fmtKoDate uppercase).
function fmtKoDate(kickoffAt) {
  if (!kickoffAt) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric',
  }).format(new Date(kickoffAt)).toUpperCase();
}

export async function readBracket() {
  const [knockoutRows, memberRows, groupFinals, pendingRows] = await Promise.all([
    // Knockout matches — replicates getKnockoutBracket + m.slug.
    sql`
      SELECT m.id AS match_id, m.slug, m.stage, m.kickoff_at, m.venue, m.status,
             m.home_team_id, m.away_team_id, m.home_score, m.away_score, m.metadata,
             ht.name AS home_name, ht.slug AS home_slug, ht.flag_svg_path AS home_flag, ht.flag_color_primary AS home_flag_color,
             at.name AS away_name, at.slug AS away_slug, at.flag_svg_path AS away_flag, at.flag_color_primary AS away_flag_color
        FROM matches m
        JOIN leagues lg ON lg.id = m.league_id
        LEFT JOIN teams ht ON ht.id = m.home_team_id
        LEFT JOIN teams at ON at.id = m.away_team_id
       WHERE lg.slug = ${WC_LEAGUE_SLUG}
         AND m.stage IN ('round_of_32','round_of_16','quarter','semi','third_place','final')
       ORDER BY (m.metadata->>'match_number')::int
    `,
    // Group membership (every team in a group fixture, played or not) + info.
    sql`
      SELECT DISTINCT m.group_code, v.tid AS team_id,
             t.name, t.slug, t.flag_svg_path, t.flag_color_primary
        FROM matches m
        JOIN leagues lg ON lg.id = m.league_id
        CROSS JOIN LATERAL (VALUES (m.home_team_id), (m.away_team_id)) AS v(tid)
        JOIN teams t ON t.id = v.tid
       WHERE lg.slug = ${WC_LEAGUE_SLUG} AND m.stage = 'group' AND m.group_code IS NOT NULL
         AND v.tid IS NOT NULL
    `,
    // Final group matches (drive the standings stats).
    sql`
      SELECT m.group_code, m.home_team_id, m.away_team_id, m.home_score, m.away_score
        FROM matches m
        JOIN leagues lg ON lg.id = m.league_id
       WHERE lg.slug = ${WC_LEAGUE_SLUG} AND m.stage = 'group' AND m.group_code IS NOT NULL
         AND m.status = 'final'
    `,
    // Pending group matches → groupStageComplete drives the default sub-tab.
    sql`
      SELECT count(*) FILTER (WHERE m.status <> 'final')::int AS pending
        FROM matches m JOIN leagues lg ON lg.id = m.league_id
       WHERE lg.slug = ${WC_LEAGUE_SLUG} AND m.stage = 'group' AND m.group_code IS NOT NULL
    `,
  ]);

  // ── Knockout: shape each match, then group into ordered rounds. ──
  const matches = [];
  for (const r of knockoutRows) {
    const mn = r.metadata?.match_number;
    if (mn == null) continue;
    const isFinal = r.status === 'final';
    const isLive  = r.status === 'live';
    let winner = null;
    if (isFinal && r.home_score != null && r.away_score != null) {
      if (r.home_score > r.away_score) winner = 'home';
      else if (r.away_score > r.home_score) winner = 'away';
    }
    matches.push({
      match_number: mn,
      match_id: r.match_id,
      slug: r.slug,
      stage: r.stage,
      roundLabel: BRACKET_ROUND_LABEL[r.stage] ?? (r.metadata?.round_label ?? r.stage),
      dateLabel: fmtKoDate(r.kickoff_at),
      venue: r.venue ?? null,
      status: r.status,
      isFinal,
      isLive,
      home_score: r.home_score,
      away_score: r.away_score,
      winner,
      home: r.home_team_id
        ? { resolved: true, team_id: r.home_team_id, name: r.home_name, slug: r.home_slug, flag_svg_path: r.home_flag, flag_color: r.home_flag_color, followed: FOLLOWED_TEAMS.has(r.home_name) }
        : { resolved: false, label: r.metadata?.slot_home?.label ?? 'TBD' },
      away: r.away_team_id
        ? { resolved: true, team_id: r.away_team_id, name: r.away_name, slug: r.away_slug, flag_svg_path: r.away_flag, flag_color: r.away_flag_color, followed: FOLLOWED_TEAMS.has(r.away_name) }
        : { resolved: false, label: r.metadata?.slot_away?.label ?? 'TBD' },
    });
  }
  const knockout = BRACKET_STAGE_ORDER
    .map((stage) => ({
      stage,
      roundLabel: BRACKET_ROUND_LABEL[stage],
      matches: matches.filter((m) => m.stage === stage),  // already match_number-ordered
    }))
    .filter((r) => r.matches.length > 0);

  // ── Group standings: stats from finals, ordered points→GD→GF→name. ──
  const byLetter = new Map();  // letter → Map<team_id, stat>
  for (const m of memberRows) {
    if (!byLetter.has(m.group_code)) byLetter.set(m.group_code, new Map());
    const g = byLetter.get(m.group_code);
    if (!g.has(m.team_id)) {
      g.set(m.team_id, {
        team_id: m.team_id, name: m.name, slug: m.slug,
        flag_svg_path: m.flag_svg_path, flag_color: m.flag_color_primary,
        wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, points: 0,
      });
    }
  }
  for (const m of groupFinals) {
    const g = byLetter.get(m.group_code);
    if (!g) continue;
    const home = g.get(m.home_team_id), away = g.get(m.away_team_id);
    if (!home || !away) continue;
    const hs = m.home_score ?? 0, as = m.away_score ?? 0;
    home.gf += hs; home.ga += as; away.gf += as; away.ga += hs;
    if (hs > as)      { home.wins++; home.points += 3; away.losses++; }
    else if (hs < as) { away.wins++; away.points += 3; home.losses++; }
    else              { home.draws++; away.draws++; home.points++; away.points++; }
  }
  const groups = BRACKET_GROUP_LETTERS
    .map((letter) => {
      const g = byLetter.get(letter);
      if (!g) return null;
      const teams = [...g.values()]
        .map((t) => ({ ...t, gd: t.gf - t.ga, followed: FOLLOWED_TEAMS.has(t.name) }))
        .sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.name.localeCompare(b.name))
        .map((t, i) => ({ ...t, pos: i + 1 }));
      return { letter, teams };
    })
    .filter((g) => g && g.teams.length > 0);

  const groupStageComplete = (pendingRows[0]?.pending ?? 1) === 0;

  return { knockout, groups, groupStageComplete };
}

// =============================================================================
// 11. STATS — tournament leaderboards for the in-shell Stats screen
// (lazy-loaded via loadStats). Leaderboards-first; the web's wide sortable
// All-Stats table is deferred.
//
// Replicates lib/stats.js EXACTLY: ONE wide aggregation over match_events
// (is_current, league-scoped) → one row per player who scored/assisted/was
// carded; every leaderboard is then a pure JS filter+sort+slice over that
// single dataset (no per-board DB hit). NOT tournament_aggregated_stats /
// player_match_stats (both 0 rows on PROD — Wave 2). Adds team flag
// (flag_svg_path + flag_color_primary) the web reader omits. sv_points uses
// the web's exact formula so the numbers match /stats. No dates anywhere.
// =============================================================================

// Copied verbatim from lib/stats.js computeSvPoints so SV Points match the web.
function computeSvPointsLocal(p) {
  const isDefOrGk = p.position === 'DEF' || p.position === 'GK';
  const goalWeight = isDefOrGk ? 6 : 5;
  const goalsPts   = Number(p.goals ?? 0) * goalWeight;
  const penaltyB   = Number(p.penalty_goals ?? 0) * 2;
  const assistPts  = Number(p.assists ?? 0) * 3;
  const ownGoalPts = Number(p.own_goals ?? 0) * -2;
  const yellowPts  = Number(p.yellow_cards ?? 0) * -1;
  const redPts     = Number(p.red_cards ?? 0) * -3;
  return goalsPts + penaltyB + assistPts + ownGoalPts + yellowPts + redPts;
}

// Descending comparator with numeric tiebreakers then name (mirrors lib/stats).
function statsDescBy(key, ...tiebreakers) {
  return (a, b) => {
    const d = (b[key] ?? 0) - (a[key] ?? 0);
    if (d !== 0) return d;
    for (const tk of tiebreakers) {
      const td = (b[tk] ?? 0) - (a[tk] ?? 0);
      if (td !== 0) return td;
    }
    return String(a.player_name ?? '').localeCompare(String(b.player_name ?? ''));
  };
}

const STATS_BOARD_DEPTH = 25;  // enough to scroll, not the full table

export async function readStats() {
  const [aggRows, matchCounts, eventCounts] = await Promise.all([
    // Wide per-player aggregation — quote-matches lib/stats.js + team flags.
    sql`
      WITH lg_matches AS (
        SELECT m.id FROM matches m JOIN leagues lg ON lg.id = m.league_id WHERE lg.slug = ${WC_LEAGUE_SLUG}
      ),
      scorer_stats AS (
        SELECT me.player_api_id, MAX(me.player_name) AS player_name,
               COUNT(*) FILTER (WHERE me.event_type='Goal' AND me.detail != 'Own Goal' AND me.detail != 'Goal cancelled' AND me.detail != 'Missed Penalty')::int AS goals,
               COUNT(*) FILTER (WHERE me.event_type='Goal' AND me.detail = 'Penalty')::int   AS penalty_goals,
               COUNT(*) FILTER (WHERE me.event_type='Goal' AND me.detail = 'Own Goal')::int  AS own_goals,
               COUNT(*) FILTER (WHERE me.event_type='Card' AND me.detail = 'Yellow Card')::int AS yellow_cards,
               COUNT(*) FILTER (WHERE me.event_type='Card' AND me.detail = 'Red Card')::int    AS red_cards
          FROM match_events me
         WHERE me.is_current = true AND me.player_api_id IS NOT NULL AND me.match_id IN (SELECT id FROM lg_matches)
         GROUP BY me.player_api_id
      ),
      assist_stats AS (
        SELECT me.assist_api_id AS player_api_id, MAX(me.assist_name) AS assist_name, COUNT(*)::int AS assists
          FROM match_events me
         WHERE me.is_current = true AND me.event_type='Goal' AND me.detail != 'Own Goal' AND me.detail != 'Goal cancelled' AND me.detail != 'Missed Penalty'
           AND me.assist_api_id IS NOT NULL AND me.match_id IN (SELECT id FROM lg_matches)
         GROUP BY me.assist_api_id
      ),
      unified AS (
        SELECT COALESCE(s.player_api_id, a.player_api_id) AS player_api_id,
               COALESCE(s.player_name, a.assist_name)     AS event_name,
               COALESCE(s.goals, 0) AS goals, COALESCE(s.penalty_goals, 0) AS penalty_goals,
               COALESCE(s.own_goals, 0) AS own_goals, COALESCE(a.assists, 0) AS assists,
               COALESCE(s.yellow_cards, 0) AS yellow_cards, COALESCE(s.red_cards, 0) AS red_cards
          FROM scorer_stats s FULL OUTER JOIN assist_stats a ON a.player_api_id = s.player_api_id
      )
      SELECT u.player_api_id,
             COALESCE(p.full_name, u.event_name) AS player_name,
             p.slug AS player_slug, p.position AS position,
             t.name AS team_name, t.slug AS team_slug, t.abbreviation AS team_abbr,
             t.flag_svg_path AS flag_svg_path, t.flag_color_primary AS flag_color,
             u.goals, u.penalty_goals, u.own_goals, u.assists, u.yellow_cards, u.red_cards,
             (u.goals + u.assists)::int AS goal_contributions
        FROM unified u
        LEFT JOIN players p ON (p.external_ids->>'api_sports')::int = u.player_api_id
        LEFT JOIN teams   t ON t.id = p.current_team_id
    `,
    sql`
      SELECT COUNT(*) FILTER (WHERE m.status IN ('final','live'))::int AS played_or_live
        FROM matches m JOIN leagues lg ON lg.id = m.league_id WHERE lg.slug = ${WC_LEAGUE_SLUG}
    `,
    sql`
      SELECT
        COUNT(*) FILTER (WHERE me.event_type='Goal' AND me.detail != 'Own Goal' AND me.detail != 'Goal cancelled' AND me.detail != 'Missed Penalty')::int AS goals,
        COUNT(*) FILTER (WHERE me.event_type='Goal' AND me.detail = 'Own Goal')::int AS own_goals,
        COUNT(*) FILTER (WHERE me.event_type='Goal' AND me.detail != 'Own Goal' AND me.detail != 'Goal cancelled' AND me.detail != 'Missed Penalty' AND me.assist_api_id IS NOT NULL)::int AS assists_recorded,
        COUNT(*) FILTER (WHERE me.event_type='Card' AND me.detail = 'Yellow Card')::int AS yellow_cards,
        COUNT(*) FILTER (WHERE me.event_type='Card' AND me.detail = 'Red Card')::int AS red_cards
        FROM match_events me JOIN matches m ON m.id = me.match_id JOIN leagues lg ON lg.id = m.league_id
       WHERE lg.slug = ${WC_LEAGUE_SLUG} AND me.is_current = true
    `,
  ]);

  // One enriched player array; every board derives from it.
  const players = aggRows.map((r) => ({
    player_api_id: r.player_api_id,
    player_name: r.player_name,
    player_slug: r.player_slug,
    position: r.position,
    team_name: r.team_name,
    team_abbr: r.team_abbr,
    team_slug: r.team_slug,
    flag_svg_path: r.flag_svg_path,
    flag_color: r.flag_color,
    goals: r.goals, penalty_goals: r.penalty_goals, own_goals: r.own_goals,
    assists: r.assists, yellow_cards: r.yellow_cards, red_cards: r.red_cards,
    goal_contributions: r.goal_contributions,
    sv_points: computeSvPointsLocal(r),
    followed: FOLLOWED_PLAYERS.has(r.player_name),
  }));

  const board = (filterFn, comparator) =>
    players.filter(filterFn).sort(comparator).slice(0, STATS_BOARD_DEPTH)
      .map((p, i) => ({ ...p, rank: i + 1 }));

  const scorers       = board((p) => p.goals > 0,              statsDescBy('goals', 'assists'));
  const assists       = board((p) => p.assists > 0,            statsDescBy('assists', 'goals'));
  const contributions = board((p) => p.goal_contributions > 0, statsDescBy('goal_contributions', 'goals'));
  const svPoints      = board((p) => p.sv_points > 0,          statsDescBy('sv_points', 'goals', 'assists'));
  const discipline    = board(
    (p) => (p.yellow_cards + p.red_cards) > 0,
    (a, b) => (b.red_cards - a.red_cards) || (b.yellow_cards - a.yellow_cards) || String(a.player_name ?? '').localeCompare(String(b.player_name ?? '')),
  );

  const mc = matchCounts[0] ?? {};
  const ec = eventCounts[0] ?? {};
  const matches = mc.played_or_live ?? 0;
  const totalGoalsInclOg = (ec.goals ?? 0) + (ec.own_goals ?? 0);
  const totals = {
    goals: ec.goals ?? 0,
    matches,
    avgGoals: matches > 0 ? Math.round((totalGoalsInclOg / matches) * 10) / 10 : 0,
    assists: ec.assists_recorded ?? 0,
    yellow: ec.yellow_cards ?? 0,
    red: ec.red_cards ?? 0,
  };

  return { totals, scorers, assists, contributions, svPoints, discipline };
}
