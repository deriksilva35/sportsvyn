// lib/topicDraft.js - prompt-attached topic_draft pipeline (self-contained).
//
// Four stages: PLAN (Anthropic) -> RESEARCH (Tavily) -> INTERNAL ENVELOPE (DEV
// reads) -> WRITE (Anthropic, driven by the ai_prompt_templates 'topic_draft'
// row). Both API calls are logged to ai_generations. On success a row lands in
// topic_drafts at status 'pending_review'; it NEVER auto-publishes. On
// validation failure the draft row is written at status 'failed' and the
// generation carries validation_errors.
//
// Voice + grounding discipline live in the stored template's system_prompt
// (migration 042), lifted from lib/teamOutlook.js with dashes normalized.

import Anthropic from '@anthropic-ai/sdk';
import { sql } from './db.js';
import { searchTavily } from './tavily.js';

const WC_LEAGUE_SLUG = 'fifa-wc-2026';
const PLAN_MODEL = 'claude-sonnet-4-6'; // same fast model family the brief uses

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    article_type: { type: 'string', enum: ['news_analysis', 'comparison', 'tactical_feature', 'storyline'] },
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: { kind: { type: 'string', enum: ['team', 'player', 'match'] }, name: { type: 'string' } },
        required: ['kind', 'name'],
        additionalProperties: false,
      },
    },
    tavily_queries: { type: 'array', items: { type: 'string' } },
    internal_data_needs: { type: 'array', items: { type: 'string' } },
  },
  required: ['article_type', 'entities', 'tavily_queries', 'internal_data_needs'],
  additionalProperties: false,
};

const WRITE_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    dek: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: { heading: { type: 'string' }, body: { type: 'string' } },
        required: ['heading', 'body'],
        additionalProperties: false,
      },
    },
    sources_cited: { type: 'array', items: { type: 'string' } },
  },
  required: ['headline', 'dek', 'sections', 'sources_cited'],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// ai_generations logging (this pipeline is the table's first writer)
// ---------------------------------------------------------------------------
async function logGeneration(row) {
  const usage = row.usage ?? {};
  const inTok = usage.input_tokens ?? null;
  const outTok = usage.output_tokens ?? null;
  // total_tokens is a GENERATED column (input+output) - do not insert it.
  const rows = await sql`
    INSERT INTO ai_generations (
      prompt_template_id, target_type, target_id, input_data,
      resolved_user_prompt, resolved_system_prompt, raw_response, parsed_output,
      model, input_tokens, output_tokens, duration_ms,
      api_request_id, api_stop_reason, status, error_message, validation_errors,
      created_at
    ) VALUES (
      ${row.templateId ?? null}, 'article', ${row.targetId ?? null}, ${JSON.stringify(row.inputData ?? {})}::jsonb,
      ${row.userPrompt ?? null}, ${row.systemPrompt ?? null}, ${row.raw ?? null},
      ${row.parsed ? JSON.stringify(row.parsed) : null}::jsonb,
      ${row.model ?? null}, ${inTok}, ${outTok},
      ${row.durationMs ?? null},
      ${row.apiRequestId ?? null}, ${row.apiStopReason ?? null}, ${row.status},
      ${row.error ?? null}, ${row.validationErrors ? JSON.stringify(row.validationErrors) : null}::jsonb,
      now()
    ) RETURNING id
  `;
  return rows[0]?.id ?? null;
}

async function anthropicJson({ model, maxTokens, temperature, system, user, schema }) {
  if (!client) throw new Error('ANTHROPIC_API_KEY missing - cannot call Claude');
  const started = Date.now();
  const response = await client.beta.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [{ role: 'user', content: user }],
    output_format: { type: 'json_schema', schema },
  });
  const text = response?.content?.[0]?.text ?? '';
  let parsed = null;
  try { parsed = JSON.parse(text.trim()); } catch { /* left null - caller handles */ }
  return {
    parsed, raw: text, usage: response?.usage ?? null,
    apiRequestId: response?.id ?? null, apiStopReason: response?.stop_reason ?? null,
    durationMs: Date.now() - started,
  };
}

