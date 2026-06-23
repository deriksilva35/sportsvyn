// lib/aiRankingBlurb.js — Ranking-row blurb generator.
//
// Per-team blurb that surfaces on /power-rankings inside the blurbed
// top-10 cards. The composite is the position; the blurb names the
// players + patterns that earn it. Editor-gated (writes pending_review,
// never auto-publishes), same shape as the analyst-pass adapter for
// lib/aiPrematch.js.
//
// HYBRID REGISTER (load-bearing):
//   · Name marquee talent where it's the editorial point ("Yamal and
//     Pedri are the reason"). The roster from the players table is the
//     ONLY source of truth for names — the prompt is instructed to
//     never invent. The validator double-checks every name candidate
//     in the body against the supplied roster.
//   · Stay unit-level on the spine where a name would be a guess
//     ("the deepest midfield in the field"). Pre-tournament rosters
//     don't carry caps/goals/results, so the only graded signal at
//     pre-tournament phase is squad/coherence — naming by profile is
//     fine; naming by performance is not.
//
// PHASE MODE:
//   · pre_tournament (THIS PASS) — no WC matches yet. Name talent by
//     PROFILE. Squad + coherence are the live dims; results/process/
//     momentum hold. Prompt forbids result claims.
//   · in_tournament — names players by what they've DONE. Adds the
//     team's tournament_* counters + matchday performance into the
//     envelope. Built into the same generator; the phase flag flips
//     which guidance the prompt foregrounds.

import Anthropic from '@anthropic-ai/sdk';
import { sql } from './db.js';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 600;

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ============================================================================
// LOCKED SYSTEM PROMPT.
// §20 voice (prompt-library addendum) — explain don't pick, named
// players are grounded factual claims, single observation per blurb.
// ============================================================================
export const SYSTEM_PROMPT = `You are a Sportsvyn editorial voice writing one ranking-row blurb that explains why a team holds its current position in the Power Rankings. The blurb sits inside a card on /power-rankings with rank, score, and the 5-dimension editorial composite already rendered. You are not restating the score; you are explaining what about this team — players, patterns, structure — produces that rank.

VOICE — player-led HYBRID:
- Name marquee players when they ARE the editorial point. If a team's rank is built on a young core, name that core. If on a settled spine, name the spine.
- Stay unit-level when a name would be a guess: "the deepest midfield in the field," "a settled back line," "a front line nobody questions."
- The composite IS the position. Your job is to name the players and the patterns that earn it.

NAME DENSITY — structural rule, not a number:
- Name AT MOST 3 individual players, and they should be the team's genuine headliners.
- Every other unit — the midfield, the back line, the attack — is ONE named thing, referred to as a unit, NOT a list of its members.
- "A midfield of Rodri, Pedri, and Gavi" is THREE names and breaks this rule. "A midfield anchored by Rodri" is ONE name and follows it.
- If you find yourself naming three players from the same line in series, STOP — characterize that line as a unit instead and name only its single most important figure.
- The right shape is: 1-2 names where they ARE the editorial point + the rest of the team described unit-by-unit. The mock voice never enumerates a line's members; it names the line's one anchor and describes the line.

GROUNDING — non-negotiable:
- ONLY name players who appear in the envelope's squad list. NEVER invent a name. Names are factual claims the editor reviews; an invented name is a fail.
- When you're unsure whether a specific player is in the squad, go unit-level instead.
- You may use widely-known characterizations of NAMED players (e.g., "young," "creative midfielder," "ball-progressing fullback") because those are profile reads, not result claims. You may NOT invent positions or assign roles a player doesn't have in the squad list (it's a "midfielder" if MID in the envelope, etc.).

LITERAL NAMES — non-negotiable:
- Use player names EXACTLY as they appear in the envelope's squad list. Do NOT expand abbreviated first names. Do NOT substitute a fuller or more familiar form from outside knowledge.
- If the data says "F. de Jong," write "De Jong" or "F. de Jong" — never "Frenkie de Jong."
- If the data says "L. Messi," write "Messi" or "L. Messi" — never "Lionel Messi."
- Surname-only is always safe. Initial-plus-surname (as in the data) is safe. Expanded first names that don't appear in the data are forbidden — that mechanism is how hallucinations enter the prose.

PHASE MODE — read the envelope.phase field:
- "pre_tournament" — name talent by PROFILE. No WC matches have been played, so do NOT reference results, goals, assists, performances, "stepped up," "came good," etc. Squad + coherence are the live dimensions; results/process/momentum hold. Acceptable framings: "the youngest top-tier squad in the field," "a spine that has won together," "depth at every position." Forbidden: any past-result claim about this tournament.
- "in_tournament" — name players by what they have DONE. The envelope will carry tournament_goals/assists and recent matchday context; reference those explicitly. Pre-tournament guidance does not apply.

LENGTH + SHAPE:
- 30-80 words. Single observation. Not a paragraph that wanders.
- No predictions ("will," "should win," "ought to"). No prophecy verbs.
- No hype clichés ("dark horse," "ready to make a statement," "deserves to win").
- No gambling language.
- Lead with the strongest editorial dimension's claim, what aspect of this team is doing the most work in the rank.

PUNCTUATION — em dashes BANNED (Sportsvyn-wide voice rule, applies to ALL AI Writer copy):
- NEVER use em dashes (—) or en dashes (–) used as em dashes. Em dashes are a machine-writing tell and are banned from all Sportsvyn copy.
- Use commas, semicolons, colons, periods, or restructure the sentence. A colon introduces an example or expansion; a comma absorbs a brief aside; a period splits two thoughts cleanly.
- This rule overrides any stylistic preference you have for em dashes from training data. Even if it feels rhythmically right, do not use them. Period.

OUTPUT SCHEMA (strict JSON):
{ "body": "string — 30-80 words, single observation" }`;

