/**
 * lib/soccer/playerStatsImport.js — EPL per-player match stats (API-Sports).
 *
 * ONE SURFACE, ONE SOURCE — AND THIS IS THE OTHER SOURCE. EPL PLAYER STATS
 * come from API-Sports (v3.football, the x-apisports-key account). EPL PRICES
 * come from The Odds API and live in odds_markets behind fetcher_version
 * 'odds-api-v4'. Both vendors cover the same league; NOTHING here ever reads a
 * price and nothing in lib/market/ ever reads these rows. Two feeds, two
 * tables, never averaged and never joined into one number.
 *
 * THE VOCABULARY WAS ENUMERATED OFF A LIVE PAYLOAD BEFORE ANY MAPPING, and it
 * had to be: the shape is NESTED and two of its keys sit where nobody would
 * guess.
 *
 *   assists       lives under goals.assists,        NOT at the top level
 *   interceptions lives under tackles.interceptions, NOT at the top level
 *
 * Reading either from where it "should" be yields undefined, which becomes
 * NULL, which looks exactly like a player who recorded none. That is the
 * silent-wrong-answer failure this whole codebase keeps meeting, so the map
 * below is transcribed from a real Fulham-Chelsea payload rather than from the
 * column names it feeds.
 *
 * WHAT THE PROVIDER DOES NOT SEND. player_match_stats is a World Cup era table
 * and is WIDER than this payload: xg, xa, passes_completed, progressive_carries,
 * clearances, goal_minutes, goal_types, came_on/off_at_minute have no source
 * here and are left NULL rather than derived. passes.accuracy is a PERCENTAGE
 * STRING, not a completed count, and is deliberately not squeezed into
 * passes_completed - a computed count would be a number we invented.
 *
 * NO MIGRATION NEEDED: every field the provider does send has a column already.
 *
 * COMPLETED MATCHES ONLY, and never a per-minute poll. Stats are final when the
 * match is; the cron rides the post-final window like the other settle-shaped
 * jobs rather than watching a game it cannot change.
 */

import { normalizeName } from '../gridiron/nameMatch.js';

const HOST = 'https://v3.football.api-sports.io';

/** One fixture's player rows. 1 request per fixture on the 75K/mo account. */
export async function fetchFixturePlayers(fixtureId) {
  const res = await fetch(`${HOST}/fixtures/players?fixture=${fixtureId}`, {
    headers: { 'x-apisports-key': process.env.API_SPORTS_KEY },
  });
  const budget = {
    requests_remaining: res.headers.get('x-ratelimit-requests-remaining'),
    requests_limit: res.headers.get('x-ratelimit-requests-limit'),
  };
  if (!res.ok) {
    const err = new Error(`API-Sports ${res.status} on fixture ${fixtureId}`);
    err.budget = budget;
    throw err;
  }
  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length) {
    const err = new Error(`API-Sports errors on fixture ${fixtureId}: ${JSON.stringify(json.errors)}`);
    err.budget = budget;
    throw err;
  }
  return { teams: json.response ?? [], budget };
}

const num = (v) => (v == null || v === '' ? null : Number(v));

/**
 * SIX COLUMNS ARE NOT NULL, AND THE SCHEMA ALREADY SAID WHAT THEIR ZERO IS.
 *
 * player_match_stats declares started/minutes_played/goals/assists/
 * yellow_cards/red_cards NOT NULL with defaults of false/0. The provider sends
 * null for "did not score" rather than 0, so a straight pass-through violates
 * the constraint - which it did, on the first DEV run, before any PROD row was
 * touched. That is the DEV-first ordering earning its place.
 *
 * THIS IS NOT THE SAME AS INVENTING DATA, and the distinction is the whole
 * point. Coercion happens ONLY where the table itself defines the zero value.
 * Every nullable column - shots, tackles, interceptions, saves, xg - keeps its
 * NULL when the provider omits it, because for those "absent" and "zero" are
 * different claims and the schema left room to say so. A goalkeeper with null
 * shots did not take zero shots; he was never measured for it.
 */
const zeroIfNull = (v) => (v == null || v === '' ? 0 : Number(v));

/**
 * THE MAP. Transcribed from a live payload, key by key. Every line here is a
 * fact about the provider's JSON, not a guess from a column name.
 */
