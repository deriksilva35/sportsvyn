// lib/bracket.js: group-stage reads, shared by structural bracket pages
// (the namespaced /world-cup-2026/bracket and the homepage bracket wall)
// plus the /my dashboard.
//
// Read-only. Every exported async reader takes a leagueSlug argument
// with a default of 'fifa-wc-2026' so existing zero-arg call sites
// (lib/dashboard.js, app/page.js, the legacy /bracket route) keep
// working unchanged while the namespaced routes pass the slug
// explicitly via the competition resolver. The default is acceptable
// temporary debt and should be revisited in the post-tournament slug
// cleanup.

import { sql } from './db.js';

export const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

const WC_LEAGUE_SLUG = 'fifa-wc-2026';

// Returns Map<group_letter, [{ id, name, slug, flag_svg_path }, ...]>.
// Pulled from matches.home_team_id ∪ matches.away_team_id where
// stage='group' AND group_code IS NOT NULL — so a team appears in
// whichever group its WC fixtures bind it to (no separate
// team→group join table in the schema).
export async function getGroupTeams(leagueSlug = WC_LEAGUE_SLUG) {
  const rows = await sql`
    WITH wc_league AS (
      SELECT id FROM leagues WHERE slug = ${leagueSlug} LIMIT 1
    ),
    wc_group_teams AS (
      SELECT m.group_code, m.home_team_id AS team_id
        FROM matches m, wc_league
       WHERE m.league_id = wc_league.id AND m.stage = 'group' AND m.group_code IS NOT NULL
      UNION
      SELECT m.group_code, m.away_team_id AS team_id
        FROM matches m, wc_league
       WHERE m.league_id = wc_league.id AND m.stage = 'group' AND m.group_code IS NOT NULL
    )
    SELECT
      wgt.group_code,
      t.id, t.name, t.slug, t.flag_svg_path
    FROM wc_group_teams wgt
    JOIN teams t ON t.id = wgt.team_id
    ORDER BY wgt.group_code, t.name
  `;
  const byLetter = new Map();
  for (const r of rows) {
    if (!byLetter.has(r.group_code)) byLetter.set(r.group_code, []);
    byLetter.get(r.group_code).push(r);
  }
  return byLetter;
}

// Returns Map<group_letter, matchdays_complete> where matchdays_complete
// = floor(finals_in_group / 2). Each group plays 2 simultaneous matches
// per matchday (4 teams = 2 pairings), so 2 finals = 1 matchday done.
export async function getGroupMatchdayProgress(leagueSlug = WC_LEAGUE_SLUG) {
  const rows = await sql`
    SELECT
      group_code,
      count(*) FILTER (WHERE status = 'final')::int AS finals
    FROM matches
    WHERE league_id = (SELECT id FROM leagues WHERE slug = ${leagueSlug})
      AND stage = 'group'
      AND group_code IS NOT NULL
    GROUP BY group_code
  `;
  const byLetter = new Map();
  for (const r of rows) byLetter.set(r.group_code, Math.floor(r.finals / 2));
  return byLetter;
}

// Boolean: have all 72 (12 groups × 6) group-stage matches concluded?
// Strict equality on 72: a partial seed (e.g. dev env with <72 fixtures)
// can't false-trigger this.
export async function getGroupStageComplete(leagueSlug = WC_LEAGUE_SLUG) {
  const rows = await sql`
    SELECT count(*)::int AS final_count
    FROM matches
    WHERE league_id = (SELECT id FROM leagues WHERE slug = ${leagueSlug})
      AND stage = 'group'
      AND status = 'final'
  `;
  return rows[0]?.final_count === 72;
}