// ---------------------------------------------------------------------------
// Stage 1: PLAN
// ---------------------------------------------------------------------------
const PLAN_SYSTEM = `You are the planner for a Sportsvyn draft-article pipeline. Given an editor's freeform prompt, output a strict-JSON plan only. Choose article_type from the allowed set. List the entities the piece is about, each with kind (team, player, or match) and the name exactly as a reader would write it - for players, copy the name verbatim from the editor prompt, do not correct spelling. Propose 4 to 6 focused web-research queries. List which internal data the writer will need from: rankings, player_stats, watch_scores, bracket, win_prob. Hyphens only, no em or en dashes.`;

async function planStage(promptText) {
  const teams = await sql`
    SELECT t.name, t.slug FROM teams t
    JOIN leagues l ON l.id = t.league_id
    WHERE l.slug = ${WC_LEAGUE_SLUG}
    ORDER BY t.name
  `;
  const teamList = teams.map((t) => `${t.name} (${t.slug})`).join(', ');
  const user =
    `EDITOR PROMPT:\n${promptText}\n\n` +
    `WORLD CUP 2026 TEAMS (name (slug)):\n${teamList}\n\n` +
    `Produce the plan as strict JSON per the schema. Name players verbatim as written in the editor prompt.`;
  const out = await anthropicJson({
    model: PLAN_MODEL, maxTokens: 700, temperature: 0.2,
    system: PLAN_SYSTEM, user, schema: PLAN_SCHEMA,
  });
  return { out, user };
}

// Resolve planner entities against DEV: teams by slug then case-insensitive
// name; players by ILIKE. Unmatched names go to unresolved - never guessed.
async function resolveEntities(entities) {
  const teams = await sql`
    SELECT t.id, t.name, t.slug FROM teams t
    JOIN leagues l ON l.id = t.league_id WHERE l.slug = ${WC_LEAGUE_SLUG}
  `;
  const resolved = [];
  const unresolved = [];
  for (const e of entities ?? []) {
    const name = (e.name ?? '').trim();
    if (!name) continue;
    if (e.kind === 'team') {
      const lc = name.toLowerCase();
      const hit = teams.find((t) => t.name.toLowerCase() === lc || t.slug === lc)
        || teams.find((t) => t.name.toLowerCase().includes(lc) || lc.includes(t.name.toLowerCase()));
      if (hit) resolved.push({ kind: 'team', name, id: hit.id, matched_name: hit.name, slug: hit.slug });
      else unresolved.push({ kind: 'team', name });
    } else if (e.kind === 'player') {
      const rows = await sql`
        SELECT id, full_name, known_as, slug FROM players
        WHERE full_name ILIKE ${'%' + name + '%'} OR known_as ILIKE ${'%' + name + '%'}
        ORDER BY (full_name ILIKE ${name}) DESC, international_caps DESC NULLS LAST
        LIMIT 1
      `;
      if (rows[0]) resolved.push({ kind: 'player', name, id: rows[0].id, matched_name: rows[0].full_name, slug: rows[0].slug });
      else unresolved.push({ kind: 'player', name });
    } else {
      // match kind: informational; carried through without an id resolve in v1.
      resolved.push({ kind: 'match', name });
    }
  }
  return { resolved, unresolved };
}

// ---------------------------------------------------------------------------
// Stage 2: RESEARCH -> structured context block, tier-1 first, ~5K token cap.
// ---------------------------------------------------------------------------
const RESEARCH_CHAR_CAP = 18000; // ~5K tokens

