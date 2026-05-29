// lib/aiWatchScore.js — Tier 1 Watch Score generator.
//
// Pre-match editorial prediction. Five dimensions (STAKES, QUALITY,
// NARRATIVE, DRAMA, MOMENT), each 0.0-10.0 one decimal. The composite is
// the flat mean computed SERVER-SIDE; the model never supplies it.
//
// Five validation gates:
//   1. JSON structure        → 1 retry → null-suppress fallback
//   2. Score bounds          → each dim 0.0-10.0, one decimal precision
//   3. Composite              → computed server-side (no model trust)
//   4. Friendly-stakes sanity → if league/stage is a friendly and STAKES > 7,
//                              flag with calibration reminder for retry
//   5. Banned constructions  → hedges + opinion verbs + future-match
//                              predictions (reused from the Brief)
//
// Note word counts (≤25 per dimension) and summary length (40-70 words)
// are also enforced in gate 1 since they're per-spec hard constraints
// that fit naturally with structural validation.
//
// validation_status='suppressed' is set when the model fails twice or any
// gate can't clear. A faked deterministic Watch Score is WORSE than no
// score, so the render layer hides the block entirely when this fires.

import Anthropic from '@anthropic-ai/sdk';
import { apiSports } from './apiSports.js';

// ============================================================================
// LOCKED SYSTEM PROMPT — DO NOT EDIT. Bound to the spec.
// ============================================================================
export const SYSTEM_PROMPT = `You are Sportsvyn's pre-match Watch Score analyst. Before a match kicks off,
you assign it a Watch Score: an editorial prediction of how worth-watching
the match is for the Considered Sports Fan. The score is five dimensions,
each 0.0-10.0, and the final composite is their flat mean.

This is an EDITORIAL PREDICTION made before the match. You are not reporting
what happened — the match has not been played. You are forecasting its value.
The score does not change retroactively based on the result.

THE FIVE DIMENSIONS (each 0.0-10.0, one decimal):

STAKES — What is on the line. For a World Cup match this scales by stage:
  group match-day 1 ~5.5-7.0; match-day 2 ~6.0-8.0; match-day 3 ~7.0-9.0;
  round of 16 ~8.0-9.0; quarterfinal onward 9.0+. For a FRIENDLY or
  EXHIBITION, STAKES is LOW — typically 4.0-5.5 — because nothing is on the
  line competitively. Do not inflate STAKES for a friendly. A pre-tournament
  friendly may earn the upper end (~5.5) if it's clearly preparation for a
  major tournament, but it is still a friendly.

QUALITY — The expected level of play. Elite-vs-elite sides (top-5 national
  teams) approach 9.0+. A solid-but-not-elite matchup sits 6.0-7.5. Mismatches
  where one side is far weaker pull QUALITY down. Judge the baseline craft
  level both teams will bring.

NARRATIVE — Story value. Rivalries, rematches of significant fixtures,
  generational milestones (a star's last tournament), a nation's historic run,
  manager arcs. A match between two sides with no rivalry and no storyline is
  NARRATIVE ~5.0 even if the football is good.

DRAMA — Projected competitive balance — how CLOSE the contest figures to be,
  not how good. Two evenly-matched sides score high; a heavy favorite against
  a struggling side scores lower even if both are quality teams. Be honest;
  do not pump DRAMA to inflate the composite.

MOMENT — Cultural and historical weight. A World Cup Final is 10.0; a
  third-place match ~6.0; a group-stage match between mid-tier sides ~5.0.
  A friendly carries low MOMENT unless it has genuine occasion (a farewell
  match, a milestone) — typically 4.0-5.5.

OUTPUT — strict JSON only, no markdown fences, no preamble, exactly:
{
  "stakes":    {"score": 0.0, "note": "one sentence, <=25 words, defending the score"},
  "quality":   {"score": 0.0, "note": "..."},
  "narrative": {"score": 0.0, "note": "..."},
  "drama":     {"score": 0.0, "note": "..."},
  "moment":    {"score": 0.0, "note": "..."},
  "summary":   "2-3 sentences, 40-70 words, the overall verdict"
}

RULES:
- Each note defends its score in one plain, specific sentence. State the
  reason, not adjectives. "A friendly carries no competitive consequence"
  beats "Low-stakes clash!"
- Do NOT supply a composite — Sportsvyn computes the flat mean server-side.
- No hype, no exclamation, no second-person ("you'll love..."). No predictions
  about other matches. Dry, specific, honest. A low score honestly defended is
  more valuable than an inflated one.
- Score only from what the match context supports. Do not invent rivalries,
  stakes, or storylines that aren't real. If a dimension is genuinely
  middling, say so and score it middling.`;

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;
const DIMENSIONS = ['stakes', 'quality', 'narrative', 'drama', 'moment'];

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ============================================================================
// Envelope assembly — pre-match only. No events, no lineups, no stats.
// ============================================================================

