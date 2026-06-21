// lib/rankings/blurbDrafter.js -- ranking-row blurb DRAFTER.
//
// Drafts a ranking_row_blurb against a ranking_entry. The draft lands as
// status='pending_review', is_current=false -- invisible to the page
// reader (which filters status='editor_approved' AND is_current=true).
//
// The editor approves via /admin/blurbs -> lib/blurbs.js:publishBlurb,
// which stamps approved_against_fingerprint at promotion time (the
// staleness guard, Phase 1). This drafter does NOT stamp the
// fingerprint -- it stays NULL until approval, when publishBlurb
// computes it fresh against current PROD state.
//
// Idempotent: skips entries that already have a current editor_approved
// blurb OR an existing pending_review draft. Re-runnable safely.
//
// Voice prompt for in_tournament ranking_row_blurbs is OWNED here (not
// in lib/aiRankingBlurb.js, which is locked to pre_tournament shape).
// The grounding discipline mirrors aiRankingBlurb.js's logic: model
// can only reference players/teams/scores that appear in the envelope.

import Anthropic from '@anthropic-ai/sdk';
import { sql } from '../db.js';
import { assemblePlayerEnvelope } from './playerPowerScorer.js';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 600;

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ============================================================================
// Voice prompt -- in_tournament ranking_row_blurb. 60 to 110 words, MVP-case
// for player blurbs, team-power case for team blurbs.
// ============================================================================
const SYSTEM_PROMPT = `You are writing one ranking-row blurb for Sportsvyn's Power Rankings, in-tournament edition.

The blurb sits beside the rank, the composite score, and the dimension breakdown on the rankings page. You are NOT restating the score. You are making the case for why this entity holds its current rank, anchored in actual matchday facts.

VOICE, match-led:
- LEAD with what they did. Roughly two thirds of the blurb is matchday fact: minute, opponent, scoreline, the texture of how they scored or set up.
- CLOSE with one short clause of standing context (program identity, MVP case) that supports but does not outweigh the match facts.
- 3 to 4 sentences. 60 to 110 words.
- Observation first. No predictions. No "will," "should," "ought," "expected to," "lock," "value."
- Player blurbs are player-led; team blurbs are team-led. Name only entities that appear in the envelope.

GROUNDING, non-negotiable:
- Your training cutoff predates this tournament. You have NO independent knowledge of these matches.
- ONLY use envelope facts. Match scores, scorer minutes, possession/xG/shots are the only data.
- NEVER invent a goal, assist, opponent, score, or stat. If the envelope says null for xG, you cannot claim one.
- Use player names and team names EXACTLY as they appear in the envelope.

HONESTY about context, non-negotiable:
- If goals came in a rout against weak opposition, the blurb must reflect that. Use phrasing like "padded the tally" or "comfortable lead."
- If the impact score (player) is lower than production OR a draw/loss outcome (team) tempered the result, the blurb agrees with that read.

PUNCTUATION:
- NEVER use em dashes or en dashes. Use commas, semicolons, colons, periods. Hyphens between joined words only.

Submit via submit_blurb. Output is plain text body.`;

const BLURB_TOOL = {
  name: 'submit_blurb',
  description: 'Submit the ranking-row blurb body.',
  input_schema: {
    type: 'object',
    properties: {
      body: { type: 'string', description: '3-4 sentences, 60-110 words, no em/en dashes' },
    },
    required: ['body'],
  },
};

// ============================================================================
// Lightweight grounding gate. Tailored to in_tournament envelopes (matches +
// scorers), distinct from aiRankingBlurb.js's pre_tournament roster gate.
// ============================================================================
function lightValidate({ body, envelope, kind }) {
  const issues = [];
  const wc = body.trim().split(/\s+/).filter(Boolean).length;
  if (wc < 50 || wc > 130) issues.push(`body ${wc} words (need 60-110, gate at 50-130)`);

  if (/—|–/.test(body)) issues.push('em/en dash present');

  const PROHIB = [
    /\bwill (win|advance|beat|finish|reach|lift)\b/i,
    /\bshould (win|advance|beat|finish|reach|lift)\b/i,
    /\bought to\b/i,
    /\bdark horse\b/i,
    /\block\b/i,
    /\bsmart money\b/i,
  ];
  for (const re of PROHIB) if (re.test(body)) issues.push(`voice violation: ${re.source}`);

  return { ok: issues.length === 0, issues, word_count: wc };
}