export function mapStatLine(st) {
  if (!st) return null;
  return {
    minutes_played: zeroIfNull(st.games?.minutes),
    // `substitute: false` means they were in the XI. The provider has no
    // "started" flag of its own.
    started: st.games?.substitute == null ? false : !st.games.substitute,
    match_rating: num(st.games?.rating),
    goals: zeroIfNull(st.goals?.total),
    // NESTED UNDER goals. This is the one that would have silently read zero.
    assists: zeroIfNull(st.goals?.assists),
    goals_conceded: num(st.goals?.conceded),
    saves: num(st.goals?.saves),
    shots: num(st.shots?.total),
    shots_on_target: num(st.shots?.on),
    passes_attempted: num(st.passes?.total),
    key_passes: num(st.passes?.key),
    tackles: num(st.tackles?.total),
    // NESTED UNDER tackles, for the same reason.
    interceptions: num(st.tackles?.interceptions),
    blocks: num(st.tackles?.blocks),
    duels_total: num(st.duels?.total),
    duels_won: num(st.duels?.won),
    fouls_committed: num(st.fouls?.committed),
    fouls_drawn: num(st.fouls?.drawn),
    yellow_cards: zeroIfNull(st.cards?.yellow),
    red_cards: zeroIfNull(st.cards?.red),
  };
}

/**
 * IDEMPOTENT BY (player_id, match_id), and the counts are split.
 *
 * "Upserted 400" tells you nothing about whether a backfill re-ran or a
 * provider correction landed. Inserts and updates are counted separately so a
 * second run over the same matchweek reads as 0 inserted / N updated, which is
 * the signature of a healthy re-run rather than of a duplicate import.
 */
async function upsertRow(sql, { playerId, matchId, teamId, stats }) {
  const existing = await sql`
    SELECT id FROM player_match_stats
     WHERE player_id = ${playerId} AND match_id = ${matchId} LIMIT 1`;
  if (existing.length) {
    await sql`
      UPDATE player_match_stats SET
        team_id = ${teamId}, started = ${stats.started},
        minutes_played = ${stats.minutes_played}, goals = ${stats.goals},
        assists = ${stats.assists}, shots = ${stats.shots},
        shots_on_target = ${stats.shots_on_target},
        passes_attempted = ${stats.passes_attempted}, key_passes = ${stats.key_passes},
        tackles = ${stats.tackles}, interceptions = ${stats.interceptions},
        blocks = ${stats.blocks}, duels_won = ${stats.duels_won},
        duels_total = ${stats.duels_total}, saves = ${stats.saves},
        goals_conceded = ${stats.goals_conceded},
        yellow_cards = ${stats.yellow_cards}, red_cards = ${stats.red_cards},
        fouls_committed = ${stats.fouls_committed}, fouls_drawn = ${stats.fouls_drawn},
        match_rating = ${stats.match_rating}, rating_source = 'api-sports',
        data_provider_synced_at = now(), updated_at = now()
       WHERE id = ${existing[0].id}`;
    return 'updated';
  }
  await sql`
    INSERT INTO player_match_stats (
      player_id, match_id, team_id, started, minutes_played, goals, assists,
      shots, shots_on_target, passes_attempted, key_passes, tackles,
      interceptions, blocks, duels_won, duels_total, saves, goals_conceded,
      yellow_cards, red_cards, fouls_committed, fouls_drawn, match_rating,
      rating_source, data_provider_synced_at
    ) VALUES (
      ${playerId}, ${matchId}, ${teamId}, ${stats.started}, ${stats.minutes_played},
      ${stats.goals}, ${stats.assists}, ${stats.shots}, ${stats.shots_on_target},
      ${stats.passes_attempted}, ${stats.key_passes}, ${stats.tackles},
      ${stats.interceptions}, ${stats.blocks}, ${stats.duels_won}, ${stats.duels_total},
      ${stats.saves}, ${stats.goals_conceded}, ${stats.yellow_cards}, ${stats.red_cards},
      ${stats.fouls_committed}, ${stats.fouls_drawn}, ${stats.match_rating},
      'api-sports', now()
    )`;
  return 'inserted';
}

