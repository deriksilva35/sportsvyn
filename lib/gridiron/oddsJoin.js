/**
 * lib/gridiron/oddsJoin.js — resolve The Odds API events to our gridiron matches.
 *
 * Two paths, in order:
 *   1. Primary (steady state): matches.external_ids->>'odds_api_event' == event.id.
 *      Once captured, no name-matching ever runs for that game again.
 *   2. First contact: resolve home + away team names to team_ids, then confirm a
 *      scheduled match for that exact pair whose kickoff_at is within 30 min of
 *      the event commence_time. On success, WRITE the event id into external_ids
 *      (jsonb merge — never clobbers bdl_game_id / cfbd_game_id) so future ticks
 *      take path 1.
 *
 * Name resolution (first contact only):
 *   - NFL: exact normalized match. teams.name is the BDL full name
 *     ("Arizona Cardinals") == The Odds API NFL naming.
 *   - CFB: our teams.name is the school only ("Alabama"); The Odds API sends
 *     "School Mascot" ("Alabama Crimson Tide"). Match by prefix (our normalized
 *     name is a whole-word prefix of the event name), longest-prefix wins, with an
 *     OVERRIDES map for stragglers. Unmatched events are reported in the run
 *     summary (counts + sample) so the override map grows from sync_runs — the
 *     same FFC name-match discipline used for the sim pool.
 *
 * Only status='scheduled' matches are join targets: post-kickoff events are
 * ignored, which is freeze-at-kickoff by construction (no odds row is ever
 * written or moved once a game starts).
 */

import { normalizeName } from './nameMatch.js';
import { toUtc } from './ingest.js';

// CFB stragglers where the school-name prefix rule does not resolve (ambiguous
// shared prefixes, alternate vendor spellings, non-FBS naming). Keyed by the
// NORMALIZED Odds API event name; value is our teams.name. Grown from the
// unmatchedEvents sample reported into sync_runs. Start empty; add as observed.
export const CFB_TEAM_OVERRIDES = {
  'umass minutemen': 'Massachusetts', // our CFBD name is "Massachusetts"
  // 'miami oh redhawks': 'Miami (OH)',
  // 'louisiana ragin cajuns': 'Louisiana',
};

// First-contact time tolerance between an event's commence_time and a scheduled
// match's kickoff_at. NFL kickoffs are real (BDL sends the datetime string), so
// the exact window holds. CFB is wide: ~half the schedule carries a midnight-ET
// TBD placeholder kickoff (CFBD hasn't flexed the slot) that sits hours from the
// book's real commence_time — but a team-pair is unique within ~1.5 days (any
// rematch is weeks away), so the pair carries the match and the window only has
// to bracket the placeholder-vs-real gap. Once bound, the event id is captured
// and the window never applies to that game again.
const NFL_JOIN_WINDOW_MS = 30 * 60 * 1000;
const CFB_JOIN_WINDOW_MS = 36 * 60 * 60 * 1000;

// Resolve one Odds API team name -> our team_id, or null.
// teamsByNorm: Map(normalizedTeamName -> id). teamNormsDesc: team norms sorted
// longest-first (so the most specific prefix wins for CFB).
export function resolveTeamId(sport, oddsName, teamsByNorm, teamNormsDesc) {
  const norm = normalizeName(oddsName);
  if (!norm) return null;
  if (teamsByNorm.has(norm)) return teamsByNorm.get(norm); // exact (NFL + CFB exacts)
  if (sport !== 'cfb') return null; // NFL is exact-only

  const override = CFB_TEAM_OVERRIDES[norm];
  if (override) {
    const id = teamsByNorm.get(normalizeName(override));
    if (id != null) return id;
  }
  // Longest whole-word prefix: our "alabama" is a prefix of "alabama crimson tide".
  for (const tnorm of teamNormsDesc) {
    if (norm === tnorm || norm.startsWith(`${tnorm} `)) return teamsByNorm.get(tnorm);
  }
  return null;
}