export function assembleWatchScorePrompt(matchData) {
  return prune(matchData);
}

function prune(value) {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const arr = value.map(prune).filter((v) => v !== undefined);
    return arr.length ? arr : undefined;
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const p = prune(v);
      if (p !== undefined) out[k] = p;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value;
}

function normalizeFromApiSports(fixture) {
  const data = {
    match: {
      league: fixture.league?.name ?? null,
      round: fixture.league?.round ?? null,
      kickoff_at: fixture.fixture?.date ?? null,
      venue: fixture.fixture?.venue?.name ?? null,
      status: fixture.fixture?.status?.short ?? null,
      teams: {
        home: fixture.teams?.home?.name,
        away: fixture.teams?.away?.name,
      },
    },
  };
  return assembleWatchScorePrompt(data);
}

// ============================================================================
// Model call + JSON extraction
// ============================================================================

function extractText(response) {
  const block = response?.content?.find((b) => b.type === 'text');
  return block?.text ?? '';
}

function extractJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch {}
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  return null;
}

async function callModel(envelope, retryInstruction = null) {
  if (!client) throw new Error('ANTHROPIC_API_KEY missing — cannot call Claude');
  const prefix = retryInstruction
    ? `${retryInstruction}\n\nMatch context:\n`
    : 'Match context:\n';
  const userContent = `${prefix}${JSON.stringify(envelope, null, 2)}`;

  return client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });
}

// ============================================================================
// Helpers
// ============================================================================

function countWords(s) {
  if (!s || typeof s !== 'string') return 0;
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function isFriendly(envelope) {
  const league = (envelope.match?.league ?? '').toLowerCase();
  const round = (envelope.match?.round ?? '').toLowerCase();
  return /\bfriendl/.test(league) || /\bfriendl/.test(round) || /\bexhibition\b/.test(league + ' ' + round);
}

function collectAllProse(parsed) {
  const parts = DIMENSIONS.map((d) => parsed[d]?.note).filter((s) => typeof s === 'string');
  if (typeof parsed.summary === 'string') parts.push(parsed.summary);
  return parts.join(' ');
}

// ============================================================================
// Validation gates
// ============================================================================

// Gate 1 — JSON structure + per-spec hard constraints (note ≤25 words,
// summary 40-70). Combining structural shape with the per-spec word limits
// keeps the retry signal coherent.
function gateJsonStructure(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { pass: false, reason: 'response did not parse as JSON object' };
  }
  const issues = [];
  for (const d of DIMENSIONS) {
    const dim = parsed[d];
    if (!dim || typeof dim !== 'object') {
      issues.push(`${d} missing or not object`);
      continue;
    }
    if (typeof dim.score !== 'number' || Number.isNaN(dim.score)) {
      issues.push(`${d}.score not a number`);
    }
    if (typeof dim.note !== 'string' || !dim.note.trim()) {
      issues.push(`${d}.note missing or empty`);
    } else {
      const wc = countWords(dim.note);
      if (wc > 25) issues.push(`${d}.note ${wc} words (need ≤25)`);
    }
  }
  if (typeof parsed.summary !== 'string' || !parsed.summary.trim()) {
    issues.push('summary missing or empty');
  } else {
    const wc = countWords(parsed.summary);
    if (wc < 40 || wc > 70) issues.push(`summary ${wc} words (need 40-70)`);
  }
  return { pass: issues.length === 0, reason: issues.join('; ') };
}

