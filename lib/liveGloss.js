// lib/liveGloss.js — AI Live Key Moments gloss (V1).
//
// One sentence of natural-language gloss appended UNDER a structured
// match-event row on the live feed. The structured row is the
// authoritative line ("64' GOAL — France — A. Diallo"); the gloss adds
// editorial reading. This is the highest-risk AI surface in the product:
// unedited, live, in-flight. The guardrails are load-bearing.
//
// THIS FILE IS PURE. Three exported pieces:
//   buildGlossEnvelope(event, matchContext) → envelope object
//   generateGloss(envelope) → { gloss: string|null } (calls Anthropic)
//   validateGloss(gloss, envelope) → { ok, reason }
//
// generateGloss is the only side-effecting function (one API call). The
// caller decides what to do with the result. validation gates run AFTER
// generation; a failed validation drops the gloss → null. A null gloss
// is the honest fallback; the structured row always stands alone.
//
// Qualifying events for V1 (caller's responsibility to filter, but the
// canonical list is here so the dry-run + future live wiring agree):
//   - Goals (event_type='Goal', any detail except 'Missed Penalty')
//   - Red cards (event_type='Card' AND detail='Red Card')
//   - Penalties awarded (event_type='Var' AND detail contains 'Penalty')
//   - VAR-overturns (event_type='Var' AND detail contains 'Goal'/'Cancel')
// NOT yellows, NOT subs. ALL players (no name filter). Notable-sub
// glossing via Power Rankings is V1.1, explicitly out of scope.

import Anthropic from '@anthropic-ai/sdk';

// Inherit the proven grounding helpers from the Brief so the gloss
// gate behavior matches the Brief's hallucination gate at the
// primitive level. Exports added to lib/aiBrief.js this slice; no
// functional change to the Brief itself.
import {
  fold,
  tokenizeName,
  findReferencedNames,
  SENTENCE_START_OK,
  COMMON_PROSE_CAPS,
} from './aiBrief.js';

