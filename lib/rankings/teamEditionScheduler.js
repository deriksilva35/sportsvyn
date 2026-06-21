// lib/rankings/teamEditionScheduler.js -- Phase 4 Part A daily orchestrator.
//
// Reconstructs the ed2 hybrid recipe into permanent committed code, then
// wraps it in a scheduler matching the player scheduler shape:
//
//   result_score:      DETERMINISTIC from W-D-L + capped GD (humble shrinkage)
//   process_score:     LLM-graded against in-tournament match-facts envelope
//   squad_score:       carried VERBATIM from the prior is_current edition
//                      (ed1-only pre-tournament reputation read; never re-graded)
//   coherence_score:   carried VERBATIM from prior edition
//   momentum_score:    NOT graded this series. ed2 shipped with momentum NULL
//                      across all 48 rows; introducing it mid-series would
//                      make movement ambiguous. The 4-dim blend reproduces ed2
//                      exactly (proven by validation).
//   editorial_composite: 4-dim re-normalized:
//                        (0.30 squad + 0.15 coherence + 0.25 result + 0.15 process) / 0.85
//   sites_composite:   carried VERBATIM from prior edition (ed1 seed pin)
//   outer (score):     0.90 editorial + 0.10 sites  (locked; sites-easing and
//                      sites-dropped dry-runs both made the board worse)
//
// Cache freshness for LLM-graded process:
//   - Each entry stamps impact_scored_against_fingerprint = team's current
//     final-match count at scoring time.
//   - Next edition's scheduler reuses cached process IFF
//     stored_fp == current_fp. Otherwise calls LLM fresh.
//   - NULL stored_fp on prior entry = legacy = force re-score (safe direction).
//
// REUSES impact_scored_against_fingerprint column (no migration; semantics
// are entity-agnostic: "the fingerprint the LLM-graded sub-scores were
// valid against").

import Anthropic from '@anthropic-ai/sdk';
import { draftRankingRowBlurb } from './blurbDrafter.js';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 700;

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ============================================================================
// Locked parameters. Tunable via the runner.
// ============================================================================
export const TEAM_PARAMS = Object.freeze({
  // Outer blend
  w_editorial: 0.90,
  w_sites:     0.10,
  // Editorial dim weights (weighted blend, re-normalized over present dims)
  w_squad:     0.30,
  w_coherence: 0.15,
  w_result:    0.25,
  w_process:   0.15,
  w_momentum:  0.15,
  // Deterministic RESULT formula
  result_ppm_baseline: 1.5,   // a draw-equivalent baseline
  result_ppm_coef:     2.0,
  result_gdpm_coef:    0.5,
  result_gdpm_cap:     3,     // clamp(GD/MP, -3, +3)
  result_baseline:     5.0,
  result_score_cap:    10,
  candidate_pool:      48,    // all WC teams
});

// ============================================================================
// Pure helpers.
// ============================================================================
const clamp  = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round1 = (n) => Math.floor(n * 10 + 0.5) / 10;
const round2 = (n) => Math.floor(n * 100 + 0.5) / 100;

// Deterministic RESULT score from W-D-L + GD (humble shrinkage).
// Returns null when matches_played == 0.
export function computeResultScore({ wins, draws, losses, gf, ga }, params = TEAM_PARAMS) {
  const mp = wins + draws + losses;
  if (mp === 0) return null;
  const ppm  = (3 * wins + draws) / mp;
  const gdpm = clamp((gf - ga) / mp, -params.result_gdpm_cap, params.result_gdpm_cap);
  const raw  = (ppm - params.result_ppm_baseline) * params.result_ppm_coef
             + gdpm * params.result_gdpm_coef;
  const confidence = Math.min(mp / 3, 1);
  return round1(clamp(params.result_baseline + raw * confidence, 0, params.result_score_cap));
}

// Editorial composite = weighted blend over present dims (re-normalized
// for any held dim). Mirrors the player scorer's pattern.
export function computeTeamEditorial({ result, process: proc, squad, coherence, momentum }, params = TEAM_PARAMS) {
  const dims = [
    { v: squad,     w: params.w_squad },
    { v: coherence, w: params.w_coherence },
    { v: result,    w: params.w_result },
    { v: proc,      w: params.w_process },
    { v: momentum,  w: params.w_momentum },
  ].filter((d) => d.v != null);
  if (dims.length === 0) return null;
  const totalW = dims.reduce((s, d) => s + d.w, 0);
  return round1(dims.reduce((s, d) => s + d.v * d.w, 0) / totalW);
}