// Gate 2 — score bounds + one-decimal precision
function gateScoreBounds(parsed) {
  const issues = [];
  for (const d of DIMENSIONS) {
    const s = Number(parsed[d]?.score);
    if (!Number.isFinite(s)) continue; // already flagged by gate 1
    if (s < 0 || s > 10) {
      issues.push(`${d} score ${s} out of 0.0-10.0`);
      continue;
    }
    const decimalDistance = Math.abs(s * 10 - Math.round(s * 10));
    if (decimalDistance > 0.05) {
      issues.push(`${d} score ${s} not one-decimal precision`);
    }
  }
  return { pass: issues.length === 0, reason: issues.join('; ') };
}

// Gate 3 — composite computed server-side. Always passes structurally;
// this gate exists to record that we did NOT trust a model-supplied number.
function gateComposite(_parsed) {
  return { pass: true, reason: '' };
}

// Gate 4 — friendly stakes sanity
function gateFriendlyStakes(parsed, envelope) {
  if (!isFriendly(envelope)) return { pass: true, reason: '' };
  const stakes = Number(parsed.stakes?.score);
  if (!Number.isFinite(stakes)) return { pass: true, reason: '' };
  if (stakes > 7) {
    return {
      pass: false,
      reason: `friendly STAKES ${stakes.toFixed(1)} > 7 (calibration: friendlies are 4.0-5.5, even a pre-tournament friendly tops at ~5.5)`,
    };
  }
  return { pass: true, reason: '' };
}