// ============================================================================
// LOCKED V1 SYSTEM PROMPT. Bound to the spec. Edits go through Derik.
// ============================================================================
export const SYSTEM_PROMPT = `You are a Sportsvyn live reporter writing a single-sentence gloss on a key moment that JUST happened in a match in progress. Your sentence will be clearly labeled as auto-generated and appears beneath the factual event row on the live feed. You are NOT predicting, NOT recommending, NOT recapping the whole match — you give readers one sharp, specific line that reads the moment as it happens.

The match is STILL IN PROGRESS. You do not know how it ends. Never imply you do.

HARD CONSTRAINTS:
- Exactly ONE sentence. Maximum 30 words. Shorter is better.
- Every claim must be derivable from the data provided. Do not invent details ("his second of the night" unless the data shows a prior goal; never name a player not in the event or context).
- Do NOT include any biographical detail about a player that is not present in the data provided — no academy/club of origin, age, nationality beyond the team they're playing for, prior career, transfer history, injury history, or "first goal since" claims. You know nothing about these players beyond what the data gives you. Describe only what happened in THIS match.
- Render player names EXACTLY as they appear in the data. Never expand initials to full first names (if the data says "D. Olmo", write "Olmo" or "D. Olmo", never "Dani Olmo").
- NO predictions about the rest of this match or any future match. Banned: "from here," "will need to," "look certain," "should see this out," anything forecasting what happens next.
- NO recommendation or betting lean of any kind.
- NO opinion on who is the better player or team. Describe the moment, don't rate the people.
- NO hedging ("seemed to," "appeared to") and NO clichés ("a tale of two halves," "the beautiful game," "against the run of play" unless the data genuinely supports it).
- Do NOT restate the scoreline (no "makes it 3-2", no "3-1 to Mexico"). You MAY say a team "levels" / "pulls level" / "equalizes" for an equalizing goal — that is standard and fine. What you must NOT do is describe the size of a LEAD in words: no "two up", "two-goal cushion", "further ahead", "extending the advantage", "three clear". The score and margin are shown beside your line. You MAY note which goal it was in sequence ("Mexico's fifth", "a third for the hosts") when it carries genuine editorial weight, but never the margin between the teams.
- Use the context (score, minute, prior events) to make the line SPECIFIC to this game — that is the entire value. "France turn sustained pressure into the lead" beats "France score."
- If there is nothing true and specific to say, return null. A missing gloss is better than a padded or generic one.

EXAMPLES OF THE MARGIN RULE:
  WRONG: "restoring Mexico's two-goal cushion just after the break"
  RIGHT: "Jiménez answers Serbia's own goal immediately after the break"
  WRONG: "puts Ivory Coast further ahead with six minutes left"
  RIGHT: "Diallo strikes again for Ivory Coast with six minutes left"
  WRONG: "extending Czech Republic's advantage"
  RIGHT: "Visinsky strikes again for Czech Republic"
(Note: ordinals like "a fifth", "Mexico's fifth" stay allowed — those describe the moment, not the margin. And "levels" / "equalizes" stay allowed per the rule above.)

OUTPUT SCHEMA (strict JSON): { "gloss": "string (<=30 words) OR null" }`;

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 200; // 30-word output = ~40-50 tokens; 200 = comfortable ceiling

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ============================================================================
// buildGlossEnvelope — assembles the small data payload the model sees.
//
// Inputs:
//   event = the qualifying match_events row {
//     id, minute, minute_extra, event_type, detail,
//     team_side ('home'|'away'), player_name, assist_name, ...
//   }
//   matchContext = {
//     match: { league_name, stage, home_name, home_abbreviation,
//              away_name, away_abbreviation },
//     events: ALL events for the match ordered by minute (asc) then id (asc).
//     prematch_angle: optional one-line context string, null if absent.
//   }
//
// score_at_moment is computed by counting goals in `events` up to and
// including the current event. Own goals are credited to the OPPOSING
// team (API-Sports's team_side on an OG is the conceding side).
// ============================================================================
export function buildGlossEnvelope(event, matchContext) {
  const { match, events, prematch_angle = null } = matchContext;

  // Recent events: up to 5 events strictly BEFORE the current moment, in
  // chronological order (we want the run-of-play context, not the future).
  const idx = (events ?? []).findIndex((e) => e.id === event.id);
  const before = idx >= 0 ? (events ?? []).slice(0, idx) : (events ?? []);
  const recent = before.slice(-5);

  return {
    match: {
      league: match.league_name ?? null,
      stage: match.stage ?? null,
      home: { name: match.home_name, code: match.home_abbreviation ?? null },
      away: { name: match.away_name, code: match.away_abbreviation ?? null },
    },
    state_at_moment: {
      minute: event.minute,
      score: scoreAt(event, events ?? []),
      period: minuteToPeriod(event.minute),
    },
    the_moment: {
      type: event.event_type,
      detail: event.detail ?? null,
      minute: event.minute,
      team: event.team_side === 'home' ? match.home_name : match.away_name,
      player: event.player_name ?? null,
      assist: event.assist_name ?? null,
    },
    recent_events: recent.map((e) => ({
      minute: e.minute,
      type: e.event_type,
      detail: e.detail ?? null,
      team: e.team_side === 'home' ? match.home_name : match.away_name,
      player: e.player_name ?? null,
      assist: e.assist_name ?? null,
    })),
    prematch_angle,
  };
}

// Count goals in chronological order up to and including the current
// event. team_side from API-Sports is the SCORING (benefiting) team —
// for own goals, this is already the opposing team to the player who
// hit the ball into their own net. Empirically verified against Mexico
// vs Serbia 5-1 on prod (2026-06-04): two own goals by Serbian
// players, team_side stamped 'home' (Mexico) on both, and the actual
// scoreboard shows Mexico 5 (incl. the 2 OGs) – Serbia 1. So do NOT
// flip own-goal team_side; trust the feed. (Earlier dry-run had a
// flip in this function — that's what produced the spurious 3-3 state
// at 90'. Removed.)
function scoreAt(currentEvent, allEvents) {
  let home = 0;
  let away = 0;
  for (const e of allEvents) {
    const isGoal = e.event_type === 'Goal' && e.detail !== 'Missed Penalty';
    if (isGoal) {
      if (e.team_side === 'home') home++;
      else if (e.team_side === 'away') away++;
    }
    if (e.id === currentEvent.id) break;
  }
  return { home, away };
}

function minuteToPeriod(minute) {
  if (minute == null) return null;
  if (minute <= 45) return '1H';
  return '2H';
}