// ============================================================================
// Team envelope assembly. Mirrors the shape used in the team-power ed2
// draft path: team + per-match facts (opponent, score, scorers, stats).
// ============================================================================
async function assembleTeamEnvelope({ teamId, leagueSlug }) {
  const team = await sql`
    SELECT t.id, t.name, t.abbreviation, t.slug
      FROM teams t JOIN leagues lg ON lg.id = t.league_id
     WHERE t.id = ${teamId} AND lg.slug = ${leagueSlug}
  `;
  if (team.length === 0) throw new Error(`team not found: ${teamId}`);

  const matches = await sql`
    SELECT m.id AS match_id, m.kickoff_at,
           m.home_team_id, m.away_team_id, m.home_score, m.away_score,
           ht.name AS home_name, at.name AS away_name
      FROM matches m
      JOIN leagues lg ON lg.id = m.league_id
      JOIN teams ht ON ht.id = m.home_team_id
      JOIN teams at ON at.id = m.away_team_id
     WHERE lg.slug = ${leagueSlug} AND m.status = 'final'
       AND (m.home_team_id = ${teamId} OR m.away_team_id = ${teamId})
     ORDER BY m.kickoff_at
  `;

  const matchIds = matches.map((m) => m.match_id);
  const events = matchIds.length > 0 ? await sql`
    SELECT match_id, event_type, detail, minute, minute_extra,
           team_side, player_api_id, player_name, assist_api_id, assist_name
      FROM match_events
     WHERE is_current = true AND match_id = ANY(${matchIds}::int[])
       AND event_type = 'Goal'
     ORDER BY match_id, minute, minute_extra NULLS LAST
  ` : [];
  const statsRows = matchIds.length > 0 ? await sql`
    SELECT match_id, team_side, stats FROM match_statistics
     WHERE is_current = true AND match_id = ANY(${matchIds}::int[])
  ` : [];
  const statsByKey = new Map();
  for (const r of statsRows) statsByKey.set(`${r.match_id}:${r.team_side}`, r.stats);

  const num = (v) => {
    if (v == null) return null;
    const n = Number(String(v).replace('%',''));
    return Number.isFinite(n) ? n : null;
  };

  let wins = 0, draws = 0, losses = 0, gf = 0, ga = 0;
  const enrichedMatches = matches.map((m) => {
    const isHome = m.home_team_id === teamId;
    const mySide = isHome ? 'home' : 'away';
    const my_score = isHome ? m.home_score : m.away_score;
    const opp_score = isHome ? m.away_score : m.home_score;
    const opponent = isHome ? m.away_name : m.home_name;
    const result = my_score > opp_score ? 'win' : my_score < opp_score ? 'loss' : 'draw';
    if (result === 'win') wins++; else if (result === 'loss') losses++; else draws++;
    gf += my_score; ga += opp_score;
    const myStats = statsByKey.get(`${m.match_id}:${mySide}`) ?? {};
    const myScorers = events
      .filter((e) => e.match_id === m.match_id && e.team_side === mySide && e.detail !== 'Own Goal' && e.detail !== 'Missed Penalty' && e.detail !== 'Goal cancelled')
      .map((e) => ({ name: e.player_name, minute: e.minute_extra ? `${e.minute}+${e.minute_extra}` : `${e.minute}`, kind: e.detail === 'Penalty' ? 'penalty' : 'open_play' }));
    const oppScorers = events
      .filter((e) => e.match_id === m.match_id && e.team_side !== mySide && e.detail !== 'Own Goal' && e.detail !== 'Missed Penalty' && e.detail !== 'Goal cancelled')
      .map((e) => ({ name: e.player_name, minute: e.minute_extra ? `${e.minute}+${e.minute_extra}` : `${e.minute}` }));
    return {
      opponent, venue: isHome ? 'home' : 'away',
      score: `${my_score}-${opp_score}`, result,
      my_scorers: myScorers,
      opp_scorers: oppScorers,
      team_stats: {
        possession_pct: num(myStats['Ball Possession']),
        xg:             num(myStats['expected_goals']),
        total_shots:    num(myStats['Total Shots']),
        shots_on_goal:  num(myStats['Shots on Goal']),
      },
    };
  });

  return {
    team: { name: team[0].name, abbreviation: team[0].abbreviation },
    wc_record: {
      matches_played: matches.length,
      wins, draws, losses, goals_for: gf, goals_against: ga, goal_diff: gf - ga,
    },
    matches: enrichedMatches,
  };
}

// ============================================================================
// LLM call -- single tool-use response.
// ============================================================================
async function callLLM({ envelope, contextLine }) {
  if (!client) throw new Error('ANTHROPIC_API_KEY missing');
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user',
      content: `${contextLine}\n\nEnvelope:\n${JSON.stringify(envelope, null, 2)}\n\nWrite the blurb. Submit via submit_blurb.` }],
    tools: [BLURB_TOOL],
    tool_choice: { type: 'tool', name: 'submit_blurb' },
  });
  const tu = resp.content.find((b) => b.type === 'tool_use');
  if (!tu) throw new Error('no tool_use in response');
  return tu.input.body;
}