// =============================================================================
// orderGroup(teams, matches) — PURE function. No DB, no I/O.
//
// Inputs:
//   teams   : [{ id, name, slug, flag_svg_path }]  (the 4 teams in one group)
//   matches : [{ home_team_id, away_team_id, home_score, away_score }]
//             — all FINAL matches between those teams (status='final' upstream
//             of this call). Caller filters; this function trusts.
//
// Returns: ordered array of standing rows
//   [{ team_id, name, slug, flag_svg_path, played, wins, draws, losses,
//      gf, ga, gd, points }]
// Position is array index.
//
// Sort sequence (FIFA group-stage tiebreakers, faithful through the head-
// to-head mini-table; fair-play points + drawing of lots are the real next
// steps and are NOT implemented — deferred):
//
//   PHASE 1 (over the full group):
//     a. points        desc
//     b. goal diff     desc
//     c. goals for     desc
//
//   PHASE 2 (only the subset still tied after phase 1 — a mini-table built
//   from ONLY the matches played between those tied teams):
//     d. mini-table points     desc
//     e. mini-table goal diff  desc
//     f. mini-table goals for  desc
//
//   Final tiebreaker: alphabetical by team name, so render order is stable
//   across requests when even phase 2 can't separate (perfect rock-paper-
//   scissors). FIFA's real continuation is fair-play points → drawing of
//   lots; both deferred.
//
// Phase 2 is a recompute on the cluster, NOT a global head-to-head sort.
// A 3-way phase-1 tie becomes a 3-team mini-table; a 2-way tie becomes
// the 1 match between them.
// =============================================================================
export function orderGroup(teams, matches) {
  // 1. Per-team overall stats (every team in the group, defaulting to zeros).
  const statsByTeam = new Map();
  for (const t of teams) {
    statsByTeam.set(t.id, {
      team_id: t.id,
      name: t.name,
      slug: t.slug,
      flag_svg_path: t.flag_svg_path,
      played: 0, wins: 0, draws: 0, losses: 0,
      gf: 0, ga: 0, gd: 0, points: 0,
    });
  }
  for (const m of matches) {
    const home = statsByTeam.get(m.home_team_id);
    const away = statsByTeam.get(m.away_team_id);
    if (!home || !away) continue; // skip cross-group leakage defensively
    const hs = m.home_score ?? 0;
    const as = m.away_score ?? 0;
    home.played++; away.played++;
    home.gf += hs; home.ga += as;
    away.gf += as; away.ga += hs;
    if (hs > as)      { home.wins++;  home.points += 3; away.losses++; }
    else if (hs < as) { away.wins++;  away.points += 3; home.losses++; }
    else              { home.draws++; home.points += 1; away.draws++; away.points += 1; }
  }
  for (const t of statsByTeam.values()) t.gd = t.gf - t.ga;

  // 2. Phase 1 sort.
  const standings = [...statsByTeam.values()].sort((a, b) => {
    if (a.points !== b.points) return b.points - a.points;
    if (a.gd     !== b.gd)     return b.gd     - a.gd;
    if (a.gf     !== b.gf)     return b.gf     - a.gf;
    return a.name.localeCompare(b.name);
  });

  // 3. Cluster scan: any run of rows identical on (points, gd, gf) is still
  //    tied after phase 1 and goes through phase 2.
  let i = 0;
  while (i < standings.length) {
    let j = i + 1;
    while (
      j < standings.length &&
      standings[j].points === standings[i].points &&
      standings[j].gd     === standings[i].gd &&
      standings[j].gf     === standings[i].gf
    ) j++;

    if (j - i > 1) {
      const cluster = standings.slice(i, j);
      const clusterIds = new Set(cluster.map((t) => t.team_id));

      // Mini-table: only matches where BOTH teams are in the cluster.
      const mini = new Map();
      for (const t of cluster) {
        mini.set(t.team_id, { team_id: t.team_id, points: 0, gf: 0, ga: 0, gd: 0 });
      }
      for (const m of matches) {
        if (!clusterIds.has(m.home_team_id) || !clusterIds.has(m.away_team_id)) continue;
        const h = mini.get(m.home_team_id);
        const a = mini.get(m.away_team_id);
        const hs = m.home_score ?? 0;
        const as = m.away_score ?? 0;
        h.gf += hs; h.ga += as;
        a.gf += as; a.ga += hs;
        if (hs > as)      { h.points += 3; }
        else if (hs < as) { a.points += 3; }
        else              { h.points += 1; a.points += 1; }
      }
      for (const s of mini.values()) s.gd = s.gf - s.ga;

      cluster.sort((a, b) => {
        const ax = mini.get(a.team_id);
        const bx = mini.get(b.team_id);
        if (ax.points !== bx.points) return bx.points - ax.points;
        if (ax.gd     !== bx.gd)     return bx.gd     - ax.gd;
        if (ax.gf     !== bx.gf)     return bx.gf     - ax.gf;
        return a.name.localeCompare(b.name);
      });

      for (let k = 0; k < cluster.length; k++) standings[i + k] = cluster[k];
    }
    i = j;
  }

  return standings;
}