// ============================================================================
// generateGloss — single Anthropic call. Returns { gloss: string|null }.
//
// JSON discipline: uses Anthropic's `output_format` with a JSON Schema
// via the BETA Messages API. The schema constrains the model's output
// shape at the API level; the model must produce JSON matching it.
// (The OpenAI-style `response_format: { type: 'json_object' }` is NOT
// supported by Anthropic; the equivalent is `output_format` with
// type='json_schema'. Assistant-prefill is also rejected by
// claude-sonnet-4-6 — "This model does not support assistant message
// prefill" — so output_format is the only reliable path.) See:
// https://platform.claude.com/docs/en/build-with-claude/structured-outputs
//
// On parse/schema failure → null gloss with reason. No retries — the
// structured row is the authoritative line; an honest gap beats a
// brittle generator.
// ============================================================================
const GLOSS_SCHEMA = {
  type: 'object',
  properties: {
    gloss: {
      type: ['string', 'null'],
      description: 'A single sentence ≤30 words describing the moment, or null if there is nothing true and specific to say.',
    },
  },
  required: ['gloss'],
  additionalProperties: false,
};

export async function generateGloss(envelope) {
  if (!client) {
    throw new Error('ANTHROPIC_API_KEY missing — cannot call Claude');
  }

  const userContent = `MOMENT + CONTEXT:\n\n${JSON.stringify(envelope, null, 2)}`;

  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      output_format: {
        type: 'json_schema',
        schema: GLOSS_SCHEMA,
      },
    });
  } catch (err) {
    return { gloss: null, raw: null, error: String(err?.message ?? err) };
  }

  const text = response?.content?.[0]?.text ?? '';
  let parsed;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return { gloss: null, raw: text, error: 'json_parse_failure' };
  }

  const gloss = typeof parsed?.gloss === 'string'
    ? parsed.gloss.trim()
    : (parsed?.gloss === null ? null : null);

  return { gloss: gloss || null, raw: text, usage: response.usage };
}

// ============================================================================
// validateGloss — three gates. Returns { ok: bool, reason?: string }.
//
// Run AFTER generateGloss. A failed gate → drop the gloss (null
// downstream). The caller must not retry into the page; the structured
// row stands alone.
// ============================================================================

// Gate 1: word count ≤ 30
function gateLength(gloss) {
  const words = gloss.trim().split(/\s+/).filter(Boolean);
  if (words.length > 30) {
    return { pass: false, reason: `length: ${words.length} words > 30` };
  }
  return { pass: true };
}

// Gate 2: forecast/recommendation language. Casts a wide net — false
// positives drop the gloss, which is acceptable per "missing gloss
// beats a padded one." If the dry-run flags too many real glosses,
// tighten the patterns.
const FORECAST_PATTERNS = [
  // Forecast / prediction
  { re: /\bwill\b/i,                       label: 'forecast: "will"' },
  { re: /\bcertain to\b/i,                 label: 'forecast: "certain to"' },
  { re: /\blook(?:s|ed)? certain\b/i,      label: 'forecast: "look certain"' },
  { re: /\bset to\b/i,                     label: 'forecast: "set to"' },
  { re: /\bexpected to\b/i,                label: 'forecast: "expected to"' },
  { re: /\bfrom here\b/i,                  label: 'forecast: "from here"' },
  { re: /\bsee this out\b/i,               label: 'forecast: "see this out"' },
  { re: /\bgoing forward\b/i,              label: 'forecast: "going forward"' },
  { re: /\brest of (?:the )?(?:match|game|half)\b/i, label: 'forecast: "rest of the (match|half)"' },
  // Prescription / recommendation
  { re: /\bneeds? to\b/i,                  label: 'prescription: "need(s) to"' },
  { re: /\bmust\b/i,                       label: 'prescription: "must"' },
  { re: /\bhas to\b/i,                     label: 'prescription: "has to"' },
  { re: /\bhave to\b/i,                    label: 'prescription: "have to"' },
  // Hedge (inherited from Brief's banned-constructions for consistency)
  { re: /\bshould have\b/i,                label: 'hedge: "should have"' },
  { re: /\bcould have\b/i,                 label: 'hedge: "could have"' },
  { re: /\bwould have\b/i,                 label: 'hedge: "would have"' },
  { re: /\bseemed to\b/i,                  label: 'hedge: "seemed to"' },
  { re: /\bappeared to\b/i,                label: 'hedge: "appeared to"' },
  { re: /\bperhaps\b/i,                    label: 'hedge: "perhaps"' },
  { re: /\barguably\b/i,                   label: 'hedge: "arguably"' },
];

