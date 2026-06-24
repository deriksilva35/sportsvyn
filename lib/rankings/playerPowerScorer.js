// lib/rankings/playerPowerScorer.js — Player Power MVP scorer.
//
// MVP: PRODUCTION (deterministic match_events rollup) + IMPACT (LLM,
// grounded in this-tournament facts only). STATURE excluded for v1.0;
// the v5.1 stature path will add it once players.current_stature_score
// is backfilled.
//
// Per-player composite for the Tournament MVP board:
//   production_raw   = 1.0*open_play + 0.7*pen + 0.6*assists - 0.5*reds
//   production_score = clamp(production_raw * scale, 0, cap), round1
//   impact_score     = LLM 0..10, grounded ONLY in envelope match facts
//   composite        = w_production * production_score + w_impact * impact_score
//
// Mirrors lib/rankings/teamPowerScorer.js for structural consistency.
// All numeric helpers are pure functions; SQL helpers take a sql client.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 600;

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ============================================================================
// Locked default parameters. Tunable via the runner.
// ============================================================================
export const DEFAULT_PARAMS = Object.freeze({
  w_production:     0.60,
  w_impact:         0.40,
  production_scale: 2.6,
  production_cap:   9.5,
  w_open_goal:      1.0,
  w_pen_goal:       0.7,
  w_assist:         0.6,
  w_red:            0.5,
  candidate_pool:   50,
});

// ============================================================================
// Pure helpers (deterministic, side-effect-free).
// ============================================================================
const round1 = (n) => Math.floor(n * 10 + 0.5) / 10;
const round2 = (n) => Math.floor(n * 100 + 0.5) / 100;
const clamp  = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function computeProductionRaw({ open_play_goals, penalty_goals, assists, reds }, params = DEFAULT_PARAMS) {
  return open_play_goals * params.w_open_goal
       + penalty_goals    * params.w_pen_goal
       + assists          * params.w_assist
       - reds             * params.w_red;
}

export function computeProductionScore(raw, params = DEFAULT_PARAMS) {
  return round1(clamp(raw * params.production_scale, 0, params.production_cap));
}

export function computeComposite(production_score, impact_score, params = DEFAULT_PARAMS) {
  if (impact_score == null) return null;
  return round2(params.w_production * production_score + params.w_impact * impact_score);
}

// ============================================================================
// Production rollup — deterministic match_events aggregation for the league.
// Returns top-N candidates by production_raw.
// ============================================================================
export async function rollupProductionForLeague({ sql, leagueSlug, candidatePool = DEFAULT_PARAMS.candidate_pool, params = DEFAULT_PARAMS }) {
  const rows = await sql`
    WITH wc_events AS (
      SELECT me.* FROM match_events me
      JOIN matches m  ON m.id = me.match_id
      JOIN leagues lg ON lg.id = m.league_id
      WHERE lg.slug = ${leagueSlug} AND me.is_current = true
    ),
    goals_cards AS (
      SELECT p.id AS player_id, p.full_name, p.known_as, p.position,
             p.current_team_id AS team_id, t.name AS team_name,
             count(*) FILTER (WHERE e.event_type='Goal' AND e.detail NOT IN ('Own Goal','Missed Penalty','Goal cancelled','Penalty'))::int AS open_play_goals,
             count(*) FILTER (WHERE e.event_type='Goal' AND e.detail='Penalty')::int                                                         AS penalty_goals,
             count(*) FILTER (WHERE e.event_type='Goal' AND e.detail='Own Goal')::int                                                        AS own_goals,
             count(*) FILTER (WHERE e.event_type='Card' AND e.detail='Yellow Card')::int                                                     AS yellows,
             count(*) FILTER (WHERE e.event_type='Card' AND e.detail='Red Card')::int                                                        AS reds
        FROM wc_events e
        JOIN players p ON p.external_ids->>'api_sports' = e.player_api_id::text
        JOIN teams t   ON t.id = p.current_team_id
       GROUP BY p.id, p.full_name, p.known_as, p.position, p.current_team_id, t.name
    ),
    assists AS (
      SELECT p.id AS player_id, count(*)::int AS assists
        FROM wc_events e
        JOIN players p ON p.external_ids->>'api_sports' = e.assist_api_id::text
       WHERE e.event_type='Goal'
         AND e.detail NOT IN ('Own Goal','Missed Penalty','Goal cancelled')
         AND e.assist_api_id IS NOT NULL
       GROUP BY p.id
    )
    SELECT g.player_id, g.full_name, g.known_as, g.position, g.team_id, g.team_name,
           g.open_play_goals, g.penalty_goals, g.own_goals, g.yellows, g.reds,
           COALESCE(a.assists, 0) AS assists
      FROM goals_cards g
      LEFT JOIN assists a ON a.player_id = g.player_id
     WHERE (g.open_play_goals + g.penalty_goals + COALESCE(a.assists, 0)) > 0
        OR g.reds > 0
     ORDER BY (g.open_play_goals + g.penalty_goals + COALESCE(a.assists, 0)) DESC,
              g.open_play_goals DESC
     LIMIT ${candidatePool}
  `;
  const hydrated = rows.map((r) => ({
    ...r,
    production_raw:   computeProductionRaw(r, params),
    production_score: computeProductionScore(computeProductionRaw(r, params), params),
  }));
  return hydrated.sort((a, b) => b.production_raw - a.production_raw);
}