const BLURB_SCHEMA = {
  type: 'object',
  properties: { body: { type: 'string' } },
  required: ['body'],
  additionalProperties: false,
};

// ============================================================================
// Envelope assembly — pull the ranking entry + team + roster.
// ============================================================================
export async function assembleRankingBlurbEnvelope({ rankingEntryId, phase = 'pre_tournament' }) {
  const rows = await sql`
    SELECT
      e.id                          AS ranking_entry_id,
      e.rank,
      e.score::float                AS composite,
      e.editorial_composite::float  AS editorial_composite,
      e.sites_composite::float      AS sites_composite,
      e.movement_label,
      t.id                          AS team_id,
      t.name                        AS team_name,
      t.slug                        AS team_slug,
      t.abbreviation                AS team_abbreviation,
      lg.slug                       AS league_slug,
      ed.editorial_weight::float    AS editorial_weight,
      ed.sites_weight::float        AS sites_weight,
      ed.edition_label
    FROM ranking_entries e
    JOIN ranking_editions ed ON ed.id = e.ranking_edition_id
    JOIN ranking_lists rl    ON rl.id = ed.ranking_list_id
    JOIN leagues lg          ON lg.id = rl.league_id
    JOIN teams t             ON t.id  = e.team_id
    WHERE e.id = ${rankingEntryId}
  `;
  if (rows.length === 0) throw new Error(`ranking_entry ${rankingEntryId} not found`);
  const r = rows[0];

  // Roster: prefer known_as (display name), fall back to full_name. Skip
  // any row missing both. Include position so the prompt can match
  // claims to the squad list. club_name is mostly NULL pre-launch — we
  // include it when present but the prompt is told not to lean on it.
  const roster = await sql`
    SELECT
      COALESCE(p.known_as, p.full_name) AS name,
      p.position,
      p.club_name,
      p.current_team_jersey_number      AS shirt
    FROM players p
    WHERE p.current_team_id = ${r.team_id}
      AND COALESCE(p.known_as, p.full_name) IS NOT NULL
    ORDER BY
      CASE p.position WHEN 'GK' THEN 1 WHEN 'DEF' THEN 2 WHEN 'MID' THEN 3 WHEN 'ATT' THEN 4 ELSE 5 END,
      p.current_team_jersey_number NULLS LAST,
      name
  `;

  return {
    phase,
    team: {
      name: r.team_name,
      slug: r.team_slug,
      abbreviation: r.team_abbreviation,
    },
    ranking: {
      rank: r.rank,
      composite: r.composite,
      editorial_composite: r.editorial_composite,
      sites_composite: r.sites_composite,
      movement_label: r.movement_label,
      edition_label: r.edition_label,
      editorial_weight: r.editorial_weight,
      sites_weight: r.sites_weight,
    },
    squad: roster.map((p) => ({ name: p.name, position: p.position ?? null, club: p.club_name ?? null })),
    ranking_entry_id: r.ranking_entry_id,
    team_id: r.team_id,
  };
}