function gateForecastLanguage(gloss) {
  const issues = [];
  for (const { re, label } of FORECAST_PATTERNS) {
    if (re.test(gloss)) issues.push(label);
  }
  if (issues.length === 0) return { pass: true };
  return { pass: false, reason: `forecast/hedge: ${issues.join('; ')}` };
}

// Gate 3: grounding. Every proper-noun-shaped token in the gloss must
// be present in the envelope's source tokens (player names, team
// names, league, etc.) OR be a common-prose capitalized word
// (calendar names, "Goal" / "Final" / etc.) OR a sentence-starting
// preposition. Same primitive as the Brief's hallucination gate.
function collectGlossSourceTokens(envelope) {
  const tokens = new Set();
  tokenizeName(envelope.match?.home?.name, tokens);
  tokenizeName(envelope.match?.home?.code, tokens);
  tokenizeName(envelope.match?.away?.name, tokens);
  tokenizeName(envelope.match?.away?.code, tokens);
  tokenizeName(envelope.match?.league, tokens);
  tokenizeName(envelope.the_moment?.team, tokens);
  tokenizeName(envelope.the_moment?.player, tokens);
  tokenizeName(envelope.the_moment?.assist, tokens);
  for (const e of envelope.recent_events ?? []) {
    tokenizeName(e.team, tokens);
    tokenizeName(e.player, tokens);
    tokenizeName(e.assist, tokens);
  }
  return tokens;
}

function gateGrounding(gloss, envelope) {
  const allowed = collectGlossSourceTokens(envelope);
  const referenced = findReferencedNames(gloss);
  const ungrounded = [];
  for (const name of referenced) {
    const tokens = name.split(/\s+/);
    const bad = [];
    for (const tok of tokens) {
      const clean = tok.replace(/[^a-zA-ZÀ-ſ'']/g, '');
      if (clean.length < 2) continue;
      const folded = fold(clean);
      if (SENTENCE_START_OK.has(folded)) continue;
      if (COMMON_PROSE_CAPS.has(folded)) continue;
      if (!allowed.has(folded)) bad.push(clean);
    }
    if (bad.length > 0) ungrounded.push(name);
  }
  if (ungrounded.length === 0) return { pass: true };
  return { pass: false, reason: `ungrounded: ${ungrounded.join(', ')}` };
}

export function validateGloss(gloss, envelope) {
  if (gloss == null) {
    // null gloss from the model is a valid "no gloss" — not a failure.
    return { ok: true, kept: false, reason: 'model_returned_null' };
  }
  const length = gateLength(gloss);
  if (!length.pass) return { ok: false, kept: false, reason: length.reason };
  const forecast = gateForecastLanguage(gloss);
  if (!forecast.pass) return { ok: false, kept: false, reason: forecast.reason };
  const ground = gateGrounding(gloss, envelope);
  if (!ground.pass) return { ok: false, kept: false, reason: ground.reason };
  return { ok: true, kept: true };
}

// ============================================================================
// Convenience: V1 qualifying-event predicate. The dry-run uses this so
// the canonical list lives next to the generator. Future live wiring
// uses the same predicate.
// ============================================================================
export function isQualifyingEvent(event) {
  if (!event?.is_current) return false;
  const t = event.event_type;
  const d = event.detail ?? '';
  if (t === 'Goal') {
    // Glossing missed penalties is V1 out-of-scope (different
    // editorial beat — a near-miss isn't a "key moment" in the same
    // way). Drop here so the dry-run + future live agree.
    if (/missed/i.test(d)) return false;
    return true;
  }
  if (t === 'Card' && /red card/i.test(d)) return true;
  if (t === 'Var') {
    // Penalty awarded after review + goal-disallowed/cancelled both
    // qualify.
    if (/penalty/i.test(d)) return true;
    if (/goal/i.test(d) || /cancel/i.test(d)) return true;
  }
  return false;
}
