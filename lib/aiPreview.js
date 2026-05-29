// lib/aiPreview.js — pre-match Preview generator.
//
// Two-phase, gated on DATA PRESENCE not time:
//   Phase 1 "thin"  — fixture basics only (teams, competition, venue, kickoff).
//                     Short scene-set, restrained, no invented stakes or players.
//   Phase 2 "rich"  — lineups OR form OR odds present (real analytical substance).
//                     NOT IMPLEMENTED in this slice — prompt is TODO. Calling
//                     generatePreview() with rich-eligible data throws so we
//                     don't silently fall back to thin when the data is there.
//
// computeReadiness() runs first; the result selects the prompt. For
// USA-Senegal pre-match today (no lineups, no form, no odds), readiness
// returns 'thin' and the path runs end-to-end.
//
// Lighter validation gates than the Brief — there's less for a thin preview
// to get wrong, but the brand-defense rules (no hallucinated players, no
// invented stakes, no second-person/hype) still apply.

import Anthropic from '@anthropic-ai/sdk';
import { apiSports } from './apiSports.js';
import { sql } from './db.js';

// ============================================================================
// LOCKED Phase 1 (thin) SYSTEM PROMPT — DO NOT EDIT.
// ============================================================================
export const SYSTEM_PROMPT_THIN = `You are Sportsvyn's pre-match preview writer, producing a SHORT preview days
before a match when little match-specific data exists yet. Lineups are not
announced, form and odds may be unavailable. You are setting the scene, not
analyzing a contest you cannot yet see.

This preview WILL be replaced by a richer version once lineups, form, and odds
arrive. Your job now is a brief, honest scene-set — what the match is, why it's
on the calendar, what a viewer might reasonably look for. Nothing more.

HARD CONSTRAINTS:
- Length: a headline plus 2-3 SHORT paragraphs, 120-220 words of body total.
  A thin preview is short by design. Do NOT pad to fill space. If there is
  little to say, say little.
- Headline: 6-14 words, one line, factual and specific. Name the fixture and
  its context. No hype, no questions, no colons-as-drama.
- Paragraph 1: what the match is — the two teams, the competition or occasion
  (a friendly, a tournament tune-up, etc.), the venue and date if notable.
- Paragraph 2: why it's on the calendar — the genuine, factual context. For a
  pre-tournament friendly: roster evaluation, final preparation, a coach
  assessing options before a squad deadline. State only what is true of the
  occasion, not invented stakes.
- Paragraph 3 (optional): one honest "what to watch for" note — a selection
  question, a player getting a look, a tactical experiment — ONLY if it is
  genuinely supported by the occasion. Omit if you would have to invent it.

ABSOLUTE RULES:
- You do NOT have lineups, confirmed form, injury news, or odds. Do NOT
  reference any of them. Do not name a probable XI, do not claim who is
  injured, do not predict a result or scoreline, do not cite recent form you
  were not given.
- Do NOT invent stakes a friendly does not have. A friendly has no standings
  consequence; say so plainly if relevant, do not manufacture drama.
- Refer to any player by the name form available to you; if you have no roster
  data, refer to teams and known context only — do not list specific players
  from memory as if confirmed for this match.
- No hype, no second person ("you'll want to watch"), no rhetorical questions,
  no predictions about this or other matches. Dry, specific, restrained.
- Report only what the occasion genuinely supports. When uncertain whether
  something is true of THIS match, leave it out.

OUTPUT — strict JSON only, no markdown fences, no preamble:
{
  "headline": "string (6-14 words)",
  "subtitle": "string, one optional framing line, or null",
  "body": "string — 2-3 paragraphs separated by \\n\\n, 120-220 words total"
}`;

// Phase 2 rich prompt — DELIBERATELY UNSET. computeReadiness can still pick
// 'rich' when data is present; generatePreview throws so we don't silently
// downgrade rich-eligible matches to thin.
export const SYSTEM_PROMPT_RICH = null;

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ============================================================================
// Data envelope assembly
// ============================================================================