// Outer composite = 0.90 editorial + 0.10 sites.
// Falls back to editorial when sites is null (honest behavior: don't
// fabricate the sites layer).
export function computeTeamOuter(editorial, sites, params = TEAM_PARAMS) {
  if (editorial == null) return null;
  if (sites == null)     return round2(editorial);
  return round2(params.w_editorial * editorial + params.w_sites * sites);
}

// ============================================================================
// Match rollup -- deterministic, supports as-of-timestamp for ed2 reconstruction.
// ============================================================================
export async function rollupTeamRecordsAndMatches({ sql, leagueSlug, asOfTimestamp = null }) {
  const rows = asOfTimestamp
    ? await sql`
        SELECT m.id AS match_id, m.kickoff_at,
               m.home_team_id, m.away_team_id, m.home_score, m.away_score,
               ht.name AS home_name, at.name AS away_name
          FROM matches m
          JOIN leagues lg ON lg.id = m.league_id
          JOIN teams ht ON ht.id = m.home_team_id
          JOIN teams at ON at.id = m.away_team_id
         WHERE lg.slug = ${leagueSlug}
           AND m.status = 'final'
           AND m.kickoff_at < ${asOfTimestamp}::timestamptz
         ORDER BY m.kickoff_at
      `
    : await sql`
        SELECT m.id AS match_id, m.kickoff_at,
               m.home_team_id, m.away_team_id, m.home_score, m.away_score,
               ht.name AS home_name, at.name AS away_name
          FROM matches m
          JOIN leagues lg ON lg.id = m.league_id
          JOIN teams ht ON ht.id = m.home_team_id
          JOIN teams at ON at.id = m.away_team_id
         WHERE lg.slug = ${leagueSlug}
           AND m.status = 'final'
         ORDER BY m.kickoff_at
      `;
  const teams = new Map(); // team_id -> { wins, draws, losses, gf, ga, mp, matches: [...] }
  function ensure(teamId) {
    if (!teams.has(teamId)) teams.set(teamId, { wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, mp: 0, matches: [] });
    return teams.get(teamId);
  }
  for (const m of rows) {
    for (const side of [
      { teamId: m.home_team_id, isHome: true,  my: m.home_score, opp: m.away_score, opponent: m.away_name },
      { teamId: m.away_team_id, isHome: false, my: m.away_score, opp: m.home_score, opponent: m.home_name },
    ]) {
      const t = ensure(side.teamId);
      t.mp += 1;
      t.gf += side.my; t.ga += side.opp;
      if      (side.my > side.opp) t.wins++;
      else if (side.my < side.opp) t.losses++;
      else                          t.draws++;
      t.matches.push({
        match_id: m.match_id, venue: side.isHome ? 'home' : 'away',
        opponent: side.opponent, score: `${side.my}-${side.opp}`,
        my_score: side.my, opp_score: side.opp,
        result: side.my > side.opp ? 'win' : side.my < side.opp ? 'loss' : 'draw',
      });
    }
  }
  return teams;
}

// Map<team_id, fingerprint> where fingerprint = count of final matches
// played, league-scoped. Used by the cache-freshness check.
export async function loadCurrentTeamFingerprints({ sql, leagueSlug, asOfTimestamp = null }) {
  const records = await rollupTeamRecordsAndMatches({ sql, leagueSlug, asOfTimestamp });
  const map = new Map();
  for (const [teamId, rec] of records) map.set(teamId, rec.mp);
  // Teams with zero matches yet aren't in the rollup; the caller fills 0.
  return map;
}

// ============================================================================
// Prior-edition snapshot. Returns full per-team context for movement
// computation + cache freshness check + verbatim carry of squad/coherence/sites.
// ============================================================================
export async function loadPriorByTeamId({ sql, listSlug, leagueSlug }) {
  const rows = await sql`
    SELECT re.team_id,
           re.rank,
           re.score::float                          AS score,
           re.editorial_composite::float            AS editorial_composite,
           re.sites_composite::float                AS sites_composite,
           re.result_score::float                   AS result_score,
           re.process_score::float                  AS process_score,
           re.squad_score::float                    AS squad_score,
           re.coherence_score::float                AS coherence_score,
           re.momentum_score::float                 AS momentum_score,
           re.impact_scored_against_fingerprint     AS impact_fp,
           re.fifa_rank, re.fifa_score::float       AS fifa_score,
           re.espn_rank, re.espn_score::float       AS espn_score,
           re.athletic_rank, re.athletic_score::float AS athletic_score
      FROM ranking_entries re
      JOIN ranking_editions ed ON ed.id = re.ranking_edition_id
      JOIN ranking_lists rl    ON rl.id = ed.ranking_list_id
      JOIN leagues lg          ON lg.id = rl.league_id
     WHERE rl.slug = ${listSlug}
       AND lg.slug = ${leagueSlug}
       AND ed.is_current = true
       AND ed.status     = 'published'
       AND re.entity_type = 'team'
  `;
  const map = new Map();
  for (const r of rows) map.set(r.team_id, r);
  return map;
}

