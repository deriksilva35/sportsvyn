// lib/mapKoFixtures.js — "Path A": map API-Sports fixture ids onto our seeded
// knockout rows so poll-live / syncFixture can pull their results.
//
// Our KO rows (M73..104) were created by the bracket seeder with STRUCTURAL
// slugs ('wc-2026-ko-N') and NO api_sports id, so syncFixture (which keys on
// api_sports id, then slug) had nothing to find them by — KO matches were never
// polled. This fetches the WC 2026 KO fixtures from API-Sports and, for each
// fixture whose BOTH teams we've resolved, finds OUR row by
// (stage-from-round, api HOME team id, api AWAY team id) — matching on TEAM IDS,
// never names — and proposes writing external_ids.api_sports = fixture.id.
//
// Idempotent: skips rows already mapped. Conservative: skips fixtures whose
// teams aren't resolved on our side yet (R16+ TBD) and any matchup whose
// orientation doesn't line up (so we never write a flipped score). Runs daily
// (the cron) so R16/QF/SF/final map as their teams resolve.

import { sql } from './db.js';
import { apiSports } from './apiSports.js';
import { syncFixture } from './syncFixture.js';

const WC_LEAGUE_SLUG = 'fifa-wc-2026';
const WC_LEAGUE_API_ID = 1;
const SEASON = 2026;

// API-Sports round string -> our matches.stage (mirrors scripts/import-wc.mjs).
export function stageForRound(round) {
  const r = (round || '').trim();
  if (/^Round of 32/i.test(r))           return 'round_of_32';
  if (/^Round of 16/i.test(r))           return 'round_of_16';
  if (/^Quarter[- ]?finals?/i.test(r))   return 'quarter';
  if (/^Semi[- ]?finals?/i.test(r))      return 'semi';
  if (/(3rd|third)[- ]place/i.test(r))   return 'third_place';
  if (/^Final$/i.test(r))                return 'final';
  return null; // Group Stage / unknown → not a KO mapping
}

export async function mapKoFixtures({ dryRun = true } = {}) {
  // 1. All WC 2026 fixtures from API-Sports (one call); keep KO rounds whose
  //    BOTH teams are known.
  const apiFixtures = await apiSports.fixtures(WC_LEAGUE_API_ID, SEASON);
  const koApi = [];
  for (const f of apiFixtures ?? []) {
    const stage = stageForRound(f.league?.round);
    if (!stage) continue;
    const homeApi = f.teams?.home?.id;
    const awayApi = f.teams?.away?.id;
    if (homeApi == null || awayApi == null) continue; // teams not drawn yet
    koApi.push({
      fixtureId: f.fixture.id,
      stage,
      round: f.league.round,
      homeApi, awayApi,
      homeName: f.teams.home.name, awayName: f.teams.away.name,
      statusShort: f.fixture.status?.short ?? null,
      homeGoals: f.goals?.home ?? null,
      awayGoals: f.goals?.away ?? null,
    });
  }

  // 2. Our KO rows + each side's team api_sports id + current api_sports.
  const ours = await sql`
    SELECT m.id, (m.metadata->>'match_number')::int AS mn, m.stage, m.slug,
           m.external_ids->>'api_sports' AS cur_apis,
           ht.name AS home_name, at.name AS away_name,
           (ht.external_ids->>'api_sports')::int AS home_api,
           (at.external_ids->>'api_sports')::int AS away_api
      FROM matches m
      JOIN leagues l  ON l.id = m.league_id
      LEFT JOIN teams ht ON ht.id = m.home_team_id
      LEFT JOIN teams at ON at.id = m.away_team_id
     WHERE l.slug = ${WC_LEAGUE_SLUG}
       AND m.stage IN ('round_of_32','round_of_16','quarter','semi','third_place','final')
     ORDER BY mn
  `;

  // 3. Index our rows by stage + (home api id, away api id). Orientation-strict
  //    so we never map a flipped matchup (which would write swapped scores).
  const ourByKey = new Map();
  for (const r of ours) {
    if (r.home_api == null || r.away_api == null) continue; // teams TBD on our side
    ourByKey.set(`${r.stage}|${r.home_api}|${r.away_api}`, r);
  }

  const proposals = [];
  const skipped = [];
  for (const f of koApi) {
    const row = ourByKey.get(`${f.stage}|${f.homeApi}|${f.awayApi}`);
    if (!row) { skipped.push({ fixtureId: f.fixtureId, stage: f.stage, match: `${f.homeName} v ${f.awayName}`, reason: 'no resolved seeded row (teams TBD our side, or orientation differs)' }); continue; }
    if (row.cur_apis != null) { skipped.push({ fixtureId: f.fixtureId, mn: row.mn, reason: `already mapped (api ${row.cur_apis})` }); continue; }
    proposals.push({
      ourId: row.id, mn: row.mn, stage: f.stage, slug: row.slug,
      home: row.home_name, away: row.away_name,
      fixtureId: f.fixtureId,
      apiStatus: f.statusShort,
      apiScore: f.homeGoals != null ? `${f.homeGoals}-${f.awayGoals}` : null,
    });
  }
  proposals.sort((a, b) => a.mn - b.mn);

  // 4. WRITE (only when not dryRun): merge api_sports onto each row, IS NULL
  //    guard (never overwrite), transactional. Stored as a STRING to match the
  //    group rows' convention (import-wc / syncFixture both store String(id)).
  let writes = 0;
  const synced = [];
  if (!dryRun && proposals.length > 0) {
    const stmts = proposals.map((p) => sql`
      UPDATE matches
         SET external_ids = jsonb_set(coalesce(external_ids, '{}'::jsonb), '{api_sports}', to_jsonb(${String(p.fixtureId)}::text)),
             updated_at = now()
       WHERE id = ${p.ourId}
         AND (external_ids->>'api_sports') IS NULL
    `);
    await sql.transaction(stmts);
    writes = proposals.length;

    // Sync-on-map: immediately pull kickoff/status/scores from the API for each
    // NEWLY-mapped fixture, so the row doesn't keep its seed-time kickoff. A
    // future-wrong seed kickoff would otherwise never satisfy poll-live's
    // (kickoff <= now()+15min) gate, so it would never be polled and never
    // self-correct (the Morocco/Canada wrong-kickoff + ko-97 late-map incidents).
    // Per-fixture isolation: one failed sync must not break the loop or the cron.
    for (const p of proposals) {
      try {
        const r = await syncFixture(p.fixtureId);
        synced.push({ mn: p.mn, fixture_id: p.fixtureId, slug: r.slug, ok: true, status: r.status, kickoff_at: r.kickoff_at });
      } catch (err) {
        synced.push({ mn: p.mn, fixture_id: p.fixtureId, ok: false, error: String(err?.message ?? err) });
      }
    }
  }

  return { proposals, skipped, writes, synced, dryRun, apiKoCount: koApi.length };
}
