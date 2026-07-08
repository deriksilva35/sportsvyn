// lib/playerStatsSync.js — per-player per-match stats ingestion.
//
// Source: API-Sports /fixtures/players (apiSports.fixturePlayers). One call
// returns both squads with games.minutes / goals / assists / substitute /
// rating. Identity is api-id-keyed: payload.player.id ->
// players.external_ids->>'api_sports' (100% match on the WC squads), so NO
// name-matching. Unmatched players are counted and skipped (this pass never
// creates players rows). Unused subs (games.minutes = null) are NOT
// appearances and are not written.
//
// Re-runs OVERWRITE (ON CONFLICT (player_id, match_id) DO UPDATE) so provider
// stat corrections land on the +24h re-sync. data_provider_synced_at stamps
// each write and is the last-synced marker the sweep reads (cheapest option —
// the column already exists, no separate metadata table).

import { sql } from './db.js';
import { apiSports } from './apiSports.js';

const WC_LEAGUE_SLUG = 'fifa-wc-2026';

function unwrap(resp) {
  return Array.isArray(resp) ? resp : (resp?.response ?? []);
}
function numOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// syncPlayerStatsForMatch(matchId) -> { outcome, written, appearances,
// unmatched, skipped_bench }. Idempotent.
export async function syncPlayerStatsForMatch(matchId) {
  const mrows = await sql`
    SELECT m.id, m.external_ids->>'api_sports' AS api,
           m.home_team_id, m.away_team_id,
           ht.external_ids->>'api_sports' AS home_api,
           at.external_ids->>'api_sports' AS away_api
      FROM matches m
      JOIN teams ht ON ht.id = m.home_team_id
      JOIN teams at ON at.id = m.away_team_id
     WHERE m.id = ${matchId}
  `;
  const m = mrows[0];
  if (!m) return { outcome: 'match_not_found', written: 0, appearances: 0, unmatched: 0, skipped_bench: 0 };
  const apiId = Number(m.api);
  if (!Number.isInteger(apiId) || apiId <= 0) {
    return { outcome: 'no_api_id', written: 0, appearances: 0, unmatched: 0, skipped_bench: 0 };
  }

  let teams;
  try {
    teams = unwrap(await apiSports.fixturePlayers(apiId));
  } catch (err) {
    return { outcome: 'fetch_error', error: String(err?.message ?? err), written: 0, appearances: 0, unmatched: 0, skipped_bench: 0 };
  }
  if (!teams.length) {
    return { outcome: 'empty_payload', written: 0, appearances: 0, unmatched: 0, skipped_bench: 0 };
  }

  // API team id -> our team_id (both squads are this match's home/away).
  const teamApiToId = new Map();
  if (m.home_api != null) teamApiToId.set(String(m.home_api), m.home_team_id);
  if (m.away_api != null) teamApiToId.set(String(m.away_api), m.away_team_id);

  // Batch-resolve player api ids -> player_id.
  const allApiIds = [];
  for (const t of teams) for (const pp of (t.players || [])) allApiIds.push(String(pp.player.id));
  const idRows = await sql`
    SELECT external_ids->>'api_sports' AS api, id
      FROM players
     WHERE external_ids->>'api_sports' = ANY(${allApiIds})
  `;
  const playerApiToId = new Map(idRows.map((r) => [r.api, r.id]));

  let written = 0;
  let appearances = 0;
  let unmatched = 0;
  let skippedBench = 0;

  for (const t of teams) {
    const teamId = teamApiToId.get(String(t.team?.id));
    if (teamId == null) continue; // payload team not in this match (shouldn't happen)
    for (const pp of (t.players || [])) {
      const st = pp.statistics?.[0];
      const minutes = st?.games?.minutes;
      if (minutes == null) { skippedBench += 1; continue; } // unused sub — not an appearance
      const playerId = playerApiToId.get(String(pp.player.id));
      if (playerId == null) { unmatched += 1; continue; }   // report-and-skip; no players insert

      const started = st.games?.substitute === false;
      const goals = numOrNull(st.goals?.total) ?? 0;
      const assists = numOrNull(st.goals?.assists) ?? 0;
      const shots = numOrNull(st.shots?.total);
      const shotsOn = numOrNull(st.shots?.on);
      const rating = numOrNull(st.games?.rating);
      const conceded = numOrNull(st.goals?.conceded);
      const saves = numOrNull(st.goals?.saves);
      const xg = numOrNull(st.expected_goals ?? st.xg); // absent in this payload -> null

      await sql`
        INSERT INTO player_match_stats (
          player_id, match_id, team_id, started, minutes_played,
          goals, assists, shots, shots_on_target,
          match_rating, rating_source, goals_conceded, saves, xg,
          data_provider_synced_at, updated_at
        ) VALUES (
          ${playerId}, ${matchId}, ${teamId}, ${started}, ${minutes},
          ${goals}, ${assists}, ${shots}, ${shotsOn},
          ${rating}, 'data_provider', ${conceded}, ${saves}, ${xg},
          now(), now()
        )
        ON CONFLICT (player_id, match_id) DO UPDATE SET
          team_id = EXCLUDED.team_id,
          started = EXCLUDED.started,
          minutes_played = EXCLUDED.minutes_played,
          goals = EXCLUDED.goals,
          assists = EXCLUDED.assists,
          shots = EXCLUDED.shots,
          shots_on_target = EXCLUDED.shots_on_target,
          match_rating = EXCLUDED.match_rating,
          rating_source = EXCLUDED.rating_source,
          goals_conceded = EXCLUDED.goals_conceded,
          saves = EXCLUDED.saves,
          xg = EXCLUDED.xg,
          data_provider_synced_at = now(),
          updated_at = now()
      `;
      written += 1;
      appearances += 1;
    }
  }
  return { outcome: 'ok', written, appearances, unmatched, skipped_bench: skippedBench };
}

// syncRecentFinalsPlayerStats() -> { synced, matches } — the going-forward
// sweep for poll-live. Ingests any WC final in the last 72h that either lacks
// player_match_stats rows OR was last synced within 26h of kickoff (~24h after
// the final whistle) — the provider-correction re-sync. The WHERE returns
// nothing (a cheap no-op) when no recent final qualifies.
export async function syncRecentFinalsPlayerStats({ leagueSlug = WC_LEAGUE_SLUG } = {}) {
  const due = await sql`
    SELECT m.id
      FROM matches m
      JOIN leagues lg ON lg.id = m.league_id
     WHERE lg.slug = ${leagueSlug}
       AND m.status = 'final'
       AND m.kickoff_at >= now() - interval '72 hours'
       AND (
         NOT EXISTS (SELECT 1 FROM player_match_stats p WHERE p.match_id = m.id)
         OR (SELECT max(p.data_provider_synced_at) FROM player_match_stats p WHERE p.match_id = m.id)
            < m.kickoff_at + interval '26 hours'
       )
     ORDER BY m.kickoff_at DESC
  `;
  let synced = 0;
  for (const r of due) {
    const res = await syncPlayerStatsForMatch(r.id);
    if (res.outcome === 'ok') synced += 1;
  }
  return { synced, matches: due.length };
}
