// lib/dailyCardIntro.js — AI Daily Card intro generator + storage.
//
// Engine-A pattern (same shape as lib/aiPrematch.js): assemble envelope →
// inline system prompt + json_schema call → server-side validate →
// UPSERT into daily_card_intros with status='pending_review'. Editor
// review (app/admin/daily-card) flips to 'published'. Homepage reads
// PUBLISHED rows only via getCurrentDailyCardIntro — pending or
// rejected drafts never surface publicly.
//
// IMPORTANT: prompt is INLINE in this file. ai_prompt_templates table
// remains decorative for now (see audit task #109's neighbor — five of
// the seven slots are placeholder text). Inline prompt = lockable +
// diff-able + tested at the unit boundary.

import Anthropic from '@anthropic-ai/sdk';
import { sql } from './db.js';
import { readFixturesByPtDay } from './scheduleData.js';
import { getCurrentLiveMatches } from './liveMatches.js';
import { getTopN } from './rankings.js';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 800;
const WC_LEAGUE_SLUG = 'fifa-wc-2026';
const FRIENDLIES_LEAGUE_SLUG = 'international-friendlies';

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// =============================================================================
// LOCKED SYSTEM PROMPT
// =============================================================================
export const SYSTEM_PROMPT = `You are a Sportsvyn editor writing the day's Daily Card intro — a single editorial paragraph that opens the homepage. The intro is editor-gated before it ever surfaces, but the first draft must read like work you stand behind.

THE INTRO IS:
- One paragraph, 50–90 words.
- Source Serif italic register — measured, present-tense, descriptive.
- Opens with the day's most editorially interesting fact (today's marquee fixture, the start of a stage, a live result, the standing of a ranked side). NOT with weather, NOT with cliché ("the beautiful game"), NOT with a question.
- Closes with one sentence that sets the day's editorial frame (what we're watching for). NOT a pick, NOT a prediction, NOT a tease for paywalled content.

VOICE — explain don't pick (inviolable):
- NO betting language: lock, value, edge, tout, smart money, line, hedge.
- NO prophecy verbs: will win, will advance, ought to, deserves to, should win.
- NO invented results or scores. Pre-tournament: write forward-looking framing about the OPENING of the tournament, NOT specific match outcomes.
- NO invented quotes, NO invented stats. If you reference a player or manager, they must appear in the provided context.
- NO clichés: "tale of two halves", "beautiful game", "writing their own story".

TERMINOLOGY — do not coin proper nouns the product doesn't already use:
- The rankings unit in the envelope ("power_five" key) is called "Power Rankings" — OR refer to it generically as "the rankings" or "Sportsvyn's rankings". Do NOT call it "Power Five", "the Power Five", "the top five", or any other invented label. The envelope's "power_five" key name is an internal data-shape detail, not the user-facing name.

HOSTS — factual context, do not get this wrong:
- The 2026 World Cup is co-hosted by Mexico, the United States, and Canada. These three are the host nations; no other team is a host.
- Do NOT characterize any team as a "host" unless it is Mexico, the United States, or Canada.
- Do NOT present a list of teams in a way that implies they are the hosts. When referring to teams with upcoming fixtures, describe them as opening group play — never as "the hosts" unless they are one of the three named above.

GROUNDING — strict:
- Reference ONLY teams, matches, managers, and players that appear in the envelope's context (today's slate, the power-five, the live/recent matches).
- The PT date in the envelope is the day this intro publishes. Phrase tense accordingly.
- If the slate is empty (no matches today), the intro is about the tournament's state and what's ahead — what we're watching for in the next 24–48 hours — using the next fixtures + the power-five as the editorial anchor.

OUTPUT SCHEMA (strict JSON):
{
  "body": "string — 50–90 words, single paragraph, no leading/trailing whitespace, no html, no newlines mid-paragraph"
}`;

const SCHEMA = {
  type: 'object',
  properties: {
    body: { type: 'string' },
  },
  required: ['body'],
  additionalProperties: false,
};