// =============================================================================
// getKnockoutBracket(leagueSlug) -- DB-bound. Returns Map<match_number, row>
// for the 32 seeded knockout-stage matches (R32 -> R16 -> QF -> SF -> 3rd ->
// Final). Each row carries the resolved team (when home/away_team_id is set)
// or a slot label (e.g. "1D" / "3rd B/E/F/I/J" / "W73") when the slot has
// not yet been filled by the resolver.
//
// Reads matches WHERE stage IN (round_of_32, round_of_16, quarter, semi,
// third_place, final). Sort key is metadata.match_number (the canonical
// 73..104 bracket order). Returns empty Map if nothing seeded yet.
// =============================================================================
export async function getKnockoutBracket(leagueSlug = WC_LEAGUE_SLUG) {
  const rows = await sql`
    SELECT m.id AS match_id, m.stage, m.kickoff_at, m.venue, m.status,
           m.home_team_id, m.away_team_id, m.home_score, m.away_score,
           m.metadata,
           ht.name AS home_name, ht.slug AS home_slug, ht.flag_svg_path AS home_flag,
           at.name AS away_name, at.slug AS away_slug, at.flag_svg_path AS away_flag
      FROM matches m
      JOIN leagues lg ON lg.id = m.league_id
      LEFT JOIN teams ht ON ht.id = m.home_team_id
      LEFT JOIN teams at ON at.id = m.away_team_id
     WHERE lg.slug = ${leagueSlug}
       AND m.stage IN ('round_of_32','round_of_16','quarter','semi','third_place','final')
     ORDER BY (m.metadata->>'match_number')::int
  `;
  const byMatchNumber = new Map();
  for (const r of rows) {
    const mn = r.metadata?.match_number;
    if (mn == null) continue;
    byMatchNumber.set(mn, {
      match_number: mn,
      match_id: r.match_id,
      stage: r.stage,
      kickoff_at: r.kickoff_at,
      venue: r.venue,
      status: r.status,
      home_score: r.home_score,
      away_score: r.away_score,
      home: r.home_team_id
        ? { resolved: true, team_id: r.home_team_id, name: r.home_name, slug: r.home_slug, flag_svg_path: r.home_flag }
        : { resolved: false, label: r.metadata?.slot_home?.label ?? 'TBD' },
      away: r.away_team_id
        ? { resolved: true, team_id: r.away_team_id, name: r.away_name, slug: r.away_slug, flag_svg_path: r.away_flag }
        : { resolved: false, label: r.metadata?.slot_away?.label ?? 'TBD' },
      slot_home: r.metadata?.slot_home ?? null,
      slot_away: r.metadata?.slot_away ?? null,
      feeds_match: r.metadata?.feeds_match ?? null,
      round_label: r.metadata?.round_label ?? null,
    });
  }
  return byMatchNumber;
}