// ============================================================================
// Envelope assembly — per-player match-by-match facts for the LLM impact call.
// Grounded in match_events + match_statistics. No fabricated stats permitted.
// ============================================================================
export async function assemblePlayerEnvelope({ sql, playerId, leagueSlug }) {
  const player = await sql`
    SELECT p.id, COALESCE(p.known_as, p.full_name) AS name, p.position,
           p.current_team_id AS team_id, t.name AS team_name,
           (p.external_ids->>'api_sports')::int AS api_id
      FROM players p
      JOIN teams t ON t.id = p.current_team_id
     WHERE p.id = ${playerId}
  `;
  if (player.length === 0) throw new Error(`player not found: ${playerId}`);
  const p = player[0];

  const matches = await sql`
    SELECT m.id AS match_id, m.kickoff_at,
           m.home_team_id, m.away_team_id, m.home_score, m.away_score,
           ht.name AS home_name, at.name AS away_name
      FROM matches m
      JOIN leagues lg ON lg.id = m.league_id
      JOIN teams ht ON ht.id = m.home_team_id
      JOIN teams at ON at.id = m.away_team_id
     WHERE lg.slug = ${leagueSlug} AND m.status = 'final'
       AND (m.home_team_id = ${p.team_id} OR m.away_team_id = ${p.team_id})
     ORDER BY m.kickoff_at
  `;

  const events = await sql`
    SELECT match_id, event_type, detail, minute, minute_extra, team_side,
           player_api_id, player_name, assist_api_id, assist_name
      FROM match_events
     WHERE is_current = true
       AND match_id = ANY(${matches.map((m) => m.match_id)}::int[])
       AND (player_api_id = ${p.api_id} OR assist_api_id = ${p.api_id})
     ORDER BY match_id, minute, minute_extra NULLS LAST
  `;

  const stats = await sql`
    SELECT match_id, team_side, stats
      FROM match_statistics
     WHERE is_current = true
       AND match_id = ANY(${matches.map((m) => m.match_id)}::int[])
  `;
  const statsByMatchSide = new Map();
  for (const r of stats) statsByMatchSide.set(`${r.match_id}:${r.team_side}`, r.stats);

  const num = (v) => {
    if (v == null) return null;
    const n = Number(String(v).replace('%',''));
    return Number.isFinite(n) ? n : null;
  };

  const enrichedMatches = matches.map((m) => {
    const isHome = m.home_team_id === p.team_id;
    const my_side = isHome ? 'home' : 'away';
    const my_score = isHome ? m.home_score : m.away_score;
    const opp_score = isHome ? m.away_score : m.home_score;
    const opponent = isHome ? m.away_name : m.home_name;
    const result = my_score > opp_score ? 'win' : my_score < opp_score ? 'loss' : 'draw';
    const myStats = statsByMatchSide.get(`${m.match_id}:${my_side}`) ?? {};
    const matchEvents = events.filter((e) => e.match_id === m.match_id);
    const player_events = matchEvents
      .filter((e) => e.player_api_id === p.api_id)
      .map((e) => {
        let kind;
        if (e.event_type === 'Goal' && e.detail === 'Penalty')           kind = 'penalty_goal';
        else if (e.event_type === 'Goal' && e.detail === 'Own Goal')     kind = 'own_goal';
        else if (e.event_type === 'Goal')                                kind = 'open_play_goal';
        else if (e.event_type === 'Card' && e.detail === 'Yellow Card')  kind = 'yellow';
        else if (e.event_type === 'Card' && e.detail === 'Red Card')     kind = 'red';
        else                                                             kind = e.event_type;
        return { minute: e.minute_extra ? `${e.minute}+${e.minute_extra}` : `${e.minute}`, kind };
      });
    const assists_credited = matchEvents
      .filter((e) => e.assist_api_id === p.api_id && e.event_type === 'Goal'
                  && !['Own Goal','Missed Penalty','Goal cancelled'].includes(e.detail))
      .map((e) => ({ minute: e.minute_extra ? `${e.minute}+${e.minute_extra}` : `${e.minute}`,
                     for_scorer: e.player_name }));
    return {
      opponent, venue: isHome ? 'home' : 'away',
      score: `${my_score}-${opp_score}`, result,
      player_events, assists_credited,
      team_stats: {
        possession_pct: num(myStats['Ball Possession']),
        xg:             num(myStats['expected_goals']),
        total_shots:    num(myStats['Total Shots']),
        shots_on_goal:  num(myStats['Shots on Goal']),
      },
    };
  });

  // Drop matches where the player had zero events (they were on the bench or
  // unused — no signal for impact). Keep matches where they appear via either
  // primary event or assist.
  const playerMatches = enrichedMatches.filter((m) =>
    m.player_events.length > 0 || m.assists_credited.length > 0
  );

  return {
    player: { name: p.name, team: p.team_name, position: p.position },
    matches: playerMatches,
  };
}

