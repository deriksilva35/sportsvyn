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
// Applies the 2026 FIFA World Cup group-stage tiebreaker chain. This was
// REVISED for 2026: head-to-head metrics now come BEFORE overall goal
// difference, not after. The pre-2026 WC ordering (overall GD first) is
// no longer correct. Source: 2026 FIFA World Cup Regulations, Article 14
// (FIFA.com + ESPN coverage).
//
// Inputs:
//   teams   : [{ id, name, slug, flag_svg_path }]
//   matches : [{ home_team_id, away_team_id, home_score, away_score }]
//             - matches between the group's teams, with scores. Caller
//               filters by status; orderGroup trusts what it's given.
//
// Returns: ordered standings array. Position = array index.
//
// Chain (applied stepwise, breaking ties cluster-by-cluster):
//   Step 1 - Overall points.
//   Step 2 - For each tied-on-points cluster, apply the head-to-head
//            mini-table (matches between cluster members only):
//              2a. H2H points
//              2b. H2H goal difference
//              2c. H2H goals scored
//   Step 3 - For any team still tied after step 2, apply overall:
//              3a. Overall goal difference
//              3b. Overall goals scored
//   Step 4 - Final stable breaker: alphabetical by name.
//
// Skipped (no input data): team conduct score (3c per FIFA), FIFA World
// Ranking (3d). These would extend step 3.
// =============================================================================
export function orderGroup(teams, matches) {
  // 1. Per-team overall stats. Accept either {id, ...} (raw team rows from
  // getGroupTeams) or {team_id, ...} (re-sortable standings rows from a
  // previous orderGroup call -- used by computeAdvancement's enumeration).
  const statsByTeam = new Map();
  for (const t of teams) {
    const tid = t.team_id ?? t.id;
    statsByTeam.set(tid, {
      team_id: tid, name: t.name, slug: t.slug, flag_svg_path: t.flag_svg_path,
      played: 0, wins: 0, draws: 0, losses: 0,
      gf: 0, ga: 0, gd: 0, points: 0,
    });
  }
  for (const m of matches) {
    const home = statsByTeam.get(m.home_team_id);
    const away = statsByTeam.get(m.away_team_id);
    if (!home || !away) continue;
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

  // 2. Step 1: sort by overall points only. Tied-points clusters resolve
  //    by H2H mini-table first (steps 2a/2b/2c), THEN overall GD/GF
  //    (step 3), THEN alpha. This is the load-bearing 2026 change vs the
  //    pre-2026 WC ordering.
  const standings = [...statsByTeam.values()].sort((a, b) => b.points - a.points);

  // 3. Cluster scan: contiguous run of teams tied on points.
  let i = 0;
  while (i < standings.length) {
    let j = i + 1;
    while (j < standings.length && standings[j].points === standings[i].points) j++;

    if (j - i > 1) {
      const cluster = standings.slice(i, j);
      sortClusterFifa2026(cluster, matches);
      for (let k = 0; k < cluster.length; k++) standings[i + k] = cluster[k];
    }
    i = j;
  }

  return standings;
}

// Resolve a cluster of teams tied on overall points using the 2026 FIFA
// chain: H2H mini-table (pts, GD, GF) → overall GD/GF → alpha. The H2H
// mini-table is built once from matches between cluster members; the
// comparator carries each criterion stepwise.
function sortClusterFifa2026(cluster, allMatches) {
  const clusterIds = new Set(cluster.map((t) => t.team_id));
  const h2h = new Map();
  for (const t of cluster) {
    h2h.set(t.team_id, { points: 0, gf: 0, ga: 0, gd: 0 });
  }
  for (const m of allMatches) {
    if (!clusterIds.has(m.home_team_id) || !clusterIds.has(m.away_team_id)) continue;
    const hs = m.home_score ?? 0;
    const as = m.away_score ?? 0;
    const h = h2h.get(m.home_team_id);
    const a = h2h.get(m.away_team_id);
    h.gf += hs; h.ga += as;
    a.gf += as; a.ga += hs;
    if (hs > as)      { h.points += 3; }
    else if (hs < as) { a.points += 3; }
    else              { h.points += 1; a.points += 1; }
  }
  for (const v of h2h.values()) v.gd = v.gf - v.ga;

  cluster.sort((a, b) => {
    const ha = h2h.get(a.team_id);
    const hb = h2h.get(b.team_id);
    // Step 2: H2H mini-table.
    if (ha.points !== hb.points) return hb.points - ha.points;
    if (ha.gd     !== hb.gd)     return hb.gd     - ha.gd;
    if (ha.gf     !== hb.gf)     return hb.gf     - ha.gf;
    // Step 3: overall GD/GF (the cluster shares points, so step 1 is moot).
    if (a.gd     !== b.gd)       return b.gd     - a.gd;
    if (a.gf     !== b.gf)       return b.gf     - a.gf;
    // Step 4: alpha (stable final tiebreak; FIFA's real continuation is
    // team conduct + FIFA ranking, neither of which we have data for).
    return a.name.localeCompare(b.name);
  });
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
export function computeAdvancement(allGroupStandings, allGroupMatchesByGroup = new Map()) {
  const status = new Map();
  for (const [groupLetter, teams] of allGroupStandings) {
    if (!teams || teams.length === 0) continue;
    const allMatches = allGroupMatchesByGroup.get(groupLetter) ?? [];
    const playedMatches = allMatches.filter(
      (m) => m.status === 'final' && m.home_score != null && m.away_score != null
    );
    const remainingFixtures = allMatches
      .filter((m) => m.status !== 'final')
      .map((m) => ({ home_id: m.home_team_id, away_id: m.away_team_id }));

    for (const T of teams) {
      // 'through' = top-2 in every fixture-respecting scenario, sorted
      // by the FIFA 2026 chain (orderGroup), with ADVERSARIAL margins on
      // remaining matches (T's losses by huge margin, chasers' wins by
      // huge margin). If T is still top-2 under that worst case, T is
      // genuinely clinched. Most clinches resolve via H2H pts (margin-
      // independent under the 2026 chain), so this is rigorous without
      // being unrealistic.
      const through = isThroughFifa2026(T, teams, playedMatches, remainingFixtures);

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

// T is top-2 in every scenario iff isThroughFifa2026 returns true. Uses
// orderGroup (FIFA 2026 chain: H2H before overall GD) as the comparator.
function isThroughFifa2026(T, teams, playedMatches, remainingFixtures) {
  if (remainingFixtures.length === 0) {
    const sorted = orderGroup(teams, playedMatches);
    return sorted.findIndex((t) => t.team_id === T.team_id) < 2;
  }
  const OUTCOMES = ['H', 'D', 'A'];
  const n = remainingFixtures.length;
  const total = 3 ** n;
  for (let s = 0; s < total; s++) {
    const scenario = [];
    let k = s;
    for (let i = 0; i < n; i++) {
      scenario.push(OUTCOMES[k % 3]);
      k = Math.floor(k / 3);
    }
    if (!isTopTwoInScenarioFifa2026(T, teams, playedMatches, remainingFixtures, scenario)) {
      return false;
    }
  }
  return true;
}

// Apply scenario outcomes with neutral margins (1-0 wins, 0-0 draws), then
// check if T is safely top-2 using a MARGIN-INDEPENDENT analytical rule:
// T is safe iff at most 1 rival is either (a) strictly above T on points
// or (b) tied on points AND not strictly below T on H2H pts.
//
// Margin-dependent steps (H2H GD/GF, overall GD/GF) are NEVER trusted for
// the clinch test, because adversarial margins on the remaining games can
// flip them. This is conservative -- it doesn't claim a clinch that
// depends on goal-margin accounting -- but it never false-clinches.
//
// Example of why this matters: Netherlands and Japan drew 2-2 (H2H pts
// 1=1, tied). In a scenario where both finish at 4 pts (Sweden wins,
// Netherlands loses to Tunisia), the chain falls to overall GD. Japan's
// 0-1 loss vs Netherlands' 0-5 loss puts Japan above Netherlands.
// Netherlands finishes 3rd. The earlier adversarial-margin attempt got
// the direction wrong (it boosted winners' margins, helping Netherlands
// tie Japan on GD), producing a false clinch.
function isTopTwoInScenarioFifa2026(T, teams, playedMatches, remainingFixtures, scenario) {
  const synth = [];
  for (let i = 0; i < remainingFixtures.length; i++) {
    const fix = remainingFixtures[i];
    const out = scenario[i];
    let hs, as;
    if (out === 'H')      { hs = 1; as = 0; }
    else if (out === 'A') { hs = 0; as = 1; }
    else                  { hs = 0; as = 0; }
    synth.push({ home_team_id: fix.home_id, away_team_id: fix.away_id, home_score: hs, away_score: as });
  }
  const combined = [...playedMatches, ...synth];

  // Compute final overall points per team.
  const pts = new Map();
  for (const t of teams) pts.set(t.team_id, 0);
  for (const m of combined) {
    if (!pts.has(m.home_team_id) || !pts.has(m.away_team_id)) continue;
    if (m.home_score > m.away_score)      pts.set(m.home_team_id, pts.get(m.home_team_id) + 3);
    else if (m.home_score < m.away_score) pts.set(m.away_team_id, pts.get(m.away_team_id) + 3);
    else { pts.set(m.home_team_id, pts.get(m.home_team_id) + 1);
           pts.set(m.away_team_id, pts.get(m.away_team_id) + 1); }
  }

  const tPts = pts.get(T.team_id);

  // strictlyAbovePts: teams that finish strictly above T on overall points
  // (margin-independent; nothing in the rest of the chain can change pts).
  let strictlyAbovePts = 0;
  const cluster = []; // teams tied with T on overall points (including T)
  for (const Q of teams) {
    if (pts.get(Q.team_id) > tPts) strictlyAbovePts++;
    else if (pts.get(Q.team_id) === tPts) cluster.push(Q);
  }

  // Cluster size 1 -> T is alone at its points level. Top-2 iff at most 1
  // team strictly above on points. Margin-independent.
  if (cluster.length === 1) return strictlyAbovePts <= 1;

  // Cluster size >= 2 -> within-cluster ordering decides T's position via
  // the FIFA 2026 chain step 2 (H2H mini-table). Compute the FULL cluster
  // H2H pts (matches between any two cluster members), not pairwise --
  // pairwise misses 3-way rock-paper-scissors ties where summed H2H pts
  // are equal across all three even though each pair has a strict winner.
  const clusterIds = new Set(cluster.map((q) => q.team_id));
  const h2hPts = new Map();
  for (const q of cluster) h2hPts.set(q.team_id, 0);
  for (const m of combined) {
    if (!clusterIds.has(m.home_team_id) || !clusterIds.has(m.away_team_id)) continue;
    if (m.home_score > m.away_score)      h2hPts.set(m.home_team_id, h2hPts.get(m.home_team_id) + 3);
    else if (m.home_score < m.away_score) h2hPts.set(m.away_team_id, h2hPts.get(m.away_team_id) + 3);
    else { h2hPts.set(m.home_team_id, h2hPts.get(m.home_team_id) + 1);
           h2hPts.set(m.away_team_id, h2hPts.get(m.away_team_id) + 1); }
  }
  const tH2H = h2hPts.get(T.team_id);

  // Within the cluster, T's rivals fall into three groups:
  //   - strictly above T on cluster H2H pts (margin-independently above)
  //   - tied with T on cluster H2H pts (margin-dependent -- could be above
  //     or below T depending on H2H GD/GF or overall GD/GF; not trusted)
  //   - strictly below T on cluster H2H pts (margin-independently below)
  let strictlyAboveInCluster = 0;
  let tiedInClusterH2H = 0;
  for (const Q of cluster) {
    if (Q.team_id === T.team_id) continue;
    const qH2H = h2hPts.get(Q.team_id);
    if (qH2H > tH2H)      strictlyAboveInCluster++;
    else if (qH2H === tH2H) tiedInClusterH2H++;
  }

  // T's standings position floor: strictlyAbovePts + strictlyAboveInCluster + 1.
  // T's standings position ceiling: floor + tiedInClusterH2H (any of those
  // tied rivals could end up above T via the margin-dependent steps).
  // SAFELY top-2 iff ceiling <= 2, i.e., strictlyAbovePts +
  // strictlyAboveInCluster + tiedInClusterH2H <= 1.
  return (strictlyAbovePts + strictlyAboveInCluster + tiedInClusterH2H) <= 1;
}

// =============================================================================
// getGroupMatches(leagueSlug) -- DB-bound. Returns Map<group_letter,
// [match]> with all group-stage matches per group, including status +
// scores. Feeds computeAdvancement's FIFA-2026 scenario enumeration --
// it needs both played results (for H2H mini-tables) and unplayed
// pairings (to enumerate outcomes).
// =============================================================================
export async function getGroupMatches(leagueSlug = WC_LEAGUE_SLUG) {
  const rows = await sql`
    SELECT m.group_code, m.home_team_id, m.away_team_id,
           m.home_score, m.away_score, m.status
      FROM matches m
      JOIN leagues lg ON lg.id = m.league_id
     WHERE lg.slug = ${leagueSlug}
       AND m.stage = 'group'
       AND m.group_code IS NOT NULL
       AND m.home_team_id IS NOT NULL
       AND m.away_team_id IS NOT NULL
  `;
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.group_code)) map.set(r.group_code, []);
    map.get(r.group_code).push(r);
  }
  return map;
}

// =============================================================================
// getRemainingGroupFixtures(leagueSlug) -- DB-bound. Returns
// Map<group_letter, [{ home_id, away_id }]> of non-final group-stage
// matches. Kept for back-compat; the bracket page now uses getGroupMatches
// (which returns played + unplayed in one read).
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
