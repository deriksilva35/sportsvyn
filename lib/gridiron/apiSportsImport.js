/**
 * lib/gridiron/apiSportsImport.js - API-Sports american-football games -> matches.
 *
 * The third gridiron game importer, and the only one that carries NFL
 * PRESEASON: BallDontLie has none, for any season, so there is no other route
 * to the August slate.
 *
 * It follows lib/gridiron/sync.js's conventions rather than inventing its own -
 * provider-keyed idempotent upsert, external_ids merged not replaced, every
 * datetime through toUtc, every status through mapStatus, every phase through
 * skipRule - because the value of those conventions is that a fourth importer
 * looks like the first three.
 *
 * WHAT IS DIFFERENT, and why:
 *
 *   · TEAMS RESOLVE BY PROVIDER ID, NOT BY NAME. scripts/map-apisports-teams.mjs
 *     already wrote external_ids.apisports_team_id onto all 32 NFL rows, under a
 *     human's eye. Matching names here would repeat that work on every sweep, at
 *     7pm, against a live slate. An unresolved team SKIPS the game and is
 *     counted; it never creates a stub, because a stub NFL team is always a bug
 *     rather than the missing-FCS-opponent case sync.js handles.
 *
 *   · THE PRO BOWL IS DROPPED. apiSportsPhaseAndWeek returns phase 'STAR' for
 *     it (the provider stages it "Post Season"), and skipRule drops STAR loudly
 *     with a count. Without that an all-star exhibition lands in team records.
 *
 *   · NOTHING IS WRITTEN FOR A ROW THAT CANNOT BE FULLY MAPPED. A null status,
 *     a null phase, an unparseable kickoff - each skips the row and increments a
 *     counter rather than writing a partial one. matches.kickoff_at is NOT NULL
 *     and a placeholder kickoff is worse than an absent game.
 *
 * CROSS-PROVIDER DUPLICATES ARE NOT HANDLED HERE, and the limit is real: the
 * upsert looks a game up by (league_id, external_ids->>'apisports_game_id'), so
 * if BDL ever imports the same fixture under its own key there will be two rows.
 * Safe today because the phases do not overlap - BDL carries REG and POST, this
 * carries PRE - which is exactly why importSeason takes a `phases` allowlist and
 * defaults it to PRE only. Widening it is a decision, not a parameter tweak.
 */

import { sql } from '../db.js';
import { apiSportsFootball, NFL_LEAGUE_ID } from '../apiSportsFootball.js';
import { toUtc, mapStatus, skipRule, makeRunSummary, apiSportsPhaseAndWeek } from './ingest.js';

const PROVIDER = 'apisports';
const PROVIDER_GAME_KEY = 'apisports_game_id';
const PROVIDER_TEAM_KEY = 'apisports_team_id';

// PRE only, by default and on purpose. See the cross-provider note above: BDL
// owns REG and POST for the NFL, and two providers writing the same fixture
// under different keys produces two rows with no error.
export const DEFAULT_PHASES = ['PRE'];