// =============================================================================
// computeAdvancement(allGroupStandings) — PURE function. No DB, no I/O.
//
// Input:  Map<group_letter, ordered_standings[]>  (getGroupStandings's output)
// Output: Map<team_id, 'through' | 'in_hunt' | 'third_watch' | 'out'>
//
// Per-team math is exact within the group (no enumeration needed; analytical
// counts of "permanently above" and "could-outpoint" cover every case). The
// cross-group best-thirds comparison is intentionally NOT computed — teams
// who can finish 3rd in their group are tagged 'third_watch', acknowledging
// that their advancement depends on results in other groups. The conservative
// default is the cardinal rule: ties and ambiguity always favor the SAFER
// (less-certain) state. We never claim 'through' or 'out' without proof.
//
// Per-team derivation (assumes WC group of 4 teams × 3 matches):
//   T.points    = current points
//   T.played    = matches already final
//   T.remaining = 3 - T.played
//   T.max       = T.points + 3 * T.remaining       (best case if T wins all remaining)
//   T.min       = T.points                          (worst case if T loses all remaining)
//
// For each OTHER team Q in the same group, count:
//   could_outpoint_T = (Q.max >= T.points)
//     -- Q could finish with >= T's FLOOR points; with ties, conservative
//        treats this as "Q could rank above T."
//   permanently_above_T = (Q.points > T.max)
//     -- Q's CURRENT points already exceed T's BEST possible final points.
//        T can never catch Q regardless of remaining results.
//
// States (evaluated top-down; first match wins):
//   through:      |{Q : Q.max >= T.points}| <= 1
//                 -- at most 1 other team could even theoretically outpoint T.
//                    T is locked into top-2 across every realizable scenario.
//   in_hunt:      NOT through AND |{Q : Q.points > T.max}| <= 1
//                 -- T can still mathematically reach top-2 (at most 1 team
//                    is permanently locked above T).
//   third_watch:  NOT through AND NOT in_hunt
//                 AND |{Q : Q.points > T.max}| == 2
//                 -- exactly 2 teams permanently above T; T can finish 3rd
//                    (or 4th, if the 4th team passes T). Honest "depends on
//                    other groups" state.
//   out:          |{Q : Q.points > T.max}| == 3
//                 -- all 3 other teams permanently above T. T must finish 4th.
//
// These four conditions are mutually exclusive given the "first match wins"
// order, and they cover every reachable case (the in_hunt / third_watch /
// out cascade partitions on the permanently-above count: 0-1 / 2 / 3).
// =============================================================================
export function computeAdvancement(allGroupStandings, remainingFixturesByGroup = new Map()) {
  const status = new Map();
  for (const [groupLetter, teams] of allGroupStandings) {
    if (!teams || teams.length === 0) continue;
    const remaining = remainingFixturesByGroup.get(groupLetter) ?? [];

    for (const T of teams) {
      // -----------------------------------------------------------------
      // 'through' (fixture-aware, exact). T is through iff T finishes
      // top-2 in EVERY fixture-respecting scenario of remaining results.
      // We enumerate every combination of outcomes (H-win / draw / A-win)
      // across the remaining matches and verify T is top-2 in each.
      //
      // Naturally accounts for shared-fixture exclusivity: two chasers
      // that play each other cannot both win, so scenarios that would
      // need both to win simply do not exist in the enumeration.
      //
      // Within a scenario the win/draw/loss outcomes are fixed, but
      // margins are unbounded. A chaser tied with T on points can
      // overtake T on GD iff the chaser has any win in the scenario
      // (can pick arbitrarily large margin) OR T has any loss in the
      // scenario (T's GD drops arbitrarily) -- both are realistic
      // un-bounded GD-swing avenues. Pure-draw chasers fall back to
      // current GD/GF comparison (no swing).
      // -----------------------------------------------------------------
      const through = (remaining.length === 0)
        ? topTwoInLockedState(T, teams)
        : enumerateAndCheckTopTwo(T, teams, remaining);

      // -----------------------------------------------------------------
      // Lower states (in_hunt / third_watch / out) keep the existing
      // points-only logic. permanentlyAbove counts chasers whose current
      // points already exceed T's BEST possible final points. T can
      // never catch them on points.
      // -----------------------------------------------------------------
      const tMaxPts = T.points + 3 * (3 - (T.played ?? 0));
      let permanentlyAbove = 0;
      for (const Q of teams) {
        if (Q.team_id === T.team_id) continue;
        if (Q.points > tMaxPts) permanentlyAbove++;
      }

      let s;
      if (through)                       s = 'through';
      else if (permanentlyAbove <= 1)    s = 'in_hunt';
      else if (permanentlyAbove === 2)   s = 'third_watch';
      else /* permanentlyAbove === 3 */  s = 'out';
      status.set(T.team_id, s);
    }
  }
  return status;
}