// =============================================================================
// Envelope assembly — what the AI sees
// =============================================================================
export async function assembleEnvelope({ ptDay }) {
  const [wcFixtures, frFixtures, live, top5] = await Promise.all([
    readFixturesByPtDay({ leagueSlug: WC_LEAGUE_SLUG, ptStart: ptDay, ptEnd: ptDay }),
    readFixturesByPtDay({ leagueSlug: FRIENDLIES_LEAGUE_SLUG, ptStart: ptDay, ptEnd: ptDay }),
    getCurrentLiveMatches(),
    getTopN({ listSlug: 'team-power', leagueSlug: WC_LEAGUE_SLUG, limit: 5 }),
  ]);

  const slate = wcFixtures.length > 0 ? wcFixtures : frFixtures;

  // Next fixture is what gives the empty-state intro something to anchor.
  const nextRows = await sql`
    SELECT m.slug, m.kickoff_at, m.venue, m.stage,
           ht.name AS home_name, at.name AS away_name
      FROM matches m
      JOIN teams ht ON ht.id = m.home_team_id
      JOIN teams at ON at.id = m.away_team_id
      JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = ${WC_LEAGUE_SLUG}
       AND m.kickoff_at > now()
     ORDER BY m.kickoff_at
     LIMIT 3
  `;

  return {
    pt_day: ptDay,
    slate: slate.map((f) => ({
      slug: f.slug,
      kickoff_utc: f.kickoff_at,
      home: f.home?.name ?? null,
      away: f.away?.name ?? null,
      status: f.status,
      home_score: f.home_score,
      away_score: f.away_score,
    })),
    live_matches: live.map((m) => ({
      slug: m.slug,
      home: m.home_name,
      away: m.away_name,
      home_score: m.home_score,
      away_score: m.away_score,
    })),
    next_fixtures: nextRows.map((r) => ({
      home: r.home_name,
      away: r.away_name,
      kickoff_utc: r.kickoff_at,
      venue: r.venue,
      stage: r.stage,
    })),
    power_five: top5.map((r) => ({
      rank: r.rank,
      team: r.team_name,
      score: r.score,
    })),
  };
}

// =============================================================================
// Anthropic call
// =============================================================================
export async function generateIntro(envelope) {
  if (!client) throw new Error('ANTHROPIC_API_KEY missing — cannot call Claude');

  const userContent =
    `Envelope:\n\n${JSON.stringify(envelope, null, 2)}\n\n` +
    `Write today's Daily Card intro per the system prompt. ` +
    `Single paragraph, 50–90 words, Source Serif italic register. ` +
    `Output STRICT JSON only.`;

  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      output_format: { type: 'json_schema', schema: SCHEMA },
    });
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err), raw: null };
  }

  const text = response?.content?.[0]?.text ?? '';
  let parsed;
  try { parsed = JSON.parse(text.trim()); }
  catch { return { ok: false, error: 'json_parse_failure', raw: text }; }

  return { ok: true, parsed, raw: text, usage: response.usage };
}

// =============================================================================
// Validation — voice lint + grounding + word count
// =============================================================================
const VOICE_LINT = [
  // Prophecy / prescription
  { re: /\bshould (?:win|advance|lift|prevail)\b/i, label: 'prophecy: "should X"' },
  { re: /\bwill (?:win|advance|lift|prevail|crash|exit)\b/i, label: 'prophecy: "will X"' },
  { re: /\bought to\b/i,       label: 'prescription: "ought to"' },
  { re: /\bdeserves? to\b/i,   label: 'prescription: "deserves to"' },
  // Gambling
  { re: /\block\b/i,           label: 'gambling: "lock"' },
  { re: /\btout\b/i,           label: 'gambling: "tout"' },
  { re: /\bsmart money\b/i,    label: 'gambling: "smart money"' },
  { re: /\bedge play\b/i,      label: 'gambling: "edge play"' },
  { re: /\bvalue play\b/i,     label: 'gambling: "value play"' },
  { re: /\bover\/under\b/i,    label: 'gambling: "over/under"' },
  { re: /\bguaranteed\b/i,     label: 'gambling: "guaranteed"' },
  // Cliché
  { re: /\btale of two halves\b/i, label: 'cliché: "tale of two halves"' },
  { re: /\bbeautiful game\b/i,     label: 'cliché: "beautiful game"' },
  { re: /\bwriting (?:their|his|her) own story\b/i, label: 'cliché: "writing own story"' },
];

// Fabricated-score sniff — NN-NN or "N to N" anywhere in the prose. The
// envelope DOES contain real scores for live/final matches; those land
// as legitimate numbers inside the AI's prose. We allow them IF the
// teams + score combo matches the envelope; for Stage 1 we just flag
// the pattern and let the editor verify.
const SCORE_PATTERN = /\b\d\s*[-–—]\s*\d\b/;

