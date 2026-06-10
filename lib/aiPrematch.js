// lib/aiPrematch.js — Pre-match analyst pass.
//
// Editor-gated AI pass that fills BOTH stubs on the pre-match page:
//   1. The Watch Score (5 dimensions, composite, summary) — rail slot
//   2. The two-paragraph editorial Preview — left column
//
// Mirrors the Tier-1 Brief pattern (lib/aiBrief.js):
//   assemble envelope → single Anthropic call → structured JSON →
//   server-side validation → insert as status='draft' → editor reviews
//   and flips to 'preview'/'published' (§7.6 — NEVER auto-publish).
//
// HYBRID DIMENSION SOURCING (load-bearing — see voice-bible §7.1):
//   server-grounded (fixed inputs the AI does NOT re-judge):
//     STAKES → derived from fixture type. Friendlies are definitionally
//              low-consequence. computeStakesScore() handles the math;
//              both teams being WC-bound adds a tune-up bump.
//     DRAMA  → derived from /predictions.comparison.total pairwise
//              percentage spread (closeness = high drama).
//   AI-proposed (analyst's call, editor-reviewable):
//     QUALITY    → expected craft level (passed /predictions as context)
//     NARRATIVE  → story value / rivalry / milestones
//     MOMENT     → cultural weight / resonance
//
// Composite = flat mean of all 5 dimensions, one decimal, no smoothing
// (voice-bible §7.1). Server computes the composite — never trust the
// model's number for it.
//
// §7.5 enforcement: any dimension <6.0 or ≥9.0 must carry a non-empty
// by-name defense in justifications.* (server gate, not just prompt).