// ============================================================================
// LLM PROCESS scorer. Single tool-call returning the numeric score +
// justification. Grounded discipline identical to the player path.
// Momentum is NOT graded this series (ed2 shipped without it; introducing
// it mid-series would make movement ambiguous).
// ============================================================================
const PROCESS_SYSTEM_PROMPT = `You are scoring ONE dimension of Sportsvyn's Team Power rubric for one team at the 2026 World Cup: PROCESS.

PROCESS (0.0 to 10.0): performance quality independent of result -- xG, chance creation, control of play, defensive structure. Read per-match stats and scorers, not the W/L column alone.

NOT in your scope:
- RESULT (Sportsvyn scores it deterministically from W-D-L + GD; don't double-count).
- SQUAD or COHERENCE (carried verbatim from the pre-tournament edition; never re-scored).
- MOMENTUM (not graded this series; series mathematical consistency with prior edition).

GROUNDING, non-negotiable:
- Your training cutoff predates this tournament. You have NO independent knowledge.
- ONLY use envelope facts. Match scores, scorer minutes, possession/xG/shots.
- No invented stats. If the envelope says null for xG, you cannot claim one.
- Team played zero matches -> return null with "insufficient match history" justification.

PUNCTUATION:
- NEVER use em or en dashes. Use commas, semicolons, colons, periods. Hyphens between joined words only.

Submit via submit_process_score.`;

const PROCESS_TOOL = {
  name: 'submit_process_score',
  description: 'Submit the team PROCESS score grounded in envelope evidence.',
  input_schema: {
    type: 'object',
    properties: {
      process:               { type: ['number', 'null'] },
      process_justification: { type: 'string' },
    },
    required: ['process', 'process_justification'],
  },
};

export async function scoreProcess(envelope) {
  if (!client) return { ok: false, error: 'ANTHROPIC_API_KEY missing' };
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: PROCESS_SYSTEM_PROMPT,
      messages: [{ role: 'user',
        content: `Team envelope:\n\n${JSON.stringify(envelope, null, 2)}\n\nScore PROCESS strictly from envelope facts. Submit via submit_process_score.` }],
      tools: [PROCESS_TOOL],
      tool_choice: { type: 'tool', name: 'submit_process_score' },
    });
    const tu = resp.content.find((b) => b.type === 'tool_use');
    if (!tu) return { ok: false, error: 'no_tool_use' };
    const process = tu.input.process == null ? null : clamp(tu.input.process, 0, 10);
    return { ok: true, process,
             process_justification: tu.input.process_justification };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