/**
 * COMPLETED EPL MATCHES that carry a provider fixture id and have not been
 * imported yet (or are being re-run deliberately).
 */
export async function statsScope(sql, { limit = 40, matchIds = null } = {}) {
  if (matchIds) {
    return sql`
      SELECT m.id, m.slug, m.external_ids, m.home_team_id, m.away_team_id
        FROM matches m JOIN leagues l ON l.id = m.league_id
       WHERE l.slug = 'epl' AND m.status = 'final'
         AND m.external_ids->>'api_sports' IS NOT NULL
         AND m.id = ANY(${matchIds})
       ORDER BY m.kickoff_at`;
  }
  return sql`
    SELECT m.id, m.slug, m.external_ids, m.home_team_id, m.away_team_id
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = 'epl' AND m.status = 'final'
       AND m.external_ids->>'api_sports' IS NOT NULL
     ORDER BY m.kickoff_at DESC
     LIMIT ${limit}`;
}

/**
 * PLAYERS ARE MATCHED BY PROVIDER ID FIRST, name second.
 *
 * squadImport writes players.external_ids->>'api_sports', so the id path is
 * exact and is tried first. The name fallback exists for squads imported before
 * that field was populated; a player who resolves by neither is COUNTED, never
 * silently dropped - an unmatched scorer is the difference between "this player
 * had a quiet game" and "we never looked".
 */
async function buildPlayerIndex(sql, teamIds) {
  const rows = await sql`
    SELECT id, full_name, external_ids FROM players
     WHERE current_team_id = ANY(${teamIds})`;
  const byProvider = new Map();
  const byName = new Map();
  for (const r of rows) {
    const ext = r.external_ids?.api_sports;
    if (ext != null) byProvider.set(String(ext), r.id);
    byName.set(normalizeName(r.full_name ?? ''), r.id);
  }
  return { byProvider, byName };
}

export async function importEplPlayerStats(sql, { limit = 40, matchIds = null } = {}) {
  const scope = await statsScope(sql, { limit, matchIds });
  let inserted = 0;
  let updated = 0;
  let fixtures = 0;
  let unmatchedPlayers = 0;
  const unmatchedSample = [];
  let budget = null;

  for (const m of scope) {
    const fixtureId = m.external_ids?.api_sports;
    if (!fixtureId) continue;
    const { teams, budget: b } = await fetchFixturePlayers(fixtureId);
    budget = b ?? budget;
    if (!teams.length) continue;
    fixtures += 1;

    const index = await buildPlayerIndex(sql, [m.home_team_id, m.away_team_id].filter((v) => v != null));

    // THE SIDE COMES FROM THE PAYLOAD'S OWN GROUPING, not from re-resolving a
    // club name. Each entry in `teams` IS one side of this match, and we
    // already hold both ids - so the only question is which. Provider team id
    // first; failing that, the order the payload uses (home, away), which is
    // the provider's documented order and is checked against our two ids
    // rather than trusted blindly.
    for (const [ti, t] of teams.entries()) {
      const provTeamId = t.team?.id == null ? null : String(t.team.id);
      const known = await sql`
        SELECT id FROM teams
         WHERE id = ANY(${[m.home_team_id, m.away_team_id].filter((v) => v != null)})
           AND external_ids->>'api_sports' = ${provTeamId}
         LIMIT 1`;
      const teamId = known[0]?.id
        ?? (ti === 0 ? m.home_team_id : m.away_team_id)
        ?? null;
      for (const entry of t.players ?? []) {
        const st = entry.statistics?.[0];
        const stats = mapStatLine(st);
        if (!stats) continue;
        const pid = index.byProvider.get(String(entry.player?.id))
          ?? index.byName.get(normalizeName(entry.player?.name ?? ''));
        if (pid == null) {
          unmatchedPlayers += 1;
          if (unmatchedSample.length < 8) unmatchedSample.push(entry.player?.name ?? '?');
          continue;
        }
        const outcome = await upsertRow(sql, {
          playerId: pid, matchId: m.id, teamId, stats,
        });
        if (outcome === 'inserted') inserted += 1; else updated += 1;
      }
    }
  }

  return {
    scoped: scope.length,
    fixtures,
    inserted,
    updated,
    unmatchedPlayers,
    unmatchedSample,
    budget,
  };
}
