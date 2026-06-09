// lib/rankings/teamPowerScorer.js — Team Power 5-dim editorial scorer.
//
// Per Methodology page §3 and migration 011 comments: Team Power Rankings
// run a 5-dim editorial composite (RESULT/PROCESS/SQUAD/COHERENCE/MOMENTUM),
// flat-mean to a 0–10 score (editorial_composite). The outer ranking score
// then blends this with the Sites Layer (0.70 * editorial + 0.30 * sites).
//
// This module covers ONLY the 5-dim editorial step. The sites layer +
// outer composite live in lib/rankings/sitesLayer.js and the ranking
// runner (not yet built).
//
// Pattern mirrored from lib/aiPrematch.js exactly:
//   SYSTEM_PROMPT → assembleEnvelope → generateScore → validateScore
//   → server-computed composite over SCORED dims only.
//
// PHASE MODE — pre_tournament vs in_tournament:
//   pre_tournament: no WC matches played yet. The scorer MUST NOT
//     fabricate match results. SQUAD and COHERENCE are scored normally
//     (reputation + squad reads are valid signal at this phase).
//     RESULT, PROCESS, MOMENTUM are HELD (returned null). The composite
//     is the flat mean over the 2 scored dims.
//   in_tournament: all 5 dims scored. Composite is flat mean over 5.
//
// editorial_composite = mean(score for dim in scored_dims) — server side.

import Anthropic from '@anthropic-ai/sdk';
import { sql } from '../db.js';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1500;

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ============================================================================
// LOCKED SYSTEM PROMPT.
// Bound to: glossary (5-dim Team Power rubric), voice-bible §1 (explain
// don't pick), migration 011 column semantics.
// ============================================================================
export const SYSTEM_PROMPT = `You are a Sportsvyn power-rankings analyst scoring a single international team on Sportsvyn's 5-dimension Team Power rubric. Your output is editor-gated — a human reviews and may adjust before publish — but the first draft has to read like work you stand behind.

THE FIVE DIMENSIONS (0.0–10.0 each, equal weight):
- RESULT     = what they've achieved on the pitch (match outcomes, goals, table/group position)
- PROCESS    = performance quality independent of result (xG, chance creation, control)
- SQUAD      = talent and depth of the player pool
- COHERENCE  = tactical clarity, cohesion, manager fit
- MOMENTUM   = trajectory, form direction, trend

PHASE — pre_tournament vs in_tournament — read carefully:
- PRE_TOURNAMENT means no World Cup matches have been played. In this phase:
  * SCORE: SQUAD and COHERENCE normally. These are reputation reads grounded in the named squad and the manager — perfectly scoreable before kickoff.
  * HOLD: RESULT, PROCESS, MOMENTUM. Do NOT score them. Do NOT invent results. Do NOT estimate them as "what we'd expect." Return them as null. The editorial_composite is computed only over the dims you DID score.
- IN_TOURNAMENT means at least one WC match has been played. Score all 5 dims.

EXPLAIN DON'T PICK (voice-bible §1):
- The reasoning field describes the team's standing. It does NOT tip a bet, predict an outcome, or recommend who'll go far. Standings reads, not picks.
- No prophecy verbs: "should," "will," "ought to," "deserves to."
- No gambling language: "lock," "value," "live dog," "smart money."
- No clichés about "the beautiful game," "tale of two halves," etc.

PER-DIMENSION JUSTIFICATIONS (when scored):
- Each scored dim must carry a justification — one sentence, 60–280 chars, naming the specific reason for the score (named player, named manager, named result).
- Held dims have no justification — they're held because the data doesn't exist yet.

CONSTRAINTS:
- Refer to the team by its full name as supplied in the envelope.
- Players you reference must come from the envelope's roster or be matters of public record (manager name, all-time scorer). If unsure, omit rather than invent.
- No fabricated stats. If you need to evoke quality, evoke a named player or a clearly-public manager record, not invented metrics.

OUTPUT SCHEMA (strict JSON):
{
  "phase":          "pre_tournament" | "in_tournament",
  "dims": {
    "result":     number 0.0–10.0 OR null,
    "process":    number 0.0–10.0 OR null,
    "squad":      number 0.0–10.0 OR null,
    "coherence":  number 0.0–10.0 OR null,
    "momentum":   number 0.0–10.0 OR null
  },
  "scored_dims":   array of dim names actually scored,
  "held_dims":     array of dim names held (null),
  "justifications": {
    "result":     "string OR null",
    "process":    "string OR null",
    "squad":      "string OR null",
    "coherence":  "string OR null",
    "momentum":   "string OR null"
  },
  "reasoning":     "string — 60–180 words — standings read for this team's editorial_composite. Names the team, names the load-bearing reasons (named players/manager). Explains. Does not pick."
}

If a dim is in scored_dims, its dims.<name> must be a number and its justifications.<name> must be a non-empty string.
If a dim is in held_dims, its dims.<name> must be null and its justifications.<name> must be null.`;