// When the group has no remaining games, every team is locked. T is top-2
// iff at most 1 other team strictly outranks T on (pts, gd, gf, alpha).
function topTwoInLockedState(T, teams) {
  let above = 0;
  for (const Q of teams) {
    if (Q.team_id === T.team_id) continue;
    if (Q.points  > T.points)  { above++; continue; }
    if (Q.points  < T.points)  continue;
    if (Q.gd      > T.gd)      { above++; continue; }
    if (Q.gd      < T.gd)      continue;
    if (Q.gf      > T.gf)      { above++; continue; }
    if (Q.gf      < T.gf)      continue;
    // exact tie -> alpha breaker is deterministic but tied teams within
    // top-2 still both advance, so we don't count as "above" here.
  }
  return above <= 1;
}

// Enumerate 3^N outcome combos across remaining group fixtures and verify
// T finishes top-2 in every one. N <= 4 in WC group stage (6 matches max
// per group, so at most ~4 still-pending = 81 combos -- trivial cost).
function enumerateAndCheckTopTwo(T, teams, remaining) {
  const OUTCOMES = ['H', 'D', 'A'];
  const n = remaining.length;
  const total = 3 ** n;
  for (let s = 0; s < total; s++) {
    const scenario = [];
    let k = s;
    for (let i = 0; i < n; i++) {
      scenario.push(OUTCOMES[k % 3]);
      k = Math.floor(k / 3);
    }
    if (!isTopTwoInScenario(T, teams, remaining, scenario)) return false;
  }
  return true;
}

// Apply scenario outcomes; check if T is top-2 in worst-case margin
// assignment WITHIN that scenario (unbounded margins on wins/losses).
function isTopTwoInScenario(T, teams, remaining, scenario) {
  const stats = new Map();
  for (const t of teams) {
    stats.set(t.team_id, {
      team_id: t.team_id, name: t.name,
      points: t.points, gd: t.gd, gf: t.gf,
      hasWinInScenario: false, hasLossInScenario: false,
    });
  }
  for (let i = 0; i < remaining.length; i++) {
    const fix = remaining[i];
    const out = scenario[i];
    const h = stats.get(fix.home_id);
    const a = stats.get(fix.away_id);
    if (!h || !a) continue;
    if (out === 'H') {
      h.points += 3; h.hasWinInScenario  = true;
                     a.hasLossInScenario = true;
    } else if (out === 'A') {
      a.points += 3; a.hasWinInScenario  = true;
                     h.hasLossInScenario = true;
    } else {
      h.points += 1; a.points += 1;
    }
  }
  const tStats = stats.get(T.team_id);
  let aboveT = 0;
  for (const [tid, q] of stats) {
    if (tid === T.team_id) continue;
    if (q.points > tStats.points) { aboveT++; continue; }
    if (q.points < tStats.points) continue;
    // tied on points -- can q beat T on GD with unbounded margin?
    if (q.hasWinInScenario || tStats.hasLossInScenario) { aboveT++; continue; }
    // pure-draw on both sides -> no GD swing; fall back to current state
    if (q.gd > tStats.gd) { aboveT++; continue; }
    if (q.gd < tStats.gd) continue;
    if (q.gf > tStats.gf) { aboveT++; continue; }
  }
  return aboveT <= 1;
}