import Anthropic from '@anthropic-ai/sdk';
import { apiSports } from './apiSports.js';
import { sql } from './db.js';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 2048;

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ============================================================================
// LOCKED SYSTEM PROMPT. Bound to voice-bible §7.1 / §7.5 / §7.6.
// ============================================================================
export const SYSTEM_PROMPT = `You are a Sportsvyn pre-match analyst writing the editorial Watch Score and a two-paragraph Preview for a match that has NOT yet kicked off. Your output is editor-gated — a human editor reviews and may adjust toward MORE honesty before publish — but the first draft has to read like work you stand behind.

THE FIVE WATCH SCORE DIMENSIONS (0.0–10.0 each, voice-bible §7.1 verbatim):
- STAKES    = consequence / what's on the line
- QUALITY   = expected baseline craft level of the match
- NARRATIVE = story value (rematches, rivalries, redemption, milestones)
- DRAMA     = competitive balance / how close the contest figures to be
- MOMENT    = cultural weight / historical significance / resonance

COMPOSITE = flat mean of all five, one decimal. NO smoothing. The composite is whatever the math says.

HYBRID INPUT MODEL:
- STAKES and DRAMA are GIVEN to you as fixed server-computed values in the envelope. You do NOT propose them. You DO write a one-sentence justification for each — explaining what the server's number reflects in this specific match.
- QUALITY, NARRATIVE, and MOMENT are YOURS to propose. Each is a 0.0–10.0 score with a one-sentence justification.

COMPETITION CONTEXT — the envelope's match block carries league, league_slug, stage, and group_code. Use them. When the envelope says league_slug='fifa-wc-2026' and stage='group', this is a 2026 FIFA World Cup group-stage fixture — frame it as such in your STAKES justification and preview prose. Do NOT call a World Cup match a friendly, tune-up, dress rehearsal, or pre-tournament preparation. Reference the group (e.g., "Group A opener") when group_code is present.

§7.5 DEFENSE RULE — non-negotiable:
- Any dimension scoring BELOW 6.0 OR AT/ABOVE 9.0 must be defended BY NAME in its justification. "Defended by name" means: the justification names the specific reason the dimension lands where it does (not generic prose). A low STAKES gets defended ("no advancement implications, neither side is in a results window") — not hand-waved. A high MOMENT gets defended ("first meeting between these countries in 32 years; Maracanã centennial weekend") — not vibes.
- This makes guessed numbers auditable. For friendlies, most STAKES + most QUALITY will fall below 6.0 — the defense is the point.

MOMENT ELEVATION RULE — when MOMENT lands at 6.5 or higher because of CULTURAL or GEOPOLITICAL resonance (rather than purely sporting significance, rivalry history, or anniversary/milestone), the justification MUST name the specific resonance you are reading. Concrete examples of what counts as named:
  GOOD:  "Palestine's international football carries weight beyond the scoreline — the program functions as a cultural assertion regardless of result."
  GOOD:  "First meeting between these federations since the 1998 boycott; the diplomatic backdrop is the story even at friendly stakes."
  BAD:   "This match matters culturally."
  BAD:   "Both nations have proud footballing traditions."
  BAD:   "The wider significance lifts this above an ordinary friendly."
The editor reviews these specifically. A vague "matters culturally" claim on an elevated MOMENT score is the failure pattern — name the resonance or score lower.

PREVIEW (two paragraphs):
- Paragraph 1: 80–120 words. What this match IS — the setup, the teams' situations, the editorial angle the Watch Score reflects. Lead with the strongest dimension's claim.
- Paragraph 2: 60–110 words. What to watch — specific players, tactical questions, or moments. Reads like an editorial pre-match note, not a betting pick.

HARD CONSTRAINTS:
- NO fabricated numbers. The win probability (when provided) is the server's contract; you may reference "the slight favorite" or "the underdog" but you must NEVER restate a different probability number, invent one, or contradict the server's split.
- NO predicted final score. The Watch Score IS the prediction this voice makes — not a scoreline.
- NO opinion verbs that imply prophecy: "should win," "ought to," "deserved to," "needs to," "must," "supposed to," "arguably," "perhaps," "seemed to," "appeared to."
- NO gambling language: "lock," "tout," "guaranteed," "value," "edge play," "smart money."
- NO "should have," "could have," "would have" — this is a pre-match piece, not a counterfactual.
- NO clichés ("a tale of two halves," "the beautiful game," etc.).
- Refer to teams by their full names as supplied in the envelope; do not invent nicknames.
- If you'd be guessing about a specific player, write around them rather than name them. Players you do name must come from the envelope's roster or be matters of public record about the country team (head coach, captain) that you state plainly. When in doubt, omit.

OUTPUT SCHEMA (strict JSON):
{
  "quality_score":    number 0.0–10.0,
  "narrative_score":  number 0.0–10.0,
  "moment_score":     number 0.0–10.0,
  "moment_basis":     "sporting" | "cultural" | "geopolitical",
  "justifications": {
    "stakes":    "string ≤300 chars — defending the server's STAKES",
    "quality":   "string ≤300 chars — defending your QUALITY",
    "narrative": "string ≤300 chars — defending your NARRATIVE",
    "drama":     "string ≤300 chars — defending the server's DRAMA",
    "moment":    "string ≤300 chars — defending your MOMENT"
  },
  "preview_paragraph_1": "string — 80–120 words",
  "preview_paragraph_2": "string — 60–110 words",
  "watch_summary":       "string — 40–70 word overall verdict"
}

MOMENT_BASIS — declare which kind of resonance drove your MOMENT score:
- "sporting"     → rivalry heat, milestone/anniversary, head-to-head history with sporting weight, milestone for a player/program (record chase, debut, retirement). The default for most fixtures.
- "cultural"    → program functions as cultural identity for the audience; rebuilding-program narratives; cultural-significance reads without active diplomatic-rupture context. Example: Sierra Leone-Liberia post-civil-war national rebuilding narratives.
- "geopolitical" → ACTIVE conflict, contested statehood, sanctions/boycotts, diplomatic rupture, occupation, recognized international dispute. Reserve this label for cases where the geopolitical situation is the load-bearing resonance. Example: Palestine fixtures (program-as-national-assertion-under-occupation). Be conservative — when in doubt between cultural and geopolitical, choose cultural.

This field is editor-tripwired downstream — geopolitical declarations route to admin review before publish. Use it accurately; do not over-claim and do not under-claim.`;