// ============================================================================
// LLM impact scorer.
// Grounding rule is non-negotiable: training cutoff predates the WC,
// so the model MUST work from envelope facts only.
// ============================================================================
export const SYSTEM_PROMPT = `You are scoring the IMPACT dimension of Sportsvyn's Player Power Rankings (Tournament MVP) for one player at the 2026 World Cup.

IMPACT (0.0 to 10.0) = decisiveness + quality + tournament-carrying. Read the actual match facts in the envelope:
- Were the goals decisive (game-winners, late equalizers, opening salvo against a strong opponent), or low-pressure pile-ons in routs?
- Was the player the driver of their team's matches, or one contributor among many?
- Quality of contributions: hat trick vs three tap-ins; a stunning curler vs a deflected boot.
- Opposition context: a brace against Algeria reads differently from a brace against France.

NOT in your scope:
- Raw production volume (already separately scored as production_score).
- Pre-tournament reputation.

GROUNDING, non-negotiable:
- Your training cutoff predates this tournament. You have NO independent knowledge of these matches.
- ONLY use envelope facts. Match scores, scorer minutes, possession/xG/shots are the only data.
- No invented stats. If the envelope says null for xG, you cannot claim an xG number.
- Reference player events only by minute and kind from the envelope.

PUNCTUATION:
- NEVER use em dashes or en dashes. Use commas, semicolons, colons, periods. Hyphens between joined words only.

Submit via the submit_impact_score tool: a numeric impact score and a 30-90 word justification that names specific match evidence.`;

const IMPACT_TOOL = {
  name: 'submit_impact_score',
  description: 'Submit the IMPACT score and justification for the player.',
  input_schema: {
    type: 'object',
    properties: {
      impact:        { type: 'number', description: '0.0 to 10.0' },
      justification: { type: 'string', description: '30 to 90 word match-grounded justification' },
    },
    required: ['impact', 'justification'],
  },
};

export async function scoreImpact(envelope) {
  if (!client) throw new Error('ANTHROPIC_API_KEY missing');
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user',
      content: `Player envelope (in_tournament):\n\n${JSON.stringify(envelope, null, 2)}\n\nScore IMPACT 0.0 to 10.0 from envelope facts only. Submit via submit_impact_score.` }],
    tools: [IMPACT_TOOL],
    tool_choice: { type: 'tool', name: 'submit_impact_score' },
  });
  const tu = resp.content.find((b) => b.type === 'tool_use');
  if (!tu) return { ok: false, error: 'no_tool_use', raw: resp.content };
  const impact = clamp(tu.input.impact, 0, 10);
  return { ok: true, impact, justification: tu.input.justification, usage: resp.usage };
}

// ============================================================================
// Top-level: scoreOnePlayer({ playerId, leagueSlug }) -- pulls envelope,
// calls LLM, returns the impact + grounded justification.
// Does NOT compute the composite (caller does that with cached
// production_score, so production isn't recomputed inside the LLM path).
// ============================================================================
export async function scoreOnePlayer({ sql, playerId, leagueSlug }) {
  const envelope = await assemblePlayerEnvelope({ sql, playerId, leagueSlug });
  if (envelope.matches.length === 0) {
    return { ok: false, error: 'no_matches', envelope };
  }
  const result = await scoreImpact(envelope);
  return { ok: result.ok, envelope, ...result };
}