// ============================================================================
// In-tournament envelope for PROCESS scoring. Pulls team's matches +
// per-match stats + scorers from match_events + match_statistics.
// ============================================================================
export async function assembleTeamPmEnvelope({ sql, teamId, leagueSlug, record }) {
  // Team meta
  const teamRow = await sql`SELECT name FROM teams WHERE id = ${teamId}`;
  const teamName = teamRow[0]?.name ?? `team#${teamId}`;

  if (!record || record.mp === 0) {
    return { team: { id: teamId, name: teamName }, matches: [] };
  }

  const matchIds = record.matches.map((m) => m.match_id);
  const events = await sql`
    SELECT match_id, event_type, detail, minute, minute_extra, team_side,
           player_name, assist_name
      FROM match_events
     WHERE is_current = true
       AND match_id = ANY(${matchIds}::int[])
       AND event_type = 'Goal'
     ORDER BY match_id, minute, minute_extra NULLS LAST
  `;
  const stats = await sql`
    SELECT match_id, team_side, stats
      FROM match_statistics
     WHERE is_current = true AND match_id = ANY(${matchIds}::int[])
  `;
  // Resolve team_side per match by checking which side this team was on.
  const sideForMatch = new Map();
  const matchInfo = await sql`
    SELECT id, home_team_id, away_team_id FROM matches WHERE id = ANY(${matchIds}::int[])
  `;
  for (const m of matchInfo) sideForMatch.set(m.id, m.home_team_id === teamId ? 'home' : 'away');

  const statsByMatch = new Map();
  for (const r of stats) statsByMatch.set(`${r.match_id}:${r.team_side}`, r.stats);
  const num = (v) => {
    if (v == null) return null;
    const n = Number(String(v).replace('%',''));
    return Number.isFinite(n) ? n : null;
  };

  const matches = record.matches.map((m) => {
    const mySide = sideForMatch.get(m.match_id);
    const myStats = statsByMatch.get(`${m.match_id}:${mySide}`) ?? {};
    const myScorers = events
      .filter((e) => e.match_id === m.match_id && e.team_side === mySide
                  && !['Own Goal', 'Missed Penalty', 'Goal cancelled'].includes(e.detail))
      .map((e) => ({ name: e.player_name,
                     minute: e.minute_extra ? `${e.minute}+${e.minute_extra}` : `${e.minute}`,
                     kind: e.detail === 'Penalty' ? 'penalty' : 'open_play' }));
    const oppScorers = events
      .filter((e) => e.match_id === m.match_id && e.team_side !== mySide
                  && !['Own Goal', 'Missed Penalty', 'Goal cancelled'].includes(e.detail))
      .map((e) => ({ name: e.player_name,
                     minute: e.minute_extra ? `${e.minute}+${e.minute_extra}` : `${e.minute}` }));
    return {
      opponent: m.opponent, venue: m.venue, score: m.score, result: m.result,
      my_scorers: myScorers, opp_scorers: oppScorers,
      team_stats: {
        possession_pct: num(myStats['Ball Possession']),
        xg:             num(myStats['expected_goals']),
        total_shots:    num(myStats['Total Shots']),
        shots_on_goal:  num(myStats['Shots on Goal']),
      },
    };
  });

  return {
    team: { id: teamId, name: teamName },
    wc_record: {
      matches_played: record.mp,
      wins: record.wins, draws: record.draws, losses: record.losses,
      goals_for: record.gf, goals_against: record.ga, goal_diff: record.gf - record.ga,
      points: 3 * record.wins + record.draws,
    },
    matches,
  };
}

// ============================================================================
// Deterministic tiebreak chain for team-power: composite -> editorial ->
// result_score -> goal_diff -> team_id ASC.
// ============================================================================
export function rankTeamsAndAssignMovement({ teams, priorByTeamId = new Map() }) {
  const sorted = teams.slice().sort((a, b) =>
    (b.composite          - a.composite) ||
    (b.editorial_composite - a.editorial_composite) ||
    ((b.result_score ?? 0) - (a.result_score ?? 0)) ||
    ((b.gd ?? 0)           - (a.gd ?? 0)) ||
    (a.team_id - b.team_id)
  );
  sorted.forEach((t, i) => { t.rank = i + 1; });
  for (const t of sorted) {
    const prior = priorByTeamId.get(t.team_id);
    if (!prior) {
      t.prev_rank = null;
      t.prev_score = null;
      t.rank_movement = null;
      t.score_movement = null;
      t.movement_label = 'new';
    } else {
      t.prev_rank = prior.rank;
      t.prev_score = prior.score;
      t.rank_movement = prior.rank - t.rank;
      t.score_movement = round2(t.composite - prior.score);
      t.movement_label = t.rank_movement > 0 ? 'up' : t.rank_movement < 0 ? 'down' : 'hold';
    }
  }
  return sorted;
}