// ============================================================================
// JSON schema — strict shape enforced by the beta API.
// ============================================================================
// NOTE: Anthropic's beta json_schema does NOT support minimum/maximum on
// `number` types (verified 2026-06-06: 400 invalid_request_error). The
// 0–10 range is enforced by validateAnalystPass on the server, which is
// the trust layer anyway — schema is shape, validation is value.
const ANALYST_SCHEMA = {
  type: 'object',
  properties: {
    quality_score:        { type: 'number' },
    narrative_score:      { type: 'number' },
    moment_score:         { type: 'number' },
    // moment_basis is the publish-decision tripwire. "geopolitical" routes
    // the row to admin review; the other two auto-publish. The enum is
    // enforced at the schema level so the model can't smuggle a free-form
    // label past the structured-output contract.
    moment_basis:         { type: 'string', enum: ['sporting', 'cultural', 'geopolitical'] },
    justifications: {
      type: 'object',
      properties: {
        stakes:    { type: 'string' },
        quality:   { type: 'string' },
        narrative: { type: 'string' },
        drama:     { type: 'string' },
        moment:    { type: 'string' },
      },
      required: ['stakes', 'quality', 'narrative', 'drama', 'moment'],
      additionalProperties: false,
    },
    preview_paragraph_1:  { type: 'string' },
    preview_paragraph_2:  { type: 'string' },
    watch_summary:        { type: 'string' },
  },
  required: [
    'quality_score', 'narrative_score', 'moment_score', 'moment_basis',
    'justifications', 'preview_paragraph_1', 'preview_paragraph_2', 'watch_summary',
  ],
  additionalProperties: false,
};

// ============================================================================
// Server-grounded STAKES for friendlies.
//
// A friendly is definitionally low-consequence — no advancement, no
// seeding, nothing in the table flips. The baseline is intentionally
// low. Where BOTH teams are WC-bound and the kickoff falls within a
// few weeks of the tournament, a "final tune-up" modifier nudges
// STAKES up to ~3.5 (still below the 6.0 defense threshold so §7.5's
// by-name defense kicks in — by design; friendly-STAKES justifications
// are the auditable ones).
//
// Forward note: WC group/knockout fixtures will compute STAKES from
// advancement math (matchday, group state, table implications). This
// function handles friendlies only; the WC slice gets its own resolver.
//
// LAUNCH RESOLVER (2026-06-10): WC fixtures branch off at the top with
// a flat baseline — group=6.0 (midpoint of the voice-bible 5.5–7.0 MD1
// band), knockout=7.5 (placeholder higher baseline so KO rows don't
// fall through to friendly logic). Advancement-math derivation
// (matchday/table/must-win) is the Phase 2 slice.
// ============================================================================
export async function computeStakesScore({ homeTeamApiId, awayTeamApiId, kickoffAt, leagueSlug = null, stage = null }) {
  // WC branch — keyed on league_slug. Must run before the friendly path
  // so WC matches don't get capped at the 3.5 tune-up ceiling.
  if (leagueSlug === 'fifa-wc-2026') {
    if (stage === 'group') {
      return { score: 6.0, reason: 'wc_group_stage_baseline' };
    }
    return { score: 7.5, reason: 'wc_knockout_baseline' };
  }

  // Check whether each team has a row in the WC league (api_sports id 1
  // for FIFA WC 2026 in our DB). A team is "WC-bound" if it has a teams
  // row in that league via a prior /teams import.
  const ids = [String(homeTeamApiId), String(awayTeamApiId)].filter(Boolean);
  if (ids.length < 2) {
    return { score: 2.5, reason: 'baseline_friendly' };
  }
  const wcRows = await sql`
    SELECT t.external_ids->>'api_sports' AS api_id
      FROM teams t
      JOIN leagues l ON l.id = t.league_id
     WHERE l.slug = 'fifa-wc-2026'
       AND t.external_ids->>'api_sports' = ANY(${ids})
  `;
  const wcCount = new Set(wcRows.map((r) => r.api_id)).size;

  // Tune-up window: friendly within ~30 days of WC kickoff date. The
  // WC kicks off mid-June 2026. We don't need a precise window because
  // friendlies that are this close to the tournament are tune-ups by
  // definition — anything in the 30-day window pre-kickoff bumps.
  const WC_KICKOFF = new Date('2026-06-15T00:00:00Z'); // approximate; refine as schedule firms
  const daysToWc = (WC_KICKOFF.getTime() - new Date(kickoffAt).getTime()) / 86400000;
  const inTuneUpWindow = daysToWc > -7 && daysToWc < 45;

  if (wcCount === 2 && inTuneUpWindow) {
    return { score: 3.5, reason: 'wc_tune_up_both' };
  }
  if (wcCount === 1 && inTuneUpWindow) {
    return { score: 3.0, reason: 'wc_tune_up_one' };
  }
  if (wcCount === 2) {
    return { score: 3.0, reason: 'both_wc_bound_off_window' };
  }
  return { score: 2.5, reason: 'baseline_friendly' };
}