function slugify(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Slug shape mirrors sync.js's gridiron games: league-season-phase-week-away-home.
// Deterministic, so a re-import of the same game produces the same slug.
export function gameSlug({ leagueSlug, seasonYear, phase, week, away, home }) {
  return [
    leagueSlug, seasonYear, phase.toLowerCase(), `w${week}`,
    slugify(away), 'at', slugify(home),
  ].join('-');
}

async function teamMapByProviderId(leagueId) {
  const rows = await sql`
    SELECT id, external_ids->>${PROVIDER_TEAM_KEY} AS pid FROM teams
     WHERE league_id = ${leagueId} AND jsonb_exists(external_ids, ${PROVIDER_TEAM_KEY})`;
  return new Map(rows.map((r) => [r.pid, r.id]));
}

// Identical in shape to sync.js's upsertGame. Kept here rather than exported
// from there because that module's copy is bound to its own provider-key
// vocabulary and fetch helpers; sharing it would couple two importers that have
// no other reason to know about each other.
async function upsertGame(leagueId, providerId, g) {
  const ext = JSON.stringify({ [PROVIDER_GAME_KEY]: String(providerId) });
  const existing = (await sql`
    SELECT id FROM matches
     WHERE league_id = ${leagueId} AND external_ids->>${PROVIDER_GAME_KEY} = ${String(providerId)}
     LIMIT 1`)[0];

  if (existing) {
    await sql`
      UPDATE matches SET
        home_team_id = ${g.homeTeamId}, away_team_id = ${g.awayTeamId},
        kickoff_at = ${g.kickoffAt}, status = ${g.status},
        home_score = ${g.homeScore}, away_score = ${g.awayScore},
        season_year = ${g.seasonYear}, season_phase = ${g.seasonPhase}, week = ${g.week},
        metadata = matches.metadata || ${JSON.stringify(g.metadata ?? {})}::jsonb,
        external_ids = matches.external_ids || ${ext}::jsonb,
        data_provider_synced_at = now(), updated_at = now()
      WHERE id = ${existing.id}`;
    return { id: existing.id, inserted: false };
  }

  const rows = await sql`
    INSERT INTO matches (
      league_id, slug, home_team_id, away_team_id, kickoff_at, status,
      home_score, away_score, season_year, season_phase, week, metadata,
      external_ids, data_provider_synced_at
    ) VALUES (
      ${leagueId}, ${g.slug}, ${g.homeTeamId}, ${g.awayTeamId}, ${g.kickoffAt}, ${g.status},
      ${g.homeScore}, ${g.awayScore}, ${g.seasonYear}, ${g.seasonPhase}, ${g.week},
      ${JSON.stringify(g.metadata ?? {})}::jsonb, ${ext}::jsonb, now()
    ) RETURNING id`;
  return { id: rows[0].id, inserted: true };
}

/**
 * Turn one provider game object into the row we would write, or explain why we
 * would not. PURE apart from toUtc (which is async only for the SportsData
 * branch it never takes here) - so every mapping decision is testable against a
 * captured payload with no database and no network.
 *
 * Returns { ok: true, row } or { ok: false, reason }.
 */
export async function toMatchRow(game, { leagueSlug, leagueId, teams, runSummary }) {
  const g = game?.game ?? {};
  const providerId = g.id;
  if (providerId == null) return { ok: false, reason: 'no_provider_id' };

  const pw = apiSportsPhaseAndWeek(g.stage, g.week, runSummary);
  if (pw.phase == null) return { ok: false, reason: 'unmapped_stage' };

  // STAR (the Pro Bowl) is dropped here, loudly and counted, by the same rule
  // the other importers use for all-star rows.
  const gate = skipRule(pw.phase, runSummary);
  if (gate.skip) return { ok: false, reason: gate.reason };
  if (pw.week == null) return { ok: false, reason: 'unmapped_week' };

  const status = mapStatus(PROVIDER, 'nfl', g.status, runSummary);
  if (status == null) return { ok: false, reason: 'unmapped_status' };

  const kickoffAt = await toUtc(g.date?.timestamp ?? null, null, PROVIDER);
  if (kickoffAt == null) return { ok: false, reason: 'no_kickoff' };

  const homeName = game?.teams?.home?.name ?? null;
  const awayName = game?.teams?.away?.name ?? null;

  // TBD PARTICIPANTS ARE NOT A MAPPING FAILURE. The provider ships the 2026
  // playoff bracket with { id: 0, name: null } on both sides until the field is
  // seeded - 7 such games in the current payload. Counting those as unresolved
  // teams would fire the poller's alert on a completely healthy sweep, every
  // sweep, and an alert that cries wolf is an alert nobody reads. They get their
  // own counter and no alarm.
  const unseeded = [game?.teams?.home, game?.teams?.away]
    .some((t) => t == null || t.id == null || Number(t.id) === 0 || t.name == null);
  if (unseeded) {
    if (runSummary) runSummary.unseededMatchups = (runSummary.unseededMatchups ?? 0) + 1;
    return { ok: false, reason: 'unseeded_matchup' };
  }

  const homeTeamId = teams.get(String(game?.teams?.home?.id));
  const awayTeamId = teams.get(String(game?.teams?.away?.id));
  if (!homeTeamId || !awayTeamId) {
    // A NAMED team we cannot resolve is different: it means the team map is
    // stale, which is a thing to fix once and to be told about. Never a stub -
    // an unmapped NFL team is always a bug, unlike sync.js's missing-FCS case.
    if (runSummary) runSummary.unresolvedTeams = (runSummary.unresolvedTeams ?? 0) + 1;
    return { ok: false, reason: `unresolved_team: ${awayName} @ ${homeName}` };
  }

  const seasonYear = Number(game?.league?.season);
  if (!Number.isInteger(seasonYear)) return { ok: false, reason: 'no_season_year' };

  // Per-quarter scores land in metadata, matching sync.js: matches has no period
  // column and the shape is already established there.
  //
  // NOTE THE PATH. `scores` is a TOP-LEVEL key of the payload, a sibling of
  // `game` - not a child of it, the way stage/week/date/status are. The first
  // draft read g.scores (where g = payload.game) and silently produced
  // line_scores full of undefined while the totals, which were read from the
  // right place, stayed correct. Nothing would have thrown.
  const sc = game?.scores ?? {};
  const lineScores = {
    home: [sc.home?.quarter_1, sc.home?.quarter_2, sc.home?.quarter_3, sc.home?.quarter_4, sc.home?.overtime],
    away: [sc.away?.quarter_1, sc.away?.quarter_2, sc.away?.quarter_3, sc.away?.quarter_4, sc.away?.overtime],
  };
  const hasLine = [...lineScores.home, ...lineScores.away].some((v) => v != null);

  return {
    ok: true,
    providerId,
    row: {
      slug: gameSlug({ leagueSlug, seasonYear, phase: pw.phase, week: pw.week, away: awayName, home: homeName }),
      homeTeamId, awayTeamId,
      kickoffAt, status,
      homeScore: game?.scores?.home?.total ?? null,
      awayScore: game?.scores?.away?.total ?? null,
      seasonYear, seasonPhase: pw.phase, week: pw.week,
      metadata: {
        ...(hasLine ? { line_scores: lineScores } : {}),
        // The prose week is kept because "Hall of Fame Weekend" is not
        // reconstructable from week 0, and it is what a reader would call it.
        apisports_week_label: pw.label,
        venue: g.venue?.name ?? null,
        // City as well as stadium. The card foot wants a place, and "Canton"
        // says more to a reader in a one-line footer than "Tom Benson Hall of
        // Fame Stadium" does. Both are kept: the stadium is the fact, the city
        // is what fits.
        venue_city: g.venue?.city ?? null,
      },
    },
  };
}

/**
 * Import a season's games for one league.
 *
 * ONE REQUEST for a whole season (328 rows for NFL 2026), or one per day when
 * `date` is given - which is what the poller uses, because a day slate is one
 * request no matter how many games are on it.
 */
export async function importApiSportsGames({
  leagueSlug = 'nfl',
  season,
  date = null,
  phases = DEFAULT_PHASES,
  dryRun = false,
} = {}) {
  const runSummary = makeRunSummary();
  runSummary.unresolvedTeams = 0;
  runSummary.unseededMatchups = 0;
  runSummary.skippedByReason = {};

  const lg = (await sql`SELECT id FROM leagues WHERE slug = ${leagueSlug} LIMIT 1`)[0];
  if (!lg) throw new Error(`no league row for '${leagueSlug}'`);
  const teams = await teamMapByProviderId(lg.id);
  if (teams.size === 0) {
    throw new Error(`no ${leagueSlug} teams carry ${PROVIDER_TEAM_KEY} - run scripts/map-apisports-teams.mjs first`);
  }

  const games = await apiSportsFootball.games({ league: NFL_LEAGUE_ID, season, date });
  runSummary.fetched = games.length;
  runSummary.requests = 1;

  const allow = new Set(phases);
  let inserted = 0, updated = 0, skippedPhaseFilter = 0;

  for (const game of games) {
    const mapped = await toMatchRow(game, { leagueSlug, leagueId: lg.id, teams, runSummary });
    if (!mapped.ok) {
      const key = mapped.reason.split(':')[0];
      runSummary.skippedByReason[key] = (runSummary.skippedByReason[key] ?? 0) + 1;
      continue;
    }
    // The phase allowlist is applied AFTER mapping so the counters describe the
    // whole payload, not just the slice we keep.
    if (!allow.has(mapped.row.seasonPhase)) { skippedPhaseFilter += 1; continue; }
    if (dryRun) { inserted += 1; continue; }

    const r = await upsertGame(lg.id, mapped.providerId, mapped.row);
    if (r.inserted) inserted += 1; else updated += 1;
  }

  runSummary.ingested = inserted + updated;
  runSummary.inserted = inserted;
  runSummary.updated = updated;
  runSummary.skippedPhaseFilter = skippedPhaseFilter;
  runSummary.dryRun = dryRun;
  return runSummary;
}