// ============================================================================
// Atomic publish (mirror publishPlayerEdition shape).
// Inserts ranking_editions + ranking_entries with all 5 dim columns +
// sites + impact_scored_against_fingerprint stamp. blurbs=[] always
// for the scheduler (board-only; drafts via separate path).
// ============================================================================
export async function publishTeamEdition({
  sql,
  leagueSlug,
  listSlug = 'team-power',
  editionLabel,
  editionNumber,
  methodologyVersion = '2.0',
  params = TEAM_PARAMS,
  notes = {},
  editorActionSummary = '',
  entries,
}) {
  const meta = await sql`
    SELECT rl.id AS list_id, lg.id AS league_id,
           (SELECT id FROM ranking_editions
             WHERE ranking_list_id = rl.id AND is_current = true LIMIT 1) AS current_ed_id
      FROM ranking_lists rl
      JOIN leagues lg ON lg.id = rl.league_id
     WHERE rl.slug = ${listSlug} AND lg.slug = ${leagueSlug}
  `;
  if (meta.length === 0) throw new Error(`list ${listSlug} not found for league ${leagueSlug}`);
  const { list_id, current_ed_id } = meta[0];

  const entriesJson = JSON.stringify(entries.map((e) => ({
    team_id:                  e.team_id,
    rank:                     e.rank,
    score:                    e.composite,
    prev_rank:                e.prev_rank ?? null,
    rank_mv:                  e.rank_movement ?? null,
    prev_score:               e.prev_score ?? null,
    score_mv:                 e.score_movement ?? null,
    mv_label:                 e.movement_label ?? 'new',
    result_score:             e.result_score ?? null,
    process_score:            e.process_score ?? null,
    squad_score:              e.squad_score ?? null,
    coherence_score:          e.coherence_score ?? null,
    momentum_score:           e.momentum_score ?? null,
    editorial_composite:      e.editorial_composite ?? null,
    sites_composite:          e.sites_composite ?? null,
    fifa_rank:                e.fifa_rank ?? null,
    fifa_score:               e.fifa_score ?? null,
    espn_rank:                e.espn_rank ?? null,
    espn_score:               e.espn_score ?? null,
    athletic_rank:            e.athletic_rank ?? null,
    athletic_score:           e.athletic_score ?? null,
    impact_fp:                e.impact_scored_against_fingerprint ?? null,
  })));

  const notesText = JSON.stringify({
    edition_label: editionLabel,
    methodology_version: methodologyVersion,
    params,
    matches_used: 'rolling',
    generated_at: new Date().toISOString(),
    ...notes,
  });

  // Single CTE: insert edition (is_current=false), insert entries.
  // No inline blurb writes. is_current flip in a separate atomic statement.
  const inserted = await sql`
    WITH new_ed AS (
      INSERT INTO ranking_editions (
        ranking_list_id, edition_number, edition_label, methodology_version,
        editorial_weight, sites_weight, status, is_current,
        published_at, notes, editor_action_summary
      )
      VALUES (
        ${list_id}::int, ${editionNumber}::int, ${editionLabel}, ${methodologyVersion},
        ${params.w_editorial}::numeric, ${params.w_sites}::numeric,
        'published', false,
        now(), ${notesText}::text, ${editorActionSummary}::text
      )
      RETURNING id
    ),
    new_entries AS (
      INSERT INTO ranking_entries (
        ranking_edition_id, entity_type, team_id, player_id,
        rank, score,
        previous_rank, rank_movement, previous_score, score_movement, movement_label,
        result_score, process_score, squad_score, coherence_score, momentum_score,
        editorial_composite, sites_composite,
        fifa_rank, fifa_score, espn_rank, espn_score, athletic_rank, athletic_score,
        impact_scored_against_fingerprint
      )
      SELECT (SELECT id FROM new_ed), 'team',
             (e->>'team_id')::int, NULL,
             (e->>'rank')::int, (e->>'score')::numeric,
             NULLIF(e->>'prev_rank',  'null')::int,
             NULLIF(e->>'rank_mv',    'null')::int,
             NULLIF(e->>'prev_score', 'null')::numeric,
             NULLIF(e->>'score_mv',   'null')::numeric,
             e->>'mv_label',
             NULLIF(e->>'result_score',        'null')::numeric,
             NULLIF(e->>'process_score',       'null')::numeric,
             NULLIF(e->>'squad_score',         'null')::numeric,
             NULLIF(e->>'coherence_score',     'null')::numeric,
             NULLIF(e->>'momentum_score',      'null')::numeric,
             NULLIF(e->>'editorial_composite', 'null')::numeric,
             NULLIF(e->>'sites_composite',     'null')::numeric,
             NULLIF(e->>'fifa_rank',           'null')::int,
             NULLIF(e->>'fifa_score',          'null')::numeric,
             NULLIF(e->>'espn_rank',           'null')::int,
             NULLIF(e->>'espn_score',          'null')::numeric,
             NULLIF(e->>'athletic_rank',       'null')::int,
             NULLIF(e->>'athletic_score',      'null')::numeric,
             NULLIF(e->>'impact_fp',           'null')::int
        FROM jsonb_array_elements(${entriesJson}::jsonb) AS e
      RETURNING id, team_id
    )
    SELECT (SELECT id FROM new_ed) AS new_ed_id,
           (SELECT count(*)::int FROM new_entries) AS entry_count
  `;
  const { new_ed_id, entry_count } = inserted[0];

  // is_current flip (atomic single-statement). If no prior, just set true.
  if (current_ed_id == null) {
    await sql`UPDATE ranking_editions SET is_current = true WHERE id = ${new_ed_id}`;
  } else {
    await sql`
      UPDATE ranking_editions
         SET is_current = CASE id
                            WHEN ${current_ed_id}::int THEN false
                            WHEN ${new_ed_id}::int     THEN true
                          END,
             updated_at = now()
       WHERE id IN (${current_ed_id}::int, ${new_ed_id}::int)
    `;
  }

  return { new_ed_id, entry_count, prior_ed_id: current_ed_id };
}