// =============================================================================
// getRemainingGroupFixtures(leagueSlug) -- DB-bound. Returns
// Map<group_letter, [{ home_id, away_id }]> of non-final group-stage
// matches. Used by computeAdvancement's fixture-aware clinch test to
// enumerate scenarios that respect "two teams in the same remaining
// match can't both win."
// =============================================================================
export async function getRemainingGroupFixtures(leagueSlug = WC_LEAGUE_SLUG) {
  const rows = await sql`
    SELECT m.group_code, m.home_team_id, m.away_team_id
      FROM matches m
      JOIN leagues lg ON lg.id = m.league_id
     WHERE lg.slug = ${leagueSlug}
       AND m.stage = 'group'
       AND m.group_code IS NOT NULL
       AND m.status <> 'final'
       AND m.home_team_id IS NOT NULL
       AND m.away_team_id IS NOT NULL
  `;
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.group_code)) map.set(r.group_code, []);
    map.get(r.group_code).push({ home_id: r.home_team_id, away_id: r.away_team_id });
  }
  return map;
}

// =============================================================================
// getGroupStandings() — DB-bound. Returns Map<group_letter, ordered standings>
// for the WC current edition. Sources of truth: matches.status='final' rows
// only. Groups with zero finals still return all four teams at zeros.
// =============================================================================
export async function getGroupStandings(leagueSlug = WC_LEAGUE_SLUG) {
  const teamsByGroup = await getGroupTeams(leagueSlug);
  const finals = await sql`
    SELECT m.group_code, m.home_team_id, m.away_team_id, m.home_score, m.away_score
      FROM matches m
     WHERE m.league_id = (SELECT id FROM leagues WHERE slug = ${leagueSlug})
       AND m.stage = 'group'
       AND m.group_code IS NOT NULL
       AND m.status = 'final'
  `;
  const finalsByGroup = new Map();
  for (const m of finals) {
    if (!finalsByGroup.has(m.group_code)) finalsByGroup.set(m.group_code, []);
    finalsByGroup.get(m.group_code).push(m);
  }
  const byLetter = new Map();
  for (const [groupCode, teams] of teamsByGroup.entries()) {
    const groupMatches = finalsByGroup.get(groupCode) ?? [];
    byLetter.set(groupCode, orderGroup(teams, groupMatches));
  }
  return byLetter;
}

// Aggregate counts for the homepage's tournament-progress strip:
// total / final / live group-stage matches across all groups.
// Returns { total_group, final_group, live_group, min_matchdays_complete }.
//
// min_matchdays_complete is the tournament-wide matchday counter (0-3).
// Each group plays 3 matchdays (2 matches per matchday = 6 group matches).
// The "of 3" framing on the homepage strip only makes sense as a single
// 0-3 counter, so this is the MIN across the 12 groups' per-group
// floor(finals/2) values. Effect:
//   - min=0 → at least one group hasn't completed any matchday yet
//   - min=1 → every group has played at least matchday 1 (24 finals)
//   - min=2 → every group has played matchday 2 (48 finals)
//   - min=3 → group stage complete (72 finals)
// Prior version summed across groups (range 0-36), which displayed as
// "12 of 3 matchdays" once every group cleared MD1 — broken semantics.
export async function getGroupStageProgress(leagueSlug = WC_LEAGUE_SLUG) {
  const rows = await sql`
    SELECT
      count(*)::int                                  AS total_group,
      count(*) FILTER (WHERE status = 'final')::int  AS final_group,
      count(*) FILTER (WHERE status = 'live')::int   AS live_group
    FROM matches
    WHERE league_id = (SELECT id FROM leagues WHERE slug = ${leagueSlug})
      AND stage = 'group'
  `;
  const matchdayMap = await getGroupMatchdayProgress(leagueSlug);
  const values = [...matchdayMap.values()];
  const minMatchdaysComplete = values.length > 0 ? Math.min(...values) : 0;
  return {
    total_group: rows[0]?.total_group ?? 0,
    final_group: rows[0]?.final_group ?? 0,
    live_group:  rows[0]?.live_group  ?? 0,
    min_matchdays_complete: minMatchdaysComplete,
  };
}