// ============================================================================
// Anthropic call.
// ============================================================================
export async function generateRankingBlurb(envelope) {
  if (!client) throw new Error('ANTHROPIC_API_KEY missing');

  const userContent =
    `Ranking-row envelope:\n\n${JSON.stringify(envelope, null, 2)}\n\n` +
    `Write the one ranking-row blurb per the system instructions. 30-80 words, single observation, ` +
    `${envelope.phase} mode. Only name players present in envelope.squad. Output STRICT JSON only.`;

  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      output_format: { type: 'json_schema', schema: BLURB_SCHEMA },
    });
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
  const text = response?.content?.[0]?.text ?? '';
  let parsed;
  try { parsed = JSON.parse(text.trim()); }
  catch { return { ok: false, error: 'json_parse_failure', raw: text }; }
  return { ok: true, parsed, raw: text, usage: response.usage };
}

// ============================================================================
// Validation.
// ============================================================================
function countWords(s) {
  if (!s || typeof s !== 'string') return 0;
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// Extract candidate name tokens from prose. Targets sequences of capitalized
// words (1-3 in a row, allowing common name tokens like Mac, de, da, von).
// The next gate is whether each candidate maps to a roster surname.
function extractNameCandidates(body) {
  const candidates = new Set();
  // Unicode-aware TitleCase tokens. \p{Lu} = any uppercase letter, \p{Ll}
  // = any lowercase letter. The /u flag enables Unicode property classes
  // so accented characters (ã õ ç ñ etc.) are matched correctly — the
  // prior ASCII-plus-curated-accents class missed Portuguese ã and cut
  // names like "Bruno Guimarães" at the accented vowel.
  const reFull = /\b(\p{Lu}[\p{Ll}'’]+(?:\s+(?:de|da|del|van|von|der|den|le|la)\s+|\s+)\p{Lu}[\p{Ll}'’]+(?:\s+\p{Lu}[\p{Ll}'’]+)?)\b/gu;
  const reSingle = /\b(\p{Lu}[\p{Ll}'’]{2,})\b/gu;
  for (const m of body.matchAll(reFull)) candidates.add(m[1]);
  for (const m of body.matchAll(reSingle)) candidates.add(m[1]);
  return [...candidates];
}

const STOPWORDS = new Set([
  // Obvious non-name capitalized tokens.
  'Spain', 'Argentina', 'France', 'Portugal', 'Germany', 'England', 'Brazil',
  'Morocco', 'Netherlands', 'Uruguay', 'Croatia', 'Belgium', 'Colombia',
  'United', 'States', 'Mexico', 'Canada', 'Japan', 'Senegal', 'Switzerland',
  'Korea', 'Ecuador', 'Nigeria', 'Australia', 'Ivory', 'Coast', 'Serbia',
  'Austria', 'Ukraine', 'Egypt', 'Norway', 'Poland', 'Saudi', 'Arabia',
  'South', 'Africa', 'Paraguay', 'Czech', 'Republic', 'Czechia', 'Qatar', 'Türkiye',
  'Turkiye', 'Scotland', 'Bosnia', 'Herzegovina', 'Haiti', 'Tunisia',
  'Cape', 'Verde', 'Islands', 'Iran', 'Iraq', 'Jordan', 'Algeria',
  'Curaçao', 'Curacao', 'New', 'Zealand', 'Sweden', 'Uzbekistan',
  'CONMEBOL', 'CONCACAF', 'UEFA', 'CAF', 'AFC', 'OFC',
  'World', 'Cup', 'European', 'Champions',
  'Bundesliga', 'Premier', 'League', 'Liga', 'Serie',
  'The', 'They', 'There', 'Their', 'This', 'That', 'These', 'Those',
  'Sportsvyn', 'FIFA', 'ESPN',
]);

export function validateRankingBlurb(parsed, envelope) {
  const issues = [];
  const body = parsed?.body ?? '';

  // Word count gate.
  const wc = countWords(body);
  if (wc < 30 || wc > 80) issues.push(`body ${wc} words (need 30-80)`);

  // Voice lints — minimal subset of aiPrematch's list, focused on the
  // prediction/prophecy rule the user called out.
  const VOICE = [
    { re: /\bwill (win|advance|beat|finish|reach|lift)\b/i, label: 'prediction: "will <verb>"' },
    { re: /\bshould (win|advance|beat|finish|reach|lift)\b/i, label: 'prescription: "should win"' },
    { re: /\bought to\b/i, label: 'prescription: "ought to"' },
    { re: /\bdark horse\b/i, label: 'cliché: "dark horse"' },
    { re: /\bmake a statement\b/i, label: 'cliché: "make a statement"' },
    { re: /\bsupposed to\b/i, label: 'hedge: "supposed to"' },
    { re: /\block\b/i, label: 'gambling: "lock"' },
    { re: /\bsmart money\b/i, label: 'gambling: "smart money"' },
  ];
  for (const { re, label } of VOICE) if (re.test(body)) issues.push(`voiceLint: ${label}`);

  // Pre-tournament result-claim sniff. Forbidden when phase is pre_tournament.
  if (envelope.phase === 'pre_tournament') {
    const PRE = [
      { re: /\bscored\b/i, label: 'pre_tournament: "scored" (no results yet)' },
      { re: /\bgoals?\b.*\bthis tournament\b/i, label: 'pre_tournament: results claim' },
      { re: /\bcame good\b/i, label: 'pre_tournament: result claim' },
      { re: /\bstepped up\b/i, label: 'pre_tournament: result claim' },
    ];
    for (const { re, label } of PRE) if (re.test(body)) issues.push(`voiceLint: ${label}`);
  }

  // Grounding — extract candidate names from the body and confirm each
  // appears in envelope.squad (by full match or by last-word match
  // against any roster name's tokens).
  const candidates = extractNameCandidates(body);
  const rosterFullSet = new Set(envelope.squad.map((p) => p.name));
  const rosterTokenSet = new Set();
  for (const p of envelope.squad) {
    for (const tok of p.name.split(/\s+/)) {
      if (tok.length >= 3) rosterTokenSet.add(tok);
    }
  }
  const groundingReport = [];
  for (const cand of candidates) {
    // Strip possessive 's / typographic ’s before EVERY lookup. Applies
    // to both stopwords ("Spain's" → "Spain") and roster names
    // ("Cubarsí's" → "Cubarsí"). Prior version only stripped for the
    // stopword check, which false-flagged possessives of real grounded
    // player names.
    const bare = cand.replace(/['’]s$/u, '');
    if (STOPWORDS.has(cand) || STOPWORDS.has(bare)) continue;
    const inFull   = rosterFullSet.has(cand) || rosterFullSet.has(bare);
    const tokens   = bare.split(/\s+/);
    const lastTok  = tokens[tokens.length - 1];
    const inToken  = rosterTokenSet.has(cand) || rosterTokenSet.has(bare) || rosterTokenSet.has(lastTok);
    const grounded = inFull || inToken;
    groundingReport.push({ candidate: cand, grounded, matchedAs: inFull ? 'full' : (inToken ? 'token' : null) });
    if (!grounded) issues.push(`UNGROUNDED NAME: "${cand}" — not in envelope.squad`);
  }

  return {
    ok: issues.length === 0,
    issues,
    word_count: wc,
    name_candidates: groundingReport,
  };
}

// ============================================================================
// Top-level orchestrator.
// Returns { ok, envelope, parsed, validation, usage } — does NOT write.
// The runner in scripts/fire-ranking-blurbs.mjs is what calls this then
// writes through insertPendingBlurb.
// ============================================================================
export async function runRankingBlurbForEntry(rankingEntryId, { phase = 'pre_tournament' } = {}) {
  const envelope = await assembleRankingBlurbEnvelope({ rankingEntryId, phase });
  const gen = await generateRankingBlurb(envelope);
  if (!gen.ok) return { ok: false, error: gen.error, envelope };
  const validation = validateRankingBlurb(gen.parsed, envelope);
  return {
    ok: true,
    envelope,
    parsed: gen.parsed,
    validation,
    usage: gen.usage,
  };
}