// ============================================================================
// Drift / live / idempotency gates -- mirror the player scheduler.
// ============================================================================
async function liveCheck({ sql, leagueSlug }) {
  const r = await sql`
    SELECT
      (SELECT count(*)::int FROM matches m JOIN leagues lg ON lg.id=m.league_id
        WHERE lg.slug=${leagueSlug} AND m.status='live')                              AS live_now,
      (SELECT count(*)::int FROM matches m JOIN leagues lg ON lg.id=m.league_id
        WHERE lg.slug=${leagueSlug} AND m.status='final'
          AND m.updated_at > now() - interval '5 minutes')                            AS settled_5min
  `;
  if (r[0].live_now > 0)     return { holdReason: 'live_match',    snapshot: r[0] };
  if (r[0].settled_5min > 0) return { holdReason: 'cooldown_5min', snapshot: r[0] };
  return { holdReason: null, snapshot: r[0] };
}

async function driftSnapshot({ sql, leagueSlug }) {
  const r = await sql`
    SELECT
      (SELECT count(*)::int FROM matches m JOIN leagues lg ON lg.id=m.league_id
        WHERE lg.slug=${leagueSlug} AND m.status='final') AS finals,
      (SELECT count(*)::int FROM match_events me
        JOIN matches m ON m.id = me.match_id
        JOIN leagues lg ON lg.id = m.league_id
        WHERE lg.slug=${leagueSlug} AND me.is_current=true) AS events
  `;
  return r[0];
}

async function idempotencyCheck({ sql, listSlug, leagueSlug, currentFinals }) {
  const r = await sql`
    SELECT ed.id, ed.edition_number, ed.notes
      FROM ranking_editions ed
      JOIN ranking_lists rl ON rl.id = ed.ranking_list_id
      JOIN leagues lg       ON lg.id = rl.league_id
     WHERE rl.slug = ${listSlug}
       AND lg.slug = ${leagueSlug}
       AND ed.is_current = true
       AND ed.status     = 'published'
  `;
  if (r.length === 0) return { priorEditionId: null, priorEditionNumber: null, priorFinalsCount: null, shouldProceed: true };
  const prior = r[0];
  let priorFinals = null;
  try {
    const notes = JSON.parse(prior.notes ?? '{}');
    priorFinals = notes.scored_at_finals_count ?? null;
  } catch { /* ignore */ }
  // Forward-fix path: if prior is missing scored_at_finals_count (ed2's
  // case), proceed (we have no idempotency baseline to compare against).
  const shouldProceed = priorFinals == null || currentFinals > priorFinals;
  return { priorEditionId: prior.id, priorEditionNumber: prior.edition_number, priorFinalsCount: priorFinals, shouldProceed };
}

// Edition label derivation. Same WC structure thresholds as player.
function deriveTeamMatchdayLabel(finalsCount) {
  if (finalsCount <= 24) return 'After Matchday 1';
  if (finalsCount <= 48) return 'After Matchday 2';
  if (finalsCount <= 72) return 'After Group Stage';
  if (finalsCount <= 80) return 'After Round of 16';
  if (finalsCount <= 84) return 'After Quarterfinals';
  if (finalsCount <= 86) return 'After Semifinals';
  return `Update ${new Date().toISOString().slice(0, 10)}`;
}

// ============================================================================
// Top-level orchestrator.
// ============================================================================
const MAX_DRIFT_ITERATIONS = 3;
const TOP_N_BLURBS         = 10;