// ============================================================================
// Server-grounded DRAMA from /predictions comparison.
//
// /predictions returns a pairwise strength comparison block with a
// `total` percentage split (home% / away%). Closer to 50/50 → higher
// drama (the match figures to be competitive). Mapping is linear:
//   DRAMA = 7.5 - 0.05 * |home_pct - away_pct|
//   spread 0   (50/50)   → DRAMA 7.5   (true even split, ceiling)
//   spread 14 (57/43)    → DRAMA 6.8
//   spread 50 (75/25)    → DRAMA 5.0
//   spread 100 (100/0)   → DRAMA 2.5
//
// Calibration round-2 rationale (round-1 had `9.0 - 0.07 * spread`
// clamped at 9.0): the prior mapping saturated 9 of 24 fixtures at the
// 9.0 ceiling because anything inside spread ~21 hit the cap. The
// metric failed to discriminate across 38% of the slate — a true
// 50/50 read identically to a 60/40. The decompressed form below
// caps at 7.5 (still well above the 6.0 defense threshold for
// genuinely close fixtures) and gives 0.5 of DRAMA separation per
// 10 points of spread. The no-smoothing rule still holds: honest
// closeness still produces honestly-elevated DRAMA, just without
// flattening real differences. Floor stays at 2.0 (a totally lopsided
// matchup is still possible to watch, however unlikely the contest).
//
// Falls back to neutral 5.0 when /predictions can't be loaded
// (round-1 used 5.5; lowered to 5.0 to match the new ceiling's
// midpoint — unknown closeness shouldn't beat a measured-medium).
// ============================================================================
export async function computeDramaScore(fixtureApiId) {
  let comparison = null;
  let raw = null;
  try {
    const r = await apiSports.predictions(fixtureApiId);
    const p = r?.[0];
    comparison = p?.comparison ?? null;
    raw = p ?? null;
  } catch (err) {
    // Predictions endpoint occasionally errors; treat as no signal.
    return { score: 5.0, reason: 'predictions_unavailable', raw: null };
  }

  if (!comparison?.total) {
    return { score: 5.0, reason: 'no_comparison_total', raw };
  }
  const homeStr = comparison.total.home ?? '';
  const awayStr = comparison.total.away ?? '';
  const homePct = parseFloat(homeStr.replace('%', ''));
  const awayPct = parseFloat(awayStr.replace('%', ''));
  if (!Number.isFinite(homePct) || !Number.isFinite(awayPct)) {
    return { score: 5.0, reason: 'unparseable_total', raw };
  }
  const spread = Math.abs(homePct - awayPct); // 0 = even, 100 = totally lopsided
  // DRAMA = 7.5 - 0.05 * spread. See block-comment above for the
  // calibration rationale (round 2 — decompressing the round-1 ceiling
  // saturation that pinned 9 of 24 fixtures at 9.0).
  const score = Math.round((7.5 - 0.05 * spread) * 10) / 10;
  const clamped = Math.max(2.0, Math.min(9.0, score));
  return { score: clamped, reason: 'predictions_total_split', raw, homePct, awayPct };
}