// ============================================================================
// Top-level: draftRankingRowBlurb({ rankingEntryId })
// Resolves entity, assembles envelope, calls LLM, light-validates,
// INSERTs as pending_review. Idempotent (skips existing drafts/approved).
// ============================================================================
export async function draftRankingRowBlurb({ rankingEntryId, voiceModelVersion = 'claude-sonnet-4-6-pp-mvp-v1' }) {
  // 1. Idempotency: any current approved blurb OR existing pending draft?
  const existing = await sql`
    SELECT id, status, is_current, blurb_type
      FROM editorial_blurbs
     WHERE ranking_entry_id = ${rankingEntryId}
       AND blurb_type = 'ranking_row_blurb'
       AND ((status = 'editor_approved' AND is_current = true)
         OR  status = 'pending_review')
     ORDER BY id DESC LIMIT 1
  `;
  if (existing.length > 0) {
    return {
      ok: false, skipped: true, ranking_entry_id: rankingEntryId,
      reason: existing[0].status === 'pending_review' ? 'existing_pending_draft' : 'current_approved_blurb_exists',
      existing_blurb_id: existing[0].id,
    };
  }

  // 2. Resolve entry to entity + list + league
  const entryRows = await sql`
    SELECT re.id AS entry_id, re.entity_type, re.player_id, re.team_id, re.rank,
           re.score::float AS composite,
           re.output_score::float AS production_score,
           re.impact_score::float AS impact_score,
           re.editorial_composite::float AS editorial_composite,
           re.sites_composite::float AS sites_composite,
           rl.slug AS list_slug, rl.entity_type AS list_entity_type,
           lg.slug AS league_slug, ed.edition_number, ed.edition_label
      FROM ranking_entries re
      JOIN ranking_editions ed ON ed.id = re.ranking_edition_id
      JOIN ranking_lists rl    ON rl.id = ed.ranking_list_id
      JOIN leagues lg          ON lg.id = rl.league_id
     WHERE re.id = ${rankingEntryId}
  `;
  if (entryRows.length === 0) throw new Error(`ranking_entry ${rankingEntryId} not found`);
  const entry = entryRows[0];

  // 3. Build envelope -- player-shaped or team-shaped
  let envelope, contextLine, kind;
  if (entry.player_id != null) {
    kind = 'player';
    const env = await assemblePlayerEnvelope({
      sql, playerId: entry.player_id, leagueSlug: entry.league_slug,
    });
    envelope = env;
    contextLine = `Player-power (Tournament MVP) ranking_row_blurb. Player rank #${entry.rank}, composite ${entry.composite}, production_score ${entry.production_score}, impact_score ${entry.impact_score}.`;
  } else if (entry.team_id != null) {
    kind = 'team';
    envelope = await assembleTeamEnvelope({
      teamId: entry.team_id, leagueSlug: entry.league_slug,
    });
    contextLine = `Team-power ranking_row_blurb. Team rank #${entry.rank}, composite ${entry.composite}, editorial ${entry.editorial_composite}, sites ${entry.sites_composite}.`;
  } else {
    throw new Error(`ranking_entry ${rankingEntryId} has neither player_id nor team_id`);
  }

  // 4. LLM call
  const body = await callLLM({ envelope, contextLine });

  // 5. Light validation
  const v = lightValidate({ body, envelope, kind });
  if (!v.ok) {
    return {
      ok: false, validation_failed: true, ranking_entry_id: rankingEntryId,
      kind, body, issues: v.issues, word_count: v.word_count,
    };
  }

  // 6. INSERT as pending_review (ranking_entry_id sole discriminator)
  const inserted = await sql`
    INSERT INTO editorial_blurbs (
      blurb_type, ranking_entry_id, body,
      voice_model_version, generated_at, generation_tier, status,
      is_current, auto_published, generation_input
    )
    VALUES (
      'ranking_row_blurb', ${rankingEntryId}, ${body},
      ${voiceModelVersion}::text, now(), 'tier_2_draft', 'pending_review',
      false, false, ${JSON.stringify({ entry, envelope_kind: kind })}::jsonb
    )
    RETURNING id, status, is_current, ranking_entry_id, length(body) AS body_len
  `;

  return {
    ok: true, drafted: true,
    blurb_id: inserted[0].id, ranking_entry_id: rankingEntryId,
    kind, body, word_count: v.word_count,
  };
}