export async function publishTeamEditionDaily({
  sql,
  leagueSlug = 'fifa-wc-2026',
  listSlug   = 'team-power',
  dryRun     = false,
  params     = TEAM_PARAMS,
}) {
  const startedAt = Date.now();

  const live = await liveCheck({ sql, leagueSlug });
  if (live.holdReason) {
    return { action: 'hold', reason: live.holdReason, live_snapshot: live.snapshot,
             timing_ms: Date.now() - startedAt, dryRun };
  }

  const snapBefore = await driftSnapshot({ sql, leagueSlug });
  const idem = await idempotencyCheck({ sql, listSlug, leagueSlug, currentFinals: snapBefore.finals });
  if (!idem.shouldProceed) {
    return { action: 'no_op', reason: 'no_new_finals',
             current_finals: snapBefore.finals,
             prior_edition_id: idem.priorEditionId,
             prior_finals_count: idem.priorFinalsCount,
             timing_ms: Date.now() - startedAt, dryRun };
  }

  // Drift-collapse loop
  let attempt = 0;
  let priorMap = null;
  let teamsPayload, snapAfter;
  let newProcessCalls = 0;
  let reusedProcessCalls = 0;
  const reuseDecisions = [];

  while (attempt < MAX_DRIFT_ITERATIONS) {
    attempt++;
    priorMap = await loadPriorByTeamId({ sql, listSlug, leagueSlug });

    // Pull all WC teams + their records (rolling, no asOfTimestamp)
    const allTeams = await sql`
      SELECT t.id, t.name FROM teams t JOIN leagues lg ON lg.id = t.league_id
       WHERE lg.slug = ${leagueSlug} ORDER BY t.id
    `;
    const records = await rollupTeamRecordsAndMatches({ sql, leagueSlug });

    // Reset per-iteration counters
    newProcessCalls = 0;
    reusedProcessCalls = 0;
    reuseDecisions.length = 0;

    teamsPayload = [];
    for (const t of allTeams) {
      const rec = records.get(t.id) ?? { wins:0, draws:0, losses:0, gf:0, ga:0, mp:0, matches:[] };
      const result_score = computeResultScore(rec, params);
      const currentFp = rec.mp;
      const prior = priorMap.get(t.id);

      // Squad + coherence + sites carry verbatim from prior. If no prior, all NULL.
      const squad_score     = prior?.squad_score      ?? null;
      const coherence_score = prior?.coherence_score  ?? null;
      const sites_composite = prior?.sites_composite  ?? null;
      const fifa_rank       = prior?.fifa_rank        ?? null;
      const fifa_score      = prior?.fifa_score       ?? null;
      const espn_rank       = prior?.espn_rank        ?? null;
      const espn_score      = prior?.espn_score       ?? null;
      const athletic_rank   = prior?.athletic_rank    ?? null;
      const athletic_score  = prior?.athletic_score   ?? null;

      // PROCESS: cache-aware. Momentum stays null (series consistency with ed2).
      let process_score, decision;
      const cachedFp = prior?.impact_fp ?? null;
      if (prior?.process_score != null && cachedFp != null && cachedFp === currentFp) {
        process_score = prior.process_score;
        decision = 'reused';
        reusedProcessCalls++;
      } else if (rec.mp === 0) {
        process_score = null;
        decision = 'skipped_no_matches';
      } else {
        const envelope = await assembleTeamPmEnvelope({ sql, teamId: t.id, leagueSlug, record: rec });
        const r = await scoreProcess(envelope);
        if (!r.ok) throw new Error(`scoreProcess failed for team_id=${t.id}: ${r.error}`);
        process_score = r.process;
        decision = prior?.process_score == null ? 'fresh_no_prior'
                : cachedFp == null              ? 'fresh_unstamped_prior'
                                                : 'fresh_stale_fingerprint';
        newProcessCalls++;
      }
      reuseDecisions.push({ team_id: t.id, name: t.name, decision,
                            cached_fp: cachedFp, current_fp: currentFp });

      const editorial = computeTeamEditorial({
        result: result_score, process: process_score,
        squad: squad_score, coherence: coherence_score,
        momentum: null,   // locked: no momentum this series
      }, params);
      const composite = computeTeamOuter(editorial, sites_composite, params);

      teamsPayload.push({
        team_id: t.id, team_name: t.name,
        record: rec, gd: rec.gf - rec.ga,
        result_score, process_score, squad_score, coherence_score, momentum_score: null,
        editorial_composite: editorial, sites_composite,
        fifa_rank, fifa_score, espn_rank, espn_score, athletic_rank, athletic_score,
        impact_scored_against_fingerprint: currentFp,
        composite,
      });
    }

    snapAfter = await driftSnapshot({ sql, leagueSlug });
    if (snapAfter.finals === snapBefore.finals && snapAfter.events === snapBefore.events) break;
    // drift detected; update baseline and retry
    snapBefore.finals = snapAfter.finals;
    snapBefore.events = snapAfter.events;
  }

  const stable = snapAfter.finals === snapBefore.finals && snapAfter.events === snapBefore.events;
  if (!stable) {
    return { action: 'unstable_hold', reason: 'finals_drifted_after_max_iterations',
             attempts: attempt, snap_before: snapBefore, snap_after: snapAfter,
             timing_ms: Date.now() - startedAt, dryRun };
  }

  const ranked = rankTeamsAndAssignMovement({ teams: teamsPayload, priorByTeamId: priorMap });
  const editionLabel = deriveTeamMatchdayLabel(snapAfter.finals);
  const editionNumber = (idem.priorEditionNumber ?? 0) + 1;

  // Top-10 blurb draft plan (returned in dryRun; written post-publish in live runs).
  const top10 = ranked.slice(0, TOP_N_BLURBS);
  const draftPlan = top10.map((t) => ({
    rank: t.rank,
    team_id: t.team_id,
    team_name: t.team_name,
    movement_label: t.movement_label,
    composite: t.composite,
  }));

  if (dryRun) {
    return {
      action: 'dry_run',
      would_publish: {
        edition_label: editionLabel,
        edition_number: editionNumber,
        entry_count: ranked.length,
        top_15_board: ranked.slice(0, 15).map((t) => ({
          rank: t.rank, team: t.team_name,
          composite: t.composite,
          editorial: t.editorial_composite,
          sites: t.sites_composite,
          result: t.result_score,
          process: t.process_score,
          squad: t.squad_score,
          coherence: t.coherence_score,
          momentum: t.momentum_score,
          fp: t.impact_scored_against_fingerprint,
          record: `${t.record.wins}-${t.record.draws}-${t.record.losses}  GD ${t.gd >= 0 ? '+' : ''}${t.gd}`,
          movement_label: t.movement_label,
          rank_movement: t.rank_movement,
          prev_rank: t.prev_rank,
        })),
        would_draft: draftPlan,
      },
      drift_iterations: attempt,
      new_process_calls: newProcessCalls,
      reused_process_calls: reusedProcessCalls,
      reuse_breakdown: {
        reused:                  reuseDecisions.filter((d) => d.decision === 'reused').length,
        fresh_no_prior:          reuseDecisions.filter((d) => d.decision === 'fresh_no_prior').length,
        fresh_unstamped_prior:   reuseDecisions.filter((d) => d.decision === 'fresh_unstamped_prior').length,
        fresh_stale_fingerprint: reuseDecisions.filter((d) => d.decision === 'fresh_stale_fingerprint').length,
        skipped_no_matches:      reuseDecisions.filter((d) => d.decision === 'skipped_no_matches').length,
      },
      prior_edition_id: idem.priorEditionId,
      prior_edition_number: idem.priorEditionNumber,
      prior_finals_count: idem.priorFinalsCount,
      snap_before: snapBefore,
      snap_after: snapAfter,
      timing_ms: Date.now() - startedAt,
      dryRun: true,
    };
  }

  // STEP 4: publish (atomic)
  const pub = await publishTeamEdition({
    sql, leagueSlug, listSlug,
    editionLabel, editionNumber,
    params,
    notes: {
      scored_at_finals_count: snapAfter.finals,
      scored_at_event_count:  snapAfter.events,
      drift_iterations:       attempt,
      new_process_calls:      newProcessCalls,
      reused_process_calls:   reusedProcessCalls,
      auto_published_by:      'cron:publish-team-edition',
    },
    editorActionSummary: `Auto-publish via daily cron; ${snapAfter.finals} finals; ${newProcessCalls} new process calls; ${attempt} drift iteration(s).`,
    entries: ranked,
  });

  // STEP 5: queue top-10 blurb drafts (pending_review). Idempotent.
  const newEntries = await sql`
    SELECT id, team_id, rank
      FROM ranking_entries
     WHERE ranking_edition_id = ${pub.new_ed_id}
       AND rank <= ${TOP_N_BLURBS}
     ORDER BY rank
  `;
  const draftResults = [];
  for (const e of newEntries) {
    try {
      const r = await draftRankingRowBlurb({ rankingEntryId: e.id });
      draftResults.push({
        entry_id: e.id,
        rank:     e.rank,
        action:   r.ok ? 'drafted' : (r.skipped ? 'skipped' : 'error'),
        blurb_id: r.blurb_id ?? null,
        reason:   r.reason ?? null,
      });
    } catch (err) {
      draftResults.push({
        entry_id: e.id, rank: e.rank, action: 'error', error: String(err.message ?? err),
      });
    }
  }

  return {
    action: 'published',
    new_ed_id: pub.new_ed_id, edition_label: editionLabel, edition_number: editionNumber,
    entry_count: pub.entry_count,
    drafts_queued:  draftResults.filter((r) => r.action === 'drafted').length,
    drafts_skipped: draftResults.filter((r) => r.action === 'skipped').length,
    drafts_errored: draftResults.filter((r) => r.action === 'error').length,
    draft_details:  draftResults,
    new_process_calls: newProcessCalls, reused_process_calls: reusedProcessCalls,
    drift_iterations: attempt,
    snap_before: snapBefore, snap_after: snapAfter,
    prior_edition_id: idem.priorEditionId,
    prior_edition_number: idem.priorEditionNumber,
    prior_finals_count: idem.priorFinalsCount,
    timing_ms: Date.now() - startedAt,
    dryRun: false,
  };
}