// ============================================================================
// Composite — flat mean of all 5 dimensions, one decimal. SERVER ONLY.
// The model's number for this is ignored; the server computes it.
// ============================================================================
export function computeComposite({ stakes, quality, narrative, drama, moment }) {
  const sum = Number(stakes) + Number(quality) + Number(narrative) + Number(drama) + Number(moment);
  return Math.round((sum / 5) * 10) / 10;
}

// ============================================================================
// Envelope assembly.
// ============================================================================
export async function assemblePrematchEnvelope({ match, homeTeam, awayTeam }) {
  const fixtureApiId = Number(match.external_ids?.api_sports);

  // Server-grounded inputs.
  const stakes = await computeStakesScore({
    homeTeamApiId: Number(homeTeam.external_ids?.api_sports),
    awayTeamApiId: Number(awayTeam.external_ids?.api_sports),
    kickoffAt: match.kickoff_at,
    leagueSlug: match.league_slug ?? null,
    stage:      match.stage ?? null,
  });
  const drama = await computeDramaScore(fixtureApiId);

  return {
    match: {
      kickoff_at: match.kickoff_at,
      venue: match.venue ?? null,
      league: match.league_name ?? null,
      league_slug: match.league_slug ?? null,
      stage: match.stage ?? null,
      group_code: match.group_code ?? null,
      slug: match.slug,
    },
    home: {
      name: homeTeam.name,
      abbreviation: homeTeam.abbreviation ?? null,
    },
    away: {
      name: awayTeam.name,
      abbreviation: awayTeam.abbreviation ?? null,
    },
    server_grounded: {
      stakes_score: stakes.score,
      stakes_reason: stakes.reason,
      drama_score: drama.score,
      drama_reason: drama.reason,
    },
    predictions_context: drama.raw
      ? {
          comparison: drama.raw.comparison ?? null,
          // Optional: form_last_5, h2h record etc. could go here.
        }
      : null,
    win_probability: null, // friendlies are unpriced; render layer is unpriced state
  };
}