// ============================================================================
// JSON schema. Anthropic beta API json_schema enforces shape, not value
// ranges (verified during aiPrematch ship — minimum/maximum not supported
// on `number` type). Range gates live in validateScore() below.
// ============================================================================
const SCORER_SCHEMA = {
  type: 'object',
  properties: {
    phase: { type: 'string', enum: ['pre_tournament', 'in_tournament'] },
    dims: {
      type: 'object',
      properties: {
        result:    { type: ['number', 'null'] },
        process:   { type: ['number', 'null'] },
        squad:     { type: ['number', 'null'] },
        coherence: { type: ['number', 'null'] },
        momentum:  { type: ['number', 'null'] },
      },
      required: ['result', 'process', 'squad', 'coherence', 'momentum'],
      additionalProperties: false,
    },
    scored_dims: { type: 'array', items: { type: 'string' } },
    held_dims:   { type: 'array', items: { type: 'string' } },
    justifications: {
      type: 'object',
      properties: {
        result:    { type: ['string', 'null'] },
        process:   { type: ['string', 'null'] },
        squad:     { type: ['string', 'null'] },
        coherence: { type: ['string', 'null'] },
        momentum:  { type: ['string', 'null'] },
      },
      required: ['result', 'process', 'squad', 'coherence', 'momentum'],
      additionalProperties: false,
    },
    reasoning: { type: 'string' },
  },
  required: ['phase', 'dims', 'scored_dims', 'held_dims', 'justifications', 'reasoning'],
  additionalProperties: false,
};

const ALL_DIMS = ['result', 'process', 'squad', 'coherence', 'momentum'];

// ============================================================================
// Envelope assembly — what the AI sees per team.
//
// Pulls from teams + players + leagues. Pre-tournament has no match
// history to lean on, so the envelope is squad + manager-name + league
// context only. The AI scores SQUAD/COHERENCE off this; RESULT/PROCESS/
// MOMENTUM stay null per the phase contract.
// ============================================================================
export async function assembleTeamEnvelope({ teamId, phase = 'pre_tournament' }) {
  const teamRows = await sql`
    SELECT t.id, t.name, t.abbreviation, t.flag_color_primary,
           l.slug AS league_slug, l.name AS league_name,
           t.external_ids
      FROM teams t
      LEFT JOIN leagues l ON l.id = t.league_id
     WHERE t.id = ${teamId}
  `;
  if (teamRows.length === 0) return null;
  const team = teamRows[0];

  // Pull roster — current_team_id is the players FK (per DEV schema check).
  // Cap at 30 so the full WC roster (26 players post-import) fits with
  // buffer. Order: caps DESC first (so the most-experienced players are
  // never dropped if the limit ever bites), then jersey number, then name.
  const players = await sql`
    SELECT p.id, p.full_name, p.known_as, p.position, p.club_name,
           p.international_caps, p.international_goals, p.preferred_foot,
           p.height_cm, p.birthdate, p.current_team_jersey_number,
           p.metadata->>'imported_age' AS imported_age
      FROM players p
     WHERE p.current_team_id = ${teamId}
     ORDER BY p.international_caps DESC NULLS LAST,
              p.current_team_jersey_number ASC NULLS LAST,
              p.full_name
     LIMIT 30
  `;

  return {
    team: {
      id: team.id,
      name: team.name,
      abbreviation: team.abbreviation,
      league: team.league_name,
    },
    phase,
    roster: players.map((p) => ({
      name: p.known_as ?? p.full_name,
      position: p.position,
      jersey: p.current_team_jersey_number,
      age: p.imported_age != null ? Number(p.imported_age) : null,
      club: p.club_name,
      caps: p.international_caps,
      international_goals: p.international_goals,
    })),
    notes: phase === 'pre_tournament'
      ? 'No 2026 WC matches played yet. RESULT, PROCESS, and MOMENTUM are held. Score SQUAD and COHERENCE only.'
      : 'WC matches in progress. Score all 5 dimensions.',
  };
}

// ============================================================================
// Anthropic call — beta json_schema (same shape proven in aiPrematch.js).
// ============================================================================
export async function generateScore(envelope) {
  if (!client) {
    throw new Error('ANTHROPIC_API_KEY missing — cannot call Claude');
  }

  const userContent =
    `Team envelope:\n\n${JSON.stringify(envelope, null, 2)}\n\n` +
    `Score this team on the 5-dim Team Power rubric per the system instructions. ` +
    `Phase is "${envelope.phase}". Hold the appropriate dims per the phase contract. ` +
    `Output STRICT JSON only.`;

  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      output_format: { type: 'json_schema', schema: SCORER_SCHEMA },
    });
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err), raw: null };
  }

  const text = response?.content?.[0]?.text ?? '';
  let parsed;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return { ok: false, error: 'json_parse_failure', raw: text };
  }
  return { ok: true, parsed, raw: text, usage: response.usage };
}