// joinEventsToMatches(sql, { leagueSlug, sport, events })
//   -> { matched: [{ event, matchId }], unmatched: [{ id, home, away, commence }],
//        stats: { events, matched, unmatched, captured } }
// `captured` counts first-contact event-id writes performed this run.
export async function joinEventsToMatches(sql, { leagueSlug, sport, events }) {
  const evs = Array.isArray(events) ? events : [];
  const empty = { matched: [], unmatched: [], stats: { events: evs.length, matched: 0, unmatched: evs.length, captured: 0 } };

  const leagueRow = (await sql`SELECT id FROM leagues WHERE slug = ${leagueSlug} LIMIT 1`)[0];
  if (!leagueRow) return empty;
  const leagueId = leagueRow.id;

  const teamRows = await sql`SELECT id, name FROM teams WHERE league_id = ${leagueId}`;
  const teamsByNorm = new Map();
  for (const t of teamRows) teamsByNorm.set(normalizeName(t.name), t.id);
  const teamNormsDesc = [...teamsByNorm.keys()].sort((a, b) => b.length - a.length);

  // Scheduled matches only (freeze-at-kickoff). A tiny lookback tolerates clock
  // skew right at kickoff without pulling in live/final games.
  const matchRows = await sql`
    SELECT id, home_team_id, away_team_id, kickoff_at, external_ids
    FROM matches
    WHERE league_id = ${leagueId}
      AND status = 'scheduled'
      AND kickoff_at >= now() - interval '2 hours'`;

  const byEventId = new Map();
  const byPair = new Map(); // pairKey -> [match, ...] (a pair can recur: rematch)
  for (const m of matchRows) {
    const evId = m.external_ids?.odds_api_event;
    if (evId != null) byEventId.set(String(evId), m);
    const key = `${m.home_team_id}|${m.away_team_id}`;
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(m);
  }

  const windowMs = sport === 'cfb' ? CFB_JOIN_WINDOW_MS : NFL_JOIN_WINDOW_MS;
  const matched = [];
  const unmatched = [];
  let captured = 0;

  for (const e of evs) {
    // Path 1 — primary: event id already captured on the match.
    const primary = byEventId.get(String(e.id));
    if (primary) {
      matched.push({ event: e, matchId: primary.id });
      continue;
    }
    // Path 2 — first contact: resolve the pair, then the closest scheduled match
    // within the sport window (a rematch weeks away stays out of the window).
    const homeId = resolveTeamId(sport, e.home_team, teamsByNorm, teamNormsDesc);
    const awayId = resolveTeamId(sport, e.away_team, teamsByNorm, teamNormsDesc);
    const cands = homeId && awayId ? (byPair.get(`${homeId}|${awayId}`) ?? []) : [];
    if (cands.length) {
      const commenceIso = await toUtc(e.commence_time, null, 'oddsapi');
      const commMs = commenceIso ? new Date(commenceIso).getTime() : NaN;
      if (Number.isFinite(commMs)) {
        let best = null;
        let bestDiff = Infinity;
        for (const c of cands) {
          const diff = Math.abs(new Date(c.kickoff_at).getTime() - commMs);
          if (diff <= windowMs && diff < bestDiff) { best = c; bestDiff = diff; }
        }
        if (best) {
          // Capture the event id (jsonb merge, never clobbers existing keys).
          await sql`
            UPDATE matches
            SET external_ids = COALESCE(external_ids, '{}'::jsonb) || ${JSON.stringify({ odds_api_event: e.id })}::jsonb
            WHERE id = ${best.id}`;
          captured += 1;
          matched.push({ event: e, matchId: best.id });
          continue;
        }
      }
    }
    unmatched.push({ id: e.id, home: e.home_team, away: e.away_team, commence: e.commence_time });
  }

  return {
    matched,
    unmatched,
    stats: { events: evs.length, matched: matched.length, unmatched: unmatched.length, captured },
  };
}