// ============================================================================
// Anthropic call — beta API with output_format json_schema. Same
// pattern proven in lib/liveGloss.js (assistant-prefill rejected by
// claude-sonnet-4-6; json_schema is the durable path).
// ============================================================================
export async function generateAnalystPass(envelope) {
  if (!client) {
    throw new Error('ANTHROPIC_API_KEY missing — cannot call Claude');
  }

  const userContent =
    `Match envelope:\n\n${JSON.stringify(envelope, null, 2)}\n\n` +
    `Write the Watch Score (QUALITY/NARRATIVE/MOMENT scores + all 5 justifications) ` +
    `and the two-paragraph Preview per the system instructions. Output STRICT JSON only.`;

  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      output_format: { type: 'json_schema', schema: ANALYST_SCHEMA },
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
// Validation gates. Modeled on aiBrief.js.
// ============================================================================
function countWords(s) {
  if (!s || typeof s !== 'string') return 0;
  return s.trim().split(/\s+/).filter(Boolean).length;
}

const VOICE_LINT = [
  // Hedge / counterfactual (Brief-shared)
  { re: /\bshould have\b/i,    label: 'hedge: "should have"' },
  { re: /\bcould have\b/i,     label: 'hedge: "could have"' },
  { re: /\bwould have\b/i,     label: 'hedge: "would have"' },
  { re: /\bseemed to\b/i,      label: 'hedge: "seemed to"' },
  { re: /\bappeared to\b/i,    label: 'hedge: "appeared to"' },
  { re: /\barguably\b/i,       label: 'hedge: "arguably"' },
  { re: /\bperhaps\b/i,        label: 'hedge: "perhaps"' },
  // Prophecy / prescription (banned in pre-match)
  { re: /\bought to\b/i,       label: 'prescription: "ought to"' },
  { re: /\bdeserved? to\b/i,   label: 'prescription: "deserved to"' },
  { re: /\bneeds? to\b/i,      label: 'prescription: "needs to"' },
  { re: /\bmust\b/i,           label: 'prescription: "must"' },
  { re: /\bsupposed to\b/i,    label: 'hedge: "supposed to"' },
  // Gambling language
  { re: /\block\b/i,           label: 'gambling: "lock"' },
  { re: /\btout\b/i,           label: 'gambling: "tout"' },
  { re: /\bguaranteed\b/i,     label: 'gambling: "guaranteed"' },
  { re: /\bsmart money\b/i,    label: 'gambling: "smart money"' },
  { re: /\bedge play\b/i,      label: 'gambling: "edge play"' },
];

// Predicted-final-score sniff: any "N-N" or "N — N" or "N to N" near
// "final" / verb of winning. We don't try to be cute — flagging any
// numeric NN-NN pattern in the preview prose is good enough; a real
// pre-match Preview cites no scoreline.
const SCORE_PATTERN = /\b\d\s*[-–—]\s*\d\b/;

export function validateAnalystPass(parsed, envelope) {
  const issues = [];

  // 1. Score ranges already enforced by JSON schema (0-10). Double-check.
  for (const k of ['quality_score', 'narrative_score', 'moment_score']) {
    const v = parsed[k];
    if (typeof v !== 'number' || v < 0 || v > 10) {
      issues.push(`${k} out of range or missing: ${v}`);
    }
  }

  // 1b. moment_basis: required enum, drives the publish-decision tripwire.
  if (!['sporting', 'cultural', 'geopolitical'].includes(parsed.moment_basis)) {
    issues.push(`moment_basis invalid or missing: ${parsed.moment_basis}`);
  }

  // 2. §7.5 — defense-zone justifications must be non-empty (≥15 chars).
  //    Dimensions in [<6.0) OR [≥9.0] require a real defense.
  const allDims = [
    { name: 'stakes',    score: envelope.server_grounded.stakes_score },
    { name: 'quality',   score: parsed.quality_score },
    { name: 'narrative', score: parsed.narrative_score },
    { name: 'drama',     score: envelope.server_grounded.drama_score },
    { name: 'moment',    score: parsed.moment_score },
  ];
  for (const d of allDims) {
    const j = parsed.justifications?.[d.name] ?? '';
    const inDefenseZone = d.score < 6.0 || d.score >= 9.0;
    if (!j || j.trim().length === 0) {
      issues.push(`${d.name}: justification missing`);
    } else if (inDefenseZone && j.trim().length < 15) {
      issues.push(`${d.name} (score=${d.score}, defense zone) justification too short: "${j}"`);
    } else if (j.length > 320) {
      // Locked ceiling: 320 chars. Round 2 surfaced that named-resonance
      // MOMENT justifications run 260-340 chars by necessity (concrete
      // resonance reads have more to say). 320 honors the editor-readable
      // §7.5-spirit prose while still catching runaways.
      issues.push(`${d.name} justification too long (${j.length} chars > 320)`);
    }
  }

  // 3. Preview word counts.
  const p1 = countWords(parsed.preview_paragraph_1);
  const p2 = countWords(parsed.preview_paragraph_2);
  if (p1 < 60 || p1 > 140) issues.push(`preview_paragraph_1 ${p1} words (need 60-140)`);
  if (p2 < 50 || p2 > 130) issues.push(`preview_paragraph_2 ${p2} words (need 50-130)`);
  const sw = countWords(parsed.watch_summary);
  if (sw < 30 || sw > 90) issues.push(`watch_summary ${sw} words (need 30-90)`);

  // 4. voiceLint.
  const allProse = [
    parsed.preview_paragraph_1,
    parsed.preview_paragraph_2,
    parsed.watch_summary,
    parsed.justifications?.stakes,
    parsed.justifications?.quality,
    parsed.justifications?.narrative,
    parsed.justifications?.drama,
    parsed.justifications?.moment,
  ].filter(Boolean).join(' ');
  for (const { re, label } of VOICE_LINT) {
    if (re.test(allProse)) issues.push(`voiceLint: ${label}`);
  }

  // 5. Predicted-final-score sniff in preview prose.
  if (SCORE_PATTERN.test(parsed.preview_paragraph_1 ?? '')) {
    issues.push('predicted-score pattern in preview_paragraph_1');
  }
  if (SCORE_PATTERN.test(parsed.preview_paragraph_2 ?? '')) {
    issues.push('predicted-score pattern in preview_paragraph_2');
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

// ============================================================================
// Full top-level: assemble + generate + validate + compute composite.
// Does NOT write to DB — the editor-gate is the caller's responsibility.
// Returns the result so the dry-run script can table it, the editor UI
// can review it, and on go-ahead the caller inserts the articles row
// with status='draft'.
// ============================================================================
export async function runAnalystPassForMatch(matchDbId) {
  const rows = await sql`
    SELECT
      m.id, m.slug, m.kickoff_at, m.venue, m.external_ids,
      m.stage, m.group_code,
      lg.name AS league_name, lg.slug AS league_slug,
      h.id   AS home_id,   h.name AS home_name,
      h.abbreviation AS home_abbreviation,
      h.external_ids AS home_external_ids,
      a.id   AS away_id,   a.name AS away_name,
      a.abbreviation AS away_abbreviation,
      a.external_ids AS away_external_ids
    FROM matches m
    JOIN leagues lg ON lg.id = m.league_id
    JOIN teams h ON h.id = m.home_team_id
    JOIN teams a ON a.id = m.away_team_id
    WHERE m.id = ${matchDbId}
  `;
  if (rows.length === 0) {
    return { ok: false, error: 'match_not_found', matchDbId };
  }
  const row = rows[0];
  const match = {
    id: row.id,
    slug: row.slug,
    kickoff_at: row.kickoff_at,
    venue: row.venue,
    external_ids: row.external_ids,
    stage: row.stage,
    group_code: row.group_code,
    league_name: row.league_name,
    league_slug: row.league_slug,
  };
  const homeTeam = {
    id: row.home_id,
    name: row.home_name,
    abbreviation: row.home_abbreviation,
    external_ids: row.home_external_ids,
  };
  const awayTeam = {
    id: row.away_id,
    name: row.away_name,
    abbreviation: row.away_abbreviation,
    external_ids: row.away_external_ids,
  };

  const envelope = await assemblePrematchEnvelope({ match, homeTeam, awayTeam });
  const gen = await generateAnalystPass(envelope);
  if (!gen.ok) {
    return { ok: false, match_id: match.id, slug: match.slug, envelope, error: gen.error, raw: gen.raw };
  }

  const validation = validateAnalystPass(gen.parsed, envelope);
  const composite = computeComposite({
    stakes:    envelope.server_grounded.stakes_score,
    quality:   gen.parsed.quality_score,
    narrative: gen.parsed.narrative_score,
    drama:     envelope.server_grounded.drama_score,
    moment:    gen.parsed.moment_score,
  });

  return {
    ok: true,
    match_id: match.id,
    slug: match.slug,
    envelope,
    parsed: gen.parsed,
    composite,
    dimensions: {
      stakes:    envelope.server_grounded.stakes_score,
      quality:   gen.parsed.quality_score,
      narrative: gen.parsed.narrative_score,
      drama:     envelope.server_grounded.drama_score,
      moment:    gen.parsed.moment_score,
    },
    moment_basis: gen.parsed.moment_basis,
    validation,
  };
}

// ============================================================================
// Composite recomputation on edit — exposed so the admin save-action can
// recompute when an editor changes a dim score. Same flat-mean math as
// computeComposite above, but takes the full dim object as it lives in
// the DB row (any of which the editor may have updated).
// ============================================================================
export function recomputeCompositeFromRow(row) {
  return computeComposite({
    stakes:    row.stakes_score,
    quality:   row.quality_score,
    narrative: row.narrative_score,
    drama:     row.drama_score,
    moment:    row.moment_score,
  });
}