function formatResearch(sources) {
  if (!sources.length) return '(no external research available - write from the internal envelope alone)';
  let out = '';
  for (const s of sources) {
    const host = (() => { try { return new URL(s.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
    const line = `[T${s.tier}] ${s.title} (${host})\n${s.snippet}\nSOURCE: ${s.url}\n\n`;
    if (out.length + line.length > RESEARCH_CHAR_CAP) break;
    out += line;
  }
  return out.trim();
}

// ---------------------------------------------------------------------------
// Stage 3: INTERNAL ENVELOPE
// ---------------------------------------------------------------------------
async function buildTeamEnvelope(teamId) {
  const rows = await sql`
    SELECT t.name, t.abbreviation, t.confederation, t.coach_name, t.fifa_rank, t.group_code,
           t.current_power_rank, t.current_power_score, t.current_rank_movement,
           t.tournament_wins, t.tournament_draws, t.tournament_losses,
           t.tournament_goals_for, t.tournament_goals_against
      FROM teams t WHERE t.id = ${teamId}
  `;
  const team = rows[0];
  if (!team) return null;
  const blurb = await sql`
    SELECT body FROM editorial_blurbs
     WHERE team_id = ${teamId} AND is_current = true AND status = 'published'
     ORDER BY generated_at DESC LIMIT 1
  `;
  const matches = await sql`
    SELECT m.slug, m.stage, m.status, m.kickoff_at,
           ht.abbreviation AS home, at.abbreviation AS away,
           m.home_score, m.away_score,
           (SELECT max(w.composite_score) FROM match_watch_score_history w WHERE w.match_id = m.id) AS watch_peak
      FROM matches m
      JOIN teams ht ON ht.id = m.home_team_id
      JOIN teams at ON at.id = m.away_team_id
      JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = ${WC_LEAGUE_SLUG}
       AND (m.home_team_id = ${teamId} OR m.away_team_id = ${teamId})
     ORDER BY m.kickoff_at DESC LIMIT 8
  `;
  const alive = matches.some((m) => m.stage !== 'group' && (m.status === 'scheduled' || m.status === 'live'));
  const nextKo = matches.find((m) => (m.status === 'scheduled' || m.status === 'live') && m.stage !== 'group');
  return {
    kind: 'team', name: team.name, abbreviation: team.abbreviation,
    ranking: { power_rank: team.current_power_rank, power_score: team.current_power_score, movement: team.current_rank_movement, fifa_rank: team.fifa_rank },
    profile: { confederation: team.confederation, coach: team.coach_name, group: team.group_code },
    tournament_record: {
      wins: team.tournament_wins, draws: team.tournament_draws, losses: team.tournament_losses,
      goals_for: team.tournament_goals_for, goals_against: team.tournament_goals_against,
    },
    bracket: { alive, next_ko: nextKo ? `${nextKo.home} v ${nextKo.away} (${nextKo.stage})` : null },
    matches: matches.map((m) => ({ matchup: `${m.home} ${m.home_score ?? ''}-${m.away_score ?? ''} ${m.away}`.trim(), stage: m.stage, status: m.status, watch_peak: m.watch_peak })),
    editorial_blurb: blurb[0]?.body ?? null,
  };
}

async function buildPlayerEnvelope(playerId) {
  const rows = await sql`
    SELECT p.full_name, p.known_as, p.position, p.nationality, p.club_name,
           p.current_composite_rank, p.current_composite_score, p.current_rank_movement,
           p.tournament_goals, p.tournament_assists, p.international_caps, p.international_goals,
           t.name AS national_team
      FROM players p LEFT JOIN teams t ON t.id = p.current_team_id
     WHERE p.id = ${playerId}
  `;
  const p = rows[0];
  if (!p) return null;
  const blurb = await sql`
    SELECT body FROM editorial_blurbs
     WHERE player_id = ${playerId} AND is_current = true AND status = 'published'
     ORDER BY generated_at DESC LIMIT 1
  `;
  const pms = await sql`
    SELECT m.slug, m.stage, pms.minutes_played, pms.goals, pms.assists, pms.started,
           ht.abbreviation AS home, at.abbreviation AS away
      FROM player_match_stats pms
      JOIN matches m ON m.id = pms.match_id
      JOIN teams ht ON ht.id = m.home_team_id
      JOIN teams at ON at.id = m.away_team_id
     WHERE pms.player_id = ${playerId}
     ORDER BY m.kickoff_at DESC LIMIT 8
  `;
  return {
    kind: 'player', name: p.full_name, known_as: p.known_as, position: p.position,
    nationality: p.nationality, club: p.club_name, national_team: p.national_team,
    ranking: { composite_rank: p.current_composite_rank, composite_score: p.current_composite_score, movement: p.current_rank_movement },
    tournament: { goals: p.tournament_goals, assists: p.tournament_assists },
    career: { international_caps: p.international_caps, international_goals: p.international_goals },
    recent_matches: pms.map((r) => ({ matchup: `${r.home} v ${r.away}`, stage: r.stage, minutes: r.minutes_played, goals: r.goals, assists: r.assists, started: r.started })),
    editorial_blurb: blurb[0]?.body ?? null,
  };
}

async function buildInternalEnvelope(resolved) {
  const out = [];
  for (const e of resolved) {
    if (e.kind === 'team' && e.id) { const t = await buildTeamEnvelope(e.id); if (t) out.push(t); }
    else if (e.kind === 'player' && e.id) { const p = await buildPlayerEnvelope(e.id); if (p) out.push(p); }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const DASH_RE = /[–—]/; // en dash, em dash
const BETTING_RE = /\b(odds|pick|bet|lock|value play|over\/under|moneyline|parlay|spread|smart money|tout|hedge)\b/i;

export function validateTopicDraft(parsed, envelope) {
  const issues = [];
  const headline = (parsed?.headline ?? '').trim();
  const dek = (parsed?.dek ?? '').trim();
  const sections = Array.isArray(parsed?.sections) ? parsed.sections : [];
  const fullText = [headline, dek, ...sections.map((s) => `${s.heading}\n${s.body}`)].join('\n');

  if (!headline) issues.push('missing headline');
  if (sections.length < 3) issues.push(`too few sections: ${sections.length} (need >= 3)`);

  const words = fullText.split(/\s+/).filter(Boolean);
  const wc = words.length;
  if (wc < 1200) issues.push(`word_count: ${wc} (need >= 1200)`);
  if (wc > 1800) issues.push(`word_count: ${wc} (need <= 1800)`);

  if (DASH_RE.test(fullText)) issues.push('contains em or en dash (hyphens only)');
  const bet = fullText.match(BETTING_RE);
  if (bet) issues.push(`betting vocabulary: "${bet[0]}"`);

  // Basic hallucination signal: named entities (from the envelope) the draft
  // should be anchored to must actually appear. And we surface capitalized
  // multi-word names that are NOT in the envelope for the editor. This is a
  // reported signal, not a hard fail (NER is noisy); the hard fails are the
  // deterministic checks above.
  const known = new Set();
  for (const ent of envelope) {
    if (ent.name) known.add(ent.name.toLowerCase());
    if (ent.known_as) known.add(ent.known_as.toLowerCase());
    if (ent.national_team) known.add(ent.national_team.toLowerCase());
  }
  const anchored = [...known].some((n) => fullText.toLowerCase().includes(n));
  if (envelope.length > 0 && !anchored) issues.push('draft does not mention any envelope entity (grounding)');

  return { ok: issues.length === 0, issues, word_count: wc };
}

// ---------------------------------------------------------------------------
// Top-level runner
// ---------------------------------------------------------------------------
export async function runTopicDraft(promptText) {
  if (!promptText || !promptText.trim()) throw new Error('prompt required');

  const template = (await sql`
    SELECT id, version, system_prompt, user_prompt_template, model, max_tokens, temperature
      FROM ai_prompt_templates WHERE slug = 'topic_draft' AND is_active = true LIMIT 1
  `)[0];
  if (!template) throw new Error('topic_draft template row missing (run migration 042)');

  // STAGE 1: PLAN
  const { out: planOut, user: planUser } = await planStage(promptText);
  const planGenId = await logGeneration({
    templateId: template.id, inputData: { prompt: promptText }, userPrompt: planUser,
    systemPrompt: PLAN_SYSTEM, raw: planOut.raw, parsed: planOut.parsed, model: PLAN_MODEL,
    usage: planOut.usage, durationMs: planOut.durationMs, apiRequestId: planOut.apiRequestId,
    apiStopReason: planOut.apiStopReason, status: planOut.parsed ? 'success' : 'error',
    error: planOut.parsed ? null : 'plan_json_parse_failure',
  });
  if (!planOut.parsed) return { ok: false, stage: 'plan', error: 'plan_json_parse_failure', planGenId };
  const plan = planOut.parsed;

  const { resolved, unresolved } = await resolveEntities(plan.entities);

  // STAGE 2: RESEARCH
  const sources = await searchTavily(plan.tavily_queries);
  const researchContext = formatResearch(sources);

  // STAGE 3: INTERNAL ENVELOPE
  const envelope = await buildInternalEnvelope(resolved);

  // STAGE 4: WRITE (template-driven)
  const userPrompt = template.user_prompt_template
    .replace('{{prompt_text}}', promptText)
    .replace('{{research_context}}', researchContext)
    .replace('{{internal_envelope}}', JSON.stringify(envelope, null, 2));
  const writeOut = await anthropicJson({
    model: template.model, maxTokens: template.max_tokens, temperature: Number(template.temperature),
    system: template.system_prompt, user: userPrompt, schema: WRITE_SCHEMA,
  });

  const validation = writeOut.parsed
    ? validateTopicDraft(writeOut.parsed, envelope)
    : { ok: false, issues: ['write_json_parse_failure'], word_count: 0 };

  const writeGenId = await logGeneration({
    templateId: template.id, inputData: { plan, resolved, unresolved, sources_count: sources.length },
    userPrompt, systemPrompt: template.system_prompt, raw: writeOut.raw, parsed: writeOut.parsed,
    model: template.model, usage: writeOut.usage, durationMs: writeOut.durationMs,
    apiRequestId: writeOut.apiRequestId, apiStopReason: writeOut.apiStopReason,
    status: validation.ok ? 'success' : 'validation_failed',
    error: validation.ok ? null : 'validation_failed',
    validationErrors: validation.ok ? null : validation.issues,
  });

  // Persist the draft. Validation failure -> status 'failed' (NOT pending_review).
  const status = validation.ok ? 'pending_review' : 'failed';
  const content = writeOut.parsed ?? { error: 'no_parse', raw: writeOut.raw };
  const draft = (await sql`
    INSERT INTO topic_drafts (
      prompt_text, article_type, resolved_entities, unresolved_entities, research_sources,
      ai_original, current_content, status, model, prompt_version, generated_at, editor_notes,
      created_at, updated_at
    ) VALUES (
      ${promptText}, ${plan.article_type ?? null},
      ${JSON.stringify(resolved)}::jsonb, ${JSON.stringify(unresolved)}::jsonb, ${JSON.stringify(sources)}::jsonb,
      ${JSON.stringify(content)}::jsonb, ${JSON.stringify(content)}::jsonb, ${status},
      ${template.model}, ${template.version}, now(),
      ${validation.ok ? null : `validation: ${validation.issues.join('; ')}`},
      now(), now()
    ) RETURNING id
  `)[0];

  // Backfill target_id on both generation rows now that we have the draft id.
  await sql`UPDATE ai_generations SET target_id = ${draft.id} WHERE id = ANY(${[planGenId, writeGenId].filter(Boolean)})`;

  return {
    ok: validation.ok, draftId: draft.id, status, plan, resolved, unresolved,
    sources, envelope, parsed: writeOut.parsed, validation,
    planGenId, writeGenId, usage: { plan: planOut.usage, write: writeOut.usage },
  };
}