// Gate 5 — banned constructions (reused from the Brief)
const BANNED_PATTERNS = [
  { re: /\bshould have\b/i,   label: 'hedge: "should have"' },
  { re: /\bcould have\b/i,    label: 'hedge: "could have"' },
  { re: /\bwould have\b/i,    label: 'hedge: "would have"' },
  { re: /\bought to\b/i,      label: 'opinion: "ought to"' },
  { re: /\bdeserved to\b/i,   label: 'opinion: "deserved to"' },
  { re: /\bdeserving\b/i,     label: 'opinion: "deserving"' },
  { re: /\bunlucky\b/i,       label: 'opinion: "unlucky"' },
  { re: /\bbeen lucky\b/i,    label: 'opinion: "been lucky"' },
  { re: /\bmust now\b/i,      label: 'prescription: "must now"' },
  { re: /\bneeds? to\b/i,     label: 'prescription: "needs to"' },
  { re: /\bsupposed to\b/i,   label: 'hedge: "supposed to"' },
  { re: /\barguably\b/i,      label: 'hedge: "arguably"' },
  { re: /\bperhaps\b/i,       label: 'hedge: "perhaps"' },
  { re: /\bseemed to\b/i,     label: 'hedge: "seemed to"' },
  { re: /\bappeared to\b/i,   label: 'hedge: "appeared to"' },
  { re: /!\s*$/m,             label: 'banned: trailing exclamation' },
  { re: /\byou(?:'ll|r)\b/i,  label: 'banned: second-person addressing the reader' },
];

function gateBannedConstructions(parsed) {
  const text = collectAllProse(parsed);
  const issues = [];
  for (const { re, label } of BANNED_PATTERNS) {
    if (re.test(text)) issues.push(label);
  }
  return { pass: issues.length === 0, reason: issues.join('; ') };
}

function runAllGates(parsed, envelope) {
  const results = [];
  const s = gateJsonStructure(parsed);
  results.push({ name: 'json_structure', ...s });
  if (!s.pass) return results;
  results.push({ name: 'score_bounds', ...gateScoreBounds(parsed) });
  results.push({ name: 'composite_server_side', ...gateComposite(parsed) });
  results.push({ name: 'friendly_stakes_sanity', ...gateFriendlyStakes(parsed, envelope) });
  results.push({ name: 'banned_constructions', ...gateBannedConstructions(parsed) });
  return results;
}

// ============================================================================
// Composite — flat mean of the 5 dimension scores, one decimal.
// Computed server-side; the model never supplies this number.
// ============================================================================

function computeComposite(parsed) {
  const scores = DIMENSIONS.map((d) => Number(parsed[d]?.score));
  if (scores.some((s) => !Number.isFinite(s))) return null;
  const sum = scores.reduce((a, b) => a + b, 0);
  return Math.round((sum / 5) * 10) / 10;
}

// ============================================================================
// Suppress fallback — null + flag, render layer hides the block.
// A faked deterministic score is worse than no score.
// ============================================================================
function suppressed() {
  return {
    stakes: null,
    quality: null,
    narrative: null,
    drama: null,
    moment: null,
    summary: null,
    composite: null,
    suppress: true,
  };
}

// ============================================================================
// Retry instruction — failure-type-aware. The friendly-stakes case gets a
// specific calibration reminder so the model doesn't just lower the number
// without re-reading the dimension definition.
// ============================================================================
function buildRetryInstruction(gates) {
  const failed = gates.filter((g) => !g.pass);
  if (!failed.length) return '';

  const friendlyStakes = failed.find((g) => g.name === 'friendly_stakes_sanity');
  if (friendlyStakes) {
    const others = failed.filter((g) => g.name !== 'friendly_stakes_sanity');
    const otherText = others.length
      ? ` Also address: ${others.map((g) => `${g.name}: ${g.reason}`).join(' | ')}.`
      : '';
    return `Your STAKES score is too high for this match. ${friendlyStakes.reason}. Re-read the STAKES dimension definition: a friendly carries no competitive consequence, the cap is ~5.5. Lower STAKES into the 4.0-5.5 band and rewrite its note to defend that calibration.${otherText}`;
  }

  const reasons = failed.map((g) => `${g.name}: ${g.reason}`).join(' | ');
  return `Your previous response failed validation: ${reasons}. Re-read the system constraints. Output STRICT JSON with the exact schema. Each note must be ≤25 words. The summary must be 40-70 words. Each score must be 0.0-10.0 with one-decimal precision.`;
}

// ============================================================================
// Orchestration
// ============================================================================

export async function generateWatchScore(matchData) {
  const envelope = assembleWatchScorePrompt(matchData);
  const attempts = [];
  let lastRaw = null;

  async function doAttempt(attemptN, retryInstruction = null) {
    let response = null;
    let parsed = null;
    let error = null;
    try {
      response = await callModel(envelope, retryInstruction);
      lastRaw = response;
      const text = extractText(response);
      parsed = extractJson(text);
    } catch (err) {
      error = String(err?.message ?? err);
    }
    const gates = error
      ? [{ name: 'api_call', pass: false, reason: error }]
      : runAllGates(parsed, envelope);
    const entry = {
      attempt: attemptN,
      parsed_output: parsed ?? null,
      composite: parsed ? computeComposite(parsed) : null,
      error,
      gates,
    };
    attempts.push(entry);
    return entry;
  }

  const a1 = await doAttempt(1);
  if (a1.parsed_output && a1.gates.every((g) => g.pass)) {
    return finalize({ parsed: a1.parsed_output, attempts, lastRaw, validation_status: 'passed', envelope });
  }

  const retryInstruction = buildRetryInstruction(a1.gates);
  const a2 = await doAttempt(2, retryInstruction);
  if (a2.parsed_output && a2.gates.every((g) => g.pass)) {
    return finalize({ parsed: a2.parsed_output, attempts, lastRaw, validation_status: 'passed', envelope });
  }

  const sup = suppressed();
  return {
    ...sup,
    attempts,
    validation_status: 'suppressed',
    model: MODEL,
    raw_response: lastRaw,
  };
}

function finalize({ parsed, attempts, lastRaw, validation_status }) {
  const composite = computeComposite(parsed);
  return {
    stakes:    parsed.stakes,
    quality:   parsed.quality,
    narrative: parsed.narrative,
    drama:     parsed.drama,
    moment:    parsed.moment,
    summary:   parsed.summary,
    composite,
    suppress:  false,
    attempts,
    validation_status,
    model: MODEL,
    raw_response: lastRaw,
  };
}

export async function generateWatchScoreForFixture(fixtureId) {
  const fixtures = await apiSports.fixture(fixtureId);
  const f = fixtures[0];
  if (!f) throw new Error(`API-Sports returned no fixture for id ${fixtureId}`);
  const envelope = normalizeFromApiSports(f);
  const result = await generateWatchScore(envelope);
  return { ...result, envelope };
}