export function validateIntro(parsed, envelope) {
  const issues = [];
  const body = (parsed?.body ?? '').trim();

  // Word count 50–90.
  const words = body.split(/\s+/).filter(Boolean);
  if (words.length < 50) issues.push(`word_count: ${words.length} (need ≥50)`);
  if (words.length > 90) issues.push(`word_count: ${words.length} (need ≤90)`);

  // Single paragraph — no double newlines.
  if (/\n\s*\n/.test(body)) issues.push('multiple paragraphs (must be one)');

  // Voice lint
  for (const { re, label } of VOICE_LINT) {
    if (re.test(body)) issues.push(`voiceLint: ${label}`);
  }

  // Fabricated-score sniff — score patterns in pre-tournament intros
  // are suspect because there are no live results to anchor them.
  const isPreTournament = envelope.live_matches.length === 0 &&
                          envelope.slate.every((f) => f.status === 'scheduled');
  if (isPreTournament && SCORE_PATTERN.test(body)) {
    issues.push('score_pattern_in_pre_tournament (no live results to anchor a scoreline)');
  }

  // Grounding: every team name mentioned in the body should appear in
  // the envelope's slate / live / next_fixtures / power_five. We don't
  // hard-fail here (proper-noun extraction is noisy); we flag if the
  // body mentions a country name we DIDN'T provide.
  const envTeams = new Set();
  for (const f of envelope.slate) { if (f.home) envTeams.add(f.home); if (f.away) envTeams.add(f.away); }
  for (const m of envelope.live_matches) { if (m.home) envTeams.add(m.home); if (m.away) envTeams.add(m.away); }
  for (const n of envelope.next_fixtures) { if (n.home) envTeams.add(n.home); if (n.away) envTeams.add(n.away); }
  for (const p of envelope.power_five) { if (p.team) envTeams.add(p.team); }
  // (We don't actively scan body for un-envelope'd team names in Stage 2 —
  // the editor catches it on review. Field reserved for a future
  // upgrade.)

  return { ok: issues.length === 0, issues, word_count: words.length };
}

// =============================================================================
// Read helper — homepage consumes this
// =============================================================================
export async function getCurrentDailyCardIntro(ptDay) {
  if (!ptDay) return null;
  const rows = await sql`
    SELECT body, published_at, generated_at
      FROM daily_card_intros
     WHERE pt_day = ${ptDay}::date
       AND status = 'published'
     LIMIT 1
  `;
  return rows[0] ?? null;
}

// =============================================================================
// Top-level: assemble + generate + validate + UPSERT pending_review.
// NEVER auto-publishes — editor flips to 'published' from /admin/daily-card.
// =============================================================================
export async function runDailyCardIntroForDay({ ptDay }) {
  const envelope = await assembleEnvelope({ ptDay });
  const gen = await generateIntro(envelope);
  if (!gen.ok) {
    return { ok: false, ptDay, envelope, error: gen.error, raw: gen.raw };
  }

  const validation = validateIntro(gen.parsed, envelope);

  // UPSERT — re-running on the same day overwrites the pending draft.
  // Note: if a published intro already exists for this day, we still
  // overwrite (treating regenerate as "editor wants a fresh draft").
  // The reviewer can re-approve.
  const inserted = await sql`
    INSERT INTO daily_card_intros (
      pt_day, body, status, generated_at, model_meta, notes
    ) VALUES (
      ${ptDay}::date,
      ${gen.parsed.body},
      'pending_review',
      now(),
      ${JSON.stringify({
        model: MODEL,
        usage: gen.usage ?? null,
        validation,
      })}::jsonb,
      ${validation.ok ? null : `validation issues: ${validation.issues.join('; ')}`}
    )
    ON CONFLICT (pt_day) DO UPDATE
      SET body = EXCLUDED.body,
          status = 'pending_review',
          generated_at = now(),
          model_meta = EXCLUDED.model_meta,
          notes = EXCLUDED.notes,
          reviewed_at = null,
          reviewed_by = null,
          published_at = null,
          updated_at = now()
    RETURNING id, pt_day, body, status, generated_at, model_meta
  `;

  return {
    ok: true,
    ptDay,
    row: inserted[0],
    envelope,
    parsed: gen.parsed,
    validation,
    usage: gen.usage,
  };
}