// ============================================================================
// Validation. Shape comes from the schema; this gates VALUES + the
// scored/held contract.
// ============================================================================
const PROPHECY_LINT = [
  { re: /\bshould\b/i,         label: 'prophecy: "should"' },
  { re: /\bwill (?:win|advance|lift|exit|crash|surprise)\b/i, label: 'prophecy: "will X"' },
  { re: /\bought to\b/i,       label: 'prescription: "ought to"' },
  { re: /\bdeserves? to\b/i,   label: 'prescription: "deserves to"' },
  { re: /\blive dog\b/i,       label: 'gambling: "live dog"' },
  { re: /\bsmart money\b/i,    label: 'gambling: "smart money"' },
  { re: /\bvalue play\b/i,     label: 'gambling: "value play"' },
  { re: /\block\b/i,           label: 'gambling: "lock"' },
];

export function validateScore(parsed) {
  const issues = [];

  // 1. phase / scored_dims / held_dims consistency.
  if (!['pre_tournament', 'in_tournament'].includes(parsed.phase)) {
    issues.push(`phase invalid: ${parsed.phase}`);
  }
  const scored = parsed.scored_dims ?? [];
  const held = parsed.held_dims ?? [];

  // Union of scored + held must equal {result,process,squad,coherence,momentum}.
  const union = new Set([...scored, ...held]);
  for (const d of ALL_DIMS) {
    if (!union.has(d)) issues.push(`dim ${d} missing from both scored_dims and held_dims`);
  }
  // No overlap.
  for (const d of scored) {
    if (held.includes(d)) issues.push(`dim ${d} listed in BOTH scored and held`);
  }

  // 2. Per-dim contract: scored → number 0–10 + non-empty justification.
  //                     held    → null score + null justification.
  for (const d of ALL_DIMS) {
    const score = parsed.dims?.[d];
    const j = parsed.justifications?.[d];
    const isScored = scored.includes(d);
    const isHeld = held.includes(d);

    if (isScored) {
      if (typeof score !== 'number' || score < 0 || score > 10) {
        issues.push(`${d} (scored) — score out of range or non-numeric: ${score}`);
      }
      if (typeof j !== 'string' || j.trim().length < 20) {
        issues.push(`${d} (scored) — justification missing or too short (need ≥20 chars)`);
      } else if (j.length > 320) {
        issues.push(`${d} justification too long (${j.length} > 320)`);
      }
    } else if (isHeld) {
      if (score != null) issues.push(`${d} (held) — score must be null, got ${score}`);
      if (j != null) issues.push(`${d} (held) — justification must be null`);
    }
  }

  // 3. Pre-tournament phase contract: held must include {result, process, momentum};
  //    scored must include {squad, coherence}. (Either order acceptable inside arrays.)
  if (parsed.phase === 'pre_tournament') {
    for (const d of ['result', 'process', 'momentum']) {
      if (!held.includes(d)) issues.push(`pre_tournament — ${d} must be held, found in: ${scored.includes(d) ? 'scored' : 'neither'}`);
    }
    for (const d of ['squad', 'coherence']) {
      if (!scored.includes(d)) issues.push(`pre_tournament — ${d} must be scored, found in: ${held.includes(d) ? 'held' : 'neither'}`);
    }
  }

  // 4. Reasoning prose: 60–180 words, voice lint.
  const reasoning = parsed.reasoning ?? '';
  const wordCount = reasoning.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < 60 || wordCount > 180) {
    issues.push(`reasoning ${wordCount} words (need 60–180)`);
  }
  for (const { re, label } of PROPHECY_LINT) {
    if (re.test(reasoning)) issues.push(`voiceLint: ${label}`);
  }

  return { ok: issues.length === 0, issues };
}

// ============================================================================
// editorial_composite — SERVER-SIDE flat mean over SCORED dims only.
// The model's number is not used here (it doesn't produce one); we
// compute it from the dim values to ensure the composite reflects only
// the dims actually scored.
// ============================================================================
export function computeEditorialComposite(parsed) {
  const scored = parsed.scored_dims ?? [];
  if (scored.length === 0) return null;
  const values = scored.map((d) => parsed.dims?.[d]).filter((v) => typeof v === 'number');
  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.round(mean * 10) / 10;
}

// ============================================================================
// Top-level: assemble + generate + validate + composite. NO DB write.
// Caller decides whether to insert into ranking_entries (editor-gated).
// ============================================================================
export async function runTeamPowerScorer({ teamId, phase = 'pre_tournament' }) {
  const envelope = await assembleTeamEnvelope({ teamId, phase });
  if (!envelope) {
    return { ok: false, error: 'team_not_found', teamId };
  }

  const gen = await generateScore(envelope);
  if (!gen.ok) {
    return { ok: false, teamId, envelope, error: gen.error, raw: gen.raw };
  }

  const validation = validateScore(gen.parsed);
  const editorial_composite = computeEditorialComposite(gen.parsed);

  return {
    ok: true,
    teamId,
    team_name: envelope.team.name,
    phase,
    envelope,
    parsed: gen.parsed,
    editorial_composite,
    validation,
    usage: gen.usage,
  };
}