export function assemblePreviewPrompt(data) {
  return prune(data);
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

// Look up the (optional) Watch Score article for this match. Watch Score is
// editorial commentary, not raw analytical substance — its presence does NOT
// upgrade thin to rich per the readiness rule. We surface it in the envelope
// so the prompt CAN reference its tier when relevant, but it doesn't change
// the phase decision.
async function lookupWatchScore(matchId) {
  if (!matchId) return null;
  const rows = await sql`
    SELECT composite_score, watch_summary
    FROM articles
    WHERE match_id = ${matchId}
      AND type = 'preview'
      AND score_type = 'watch'
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function lookupMatchByApiSportsId(apiSportsId) {
  const rows = await sql`
    SELECT id FROM matches
    WHERE external_ids->>'api_sports' = ${String(apiSportsId)}
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

// Build a preview envelope from a fixture id. The thin path uses only
// match meta; the rich path (when implemented) would also fetch and
// include lineups / form / odds here.
export async function buildPreviewEnvelope(fixtureId) {
  const fixtures = await apiSports.fixture(fixtureId);
  const f = fixtures[0];
  if (!f) throw new Error(`API-Sports returned no fixture for id ${fixtureId}`);

  const matchId = await lookupMatchByApiSportsId(fixtureId);
  const watch = matchId ? await lookupWatchScore(matchId) : null;

  const data = {
    match: {
      home: f.teams?.home?.name,
      away: f.teams?.away?.name,
      league: f.league?.name ?? null,
      round: f.league?.round ?? null,
      kickoff_at: f.fixture?.date ?? null,
      venue: f.fixture?.venue?.name ?? null,
      status: f.fixture?.status?.short ?? null,
    },
    // optional richer signals; null in thin mode, populated when we
    // wire Phase 2 fetching
    lineups: null,
    form: null,
    odds: null,
    watch_score: watch
      ? { composite: Number(watch.composite_score), summary: watch.watch_summary }
      : null,
    _internal: { fixtureApiId: fixtureId, matchId },
  };
  return assemblePreviewPrompt(data);
}

// ============================================================================
// Readiness gate — DATA PRESENCE selects phase
// ============================================================================

export function computeReadiness(data) {
  const m = data.match ?? {};
  const present = {
    teams:        !!(m.home && m.away),
    competition:  !!m.league,
    venue:        !!m.venue,
    kickoff_at:   !!m.kickoff_at,
    lineups:      Array.isArray(data.lineups) && data.lineups.length > 0,
    form:         !!(data.form?.home || data.form?.away),
    odds:         !!data.odds,
    watch_score:  !!data.watch_score,
  };
  // Rich requires at least one of [lineups, form, odds] — real analytical
  // substance beyond fixture basics. Watch Score is editorial framing, not
  // substance, so it does NOT promote to rich on its own.
  const richSubstance = present.lineups || present.form || present.odds;
  return { phase: richSubstance ? 'rich' : 'thin', present };
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

async function callModel(systemPrompt, envelope, retryInstruction = null) {
  if (!client) throw new Error('ANTHROPIC_API_KEY missing — cannot call Claude');
  const prefix = retryInstruction ? `${retryInstruction}\n\nMatch context:\n` : 'Match context:\n';
  // Strip _internal before sending — that's our own bookkeeping, not the model's.
  const { _internal, ...sendable } = envelope;
  const userContent = `${prefix}${JSON.stringify(sendable, null, 2)}`;

  return client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  });
}

// ============================================================================
// Validation gates
// ============================================================================

function countWords(s) {
  if (!s || typeof s !== 'string') return 0;
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function countParagraphs(body) {
  if (!body || typeof body !== 'string') return 0;
  return body.split(/\n\n+/).map((p) => p.trim()).filter(Boolean).length;
}

// Gate 1 — JSON structure
function gateJsonStructure(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { pass: false, reason: 'response did not parse as JSON object' };
  }
  if (typeof parsed.headline !== 'string' || !parsed.headline.trim()) {
    return { pass: false, reason: 'headline missing or empty' };
  }
  if (!('subtitle' in parsed)) {
    return { pass: false, reason: 'subtitle key absent (must be string or null)' };
  }
  if (parsed.subtitle !== null && typeof parsed.subtitle !== 'string') {
    return { pass: false, reason: 'subtitle must be string or null' };
  }
  if (typeof parsed.body !== 'string' || !parsed.body.trim()) {
    return { pass: false, reason: 'body missing or empty' };
  }
  return { pass: true };
}

// Gate 2 — length envelope. Thin preview ENFORCES the ceiling so it can't pad.
function gateWordCounts(parsed) {
  const issues = [];
  const h = countWords(parsed.headline);
  if (h < 6 || h > 14) issues.push(`headline ${h} words (need 6-14)`);
  const b = countWords(parsed.body);
  if (b < 120 || b > 220) issues.push(`body ${b} words (need 120-220)`);
  const paras = countParagraphs(parsed.body);
  if (paras < 2 || paras > 3) issues.push(`body ${paras} paragraphs (need 2-3, separated by \\n\\n)`);
  if (parsed.subtitle) {
    const s = countWords(parsed.subtitle);
    if (s > 25) issues.push(`subtitle ${s} words (cap 25)`);
  }
  return { pass: issues.length === 0, reason: issues.join('; ') };
}

// Gate 3 — banned constructions. Adds preview-specific bans on top of the
// shared brand list (no second person, no rhetorical questions, no hype).
const BANNED_PATTERNS = [
  // Shared hedges / opinion verbs
  { re: /\bshould have\b/i,   label: 'hedge: "should have"' },
  { re: /\bcould have\b/i,    label: 'hedge: "could have"' },
  { re: /\bwould have\b/i,    label: 'hedge: "would have"' },
  { re: /\bdeserved to\b/i,   label: 'opinion: "deserved to"' },
  { re: /\bunlucky\b/i,       label: 'opinion: "unlucky"' },
  { re: /\bsupposed to\b/i,   label: 'hedge: "supposed to"' },
  { re: /\barguably\b/i,      label: 'hedge: "arguably"' },
  { re: /\bperhaps\b/i,       label: 'hedge: "perhaps"' },
  { re: /\bseemed to\b/i,     label: 'hedge: "seemed to"' },
  { re: /\bappeared to\b/i,   label: 'hedge: "appeared to"' },
  // Preview-specific: second person, hype, rhetorical questions, predictions
  { re: /\byou(?:'ll|r| will| should| can| might)\b/i, label: 'banned: second-person addressing reader' },
  { re: /\?/,                                          label: 'banned: rhetorical question' },
  { re: /!\s*(?:$|\n|"|}|<)/m,                         label: 'banned: trailing exclamation (hype)' },
  { re: /\bclash\b/i,         label: 'hype: "clash"' },
  { re: /\bshowdown\b/i,      label: 'hype: "showdown"' },
  { re: /\bblockbuster\b/i,   label: 'hype: "blockbuster"' },
  { re: /\bmust[- ]see\b/i,   label: 'hype: "must-see"' },
  // Predictions
  { re: /\bwill (?:win|lose|score|beat|prevail|advance)\b/i, label: 'banned: result prediction' },
  { re: /\bexpect\s+(?:a|the)?\s*(?:win|loss|goals?|victory)\b/i, label: 'banned: prediction language' },
];

function gateBannedConstructions(parsed) {
  const text = [parsed.headline, parsed.subtitle ?? '', parsed.body].filter(Boolean).join(' ');
  const issues = [];
  for (const { re, label } of BANNED_PATTERNS) {
    if (re.test(text)) issues.push(label);
  }
  return { pass: issues.length === 0, reason: issues.join('; ') };
}

// Gate 4 — name-form. For thin preview with no lineups in the envelope, ANY
// player-name-like phrase is a hallucination (we have no roster data to
// validate against). Allow team names, league/round labels, and the venue.
function fold(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function tokenizeInto(name, into) {
  if (!name) return;
  for (const tok of String(name).split(/[\s\-/]+/)) {
    const clean = tok.replace(/[^a-zA-ZÀ-ſ'']/g, '');
    if (clean.length >= 2) into.add(fold(clean));
  }
}

function collectAllowedTokens(envelope) {
  const tokens = new Set();
  tokenizeInto(envelope.match?.home, tokens);
  tokenizeInto(envelope.match?.away, tokens);
  tokenizeInto(envelope.match?.venue, tokens);
  tokenizeInto(envelope.match?.league, tokens);
  tokenizeInto(envelope.match?.round, tokens);
  // Watch Score summary is part of the model's source envelope — its
  // vocabulary is allowed in the output. Same logic as a Brief allowing
  // events/lineups content.
  if (envelope.watch_score?.summary) tokenizeInto(envelope.watch_score.summary, tokens);
  // No player names — thin preview has no roster context, so any
  // player-like reference still trips the gate.
  return tokens;
}

const SENTENCE_START_OK = new Set([
  'a','an','the','this','that','these','those','his','her','their','its','our','your','my',
  'after','before','during','despite','although','though','while','when','where','what',
  'home','away','first','second','third','final','both','either','neither','one','two','three',
  'for','as','in','on','at','with','by','against','over','under','into','through',
  'within','from','and','but','or','yet','still','also','meanwhile','however',
]);

const COMMON_PROSE_CAPS = new Set([
  'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
  'january','february','march','april','may','june','july',
  'august','september','october','november','december',
  'sportsvyn','watch','score','tier','preview',
  'world','cup','friendly','friendlies','exhibition','tournament','round','group',
  'stage','league','final','semifinal','quarterfinal',
  // Headline-title-case verbs that aren't player names
  'host','hosts','hosting','meet','meets','meeting','face','faces','facing',
  'play','plays','playing','visit','visits','arrive','arrives','await','awaits',
  'tune','tunes','tuning','head','heads','heading',
  // Country aliases / multi-word country components
  'united','states','kingdom','arab','emirates','south','north','korea','africa',
  'new','zealand','ivory','coast','saudi','arabia',
  // Tournament organizations and league abbreviations
  'fifa','uefa','concacaf','conmebol','afc','caf','ofc','mls','epl','ucl','nfl','nba','mlb',
  // Common venue / geography words (the city of a venue is often inferable
  // from generally-known sport context; the gate cares about player names,
  // not geography lookups)
  'charlotte','atlanta','miami','boston','chicago','dallas','seattle','denver',
  'phoenix','houston','washington','york','angeles','francisco','vegas','orleans',
  'bank','america','stadium','arena','park','field','centre','center',
  // Prefix modifiers stripped by hyphen-split
  'pre','post','non','sub','co','mid','late','early',
]);

function findReferencedNames(text) {
  const out = new Set();
  const wordChar = `[A-Za-zÀ-ſ'\\-]`;
  const fullName = new RegExp(
    `(?<!${wordChar})([A-Z][a-zA-ZÀ-ſ'\\-]{1,}(?:\\s+[A-Z][a-zA-ZÀ-ſ'\\-]{1,})+)(?!${wordChar})`,
    'g'
  );
  let m;
  while ((m = fullName.exec(text)) !== null) out.add(m[1]);
  const poss = new RegExp(
    `(?<!${wordChar})([A-Z][a-zA-ZÀ-ſ'\\-]{2,})'s(?!${wordChar})`,
    'g'
  );
  while ((m = poss.exec(text)) !== null) out.add(m[1]);
  return [...out];
}

function gateNameForm(parsed, envelope) {
  const allowed = collectAllowedTokens(envelope);
  const issues = new Set();
  // Check each section SEPARATELY so a multi-cap phrase can't be captured
  // across the boundary between headline and body (the prior implementation
  // joined with a space and let the regex span sections).
  const sections = [parsed.headline ?? '', parsed.subtitle ?? '', parsed.body ?? ''];
  for (const section of sections) {
    for (const name of findReferencedNames(section)) {
      // Split candidate on whitespace AND hyphens AND slashes so
      // "Pre-World" tokenizes as ["pre", "world"], matching how source
      // tokens are stored.
      const toks = name.split(/[\s\-/]+/).map((t) => fold(t.replace(/[^a-zA-ZÀ-ſ'']/g, '')));
      const checkToks = toks.filter((t) => t.length >= 3);
      const missing = checkToks.filter((t) => {
        const stripped = t.replace(/['']s?$/, '');
        return (
          !allowed.has(stripped) &&
          !SENTENCE_START_OK.has(stripped) &&
          !COMMON_PROSE_CAPS.has(stripped)
        );
      });
      if (missing.length > 0) {
        issues.add(`"${name}" not in source (missing: ${missing.join(', ')})`);
      }
    }
  }
  return { pass: issues.size === 0, reason: [...issues].slice(0, 6).join(' | ') };
}

function runAllGates(parsed, envelope) {
  const results = [];
  const s = gateJsonStructure(parsed);
  results.push({ name: 'json_structure', ...s });
  if (!s.pass) return results;
  results.push({ name: 'word_counts', ...gateWordCounts(parsed) });
  results.push({ name: 'banned_constructions', ...gateBannedConstructions(parsed) });
  results.push({ name: 'name_form', ...gateNameForm(parsed, envelope) });
  return results;
}

// ============================================================================
// Retry instruction
// ============================================================================
function buildRetryInstruction(gates) {
  const failed = gates.filter((g) => !g.pass);
  if (!failed.length) return '';
  const reasons = failed.map((g) => `${g.name}: ${g.reason}`).join(' | ');
  return `Your previous response failed validation: ${reasons}. Re-read the system constraints. A thin preview is SHORT (body 120-220 words, 2-3 paragraphs, headline 6-14 words). No hype, no second person, no questions, no predictions, no players you don't have. Output STRICT JSON with the exact schema.`;
}

// ============================================================================
// Orchestration
// ============================================================================

export async function generatePreview(envelope) {
  const readiness = computeReadiness(envelope);
  if (readiness.phase === 'rich') {
    throw new Error(
      `Rich (Phase 2) preview not yet implemented — readiness selected rich (substance present: lineups=${readiness.present.lineups} form=${readiness.present.form} odds=${readiness.present.odds}). Add the locked Phase 2 SYSTEM_PROMPT_RICH and fetch logic before running this fixture.`
    );
  }

  const systemPrompt = SYSTEM_PROMPT_THIN;
  const attempts = [];
  let lastRaw = null;

  async function doAttempt(attemptN, retryInstruction = null) {
    let response = null;
    let parsed = null;
    let error = null;
    try {
      response = await callModel(systemPrompt, envelope, retryInstruction);
      lastRaw = response;
      const text = extractText(response);
      parsed = extractJson(text);
    } catch (err) {
      error = String(err?.message ?? err);
    }
    const gates = error
      ? [{ name: 'api_call', pass: false, reason: error }]
      : runAllGates(parsed, envelope);
    const entry = { attempt: attemptN, parsed_output: parsed ?? null, error, gates };
    attempts.push(entry);
    return entry;
  }

  const a1 = await doAttempt(1);
  if (a1.parsed_output && a1.gates.every((g) => g.pass)) {
    return finalize({ parsed: a1.parsed_output, attempts, lastRaw, readiness, validation_status: 'passed' });
  }

  const retry = buildRetryInstruction(a1.gates);
  const a2 = await doAttempt(2, retry);
  if (a2.parsed_output && a2.gates.every((g) => g.pass)) {
    return finalize({ parsed: a2.parsed_output, attempts, lastRaw, readiness, validation_status: 'passed' });
  }

  // Null-suppress fallback — the left column shows its empty placeholder.
  return {
    headline: null,
    subtitle: null,
    body: null,
    phase: readiness.phase,
    present: readiness.present,
    attempts,
    validation_status: 'suppressed',
    model: MODEL,
    raw_response: lastRaw,
  };
}

function finalize({ parsed, attempts, lastRaw, readiness, validation_status }) {
  return {
    headline: parsed.headline,
    subtitle: parsed.subtitle ?? null,
    body: parsed.body,
    phase: readiness.phase,
    present: readiness.present,
    attempts,
    validation_status,
    model: MODEL,
    raw_response: lastRaw,
  };
}

export async function generatePreviewForFixture(fixtureId) {
  const envelope = await buildPreviewEnvelope(fixtureId);
  const result = await generatePreview(envelope);
  return { ...result, envelope };
}
