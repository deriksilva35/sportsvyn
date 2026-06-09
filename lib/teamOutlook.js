/**
 * lib/teamOutlook.js — team_outlook generator (PRE-TOURNAMENT variant).
 *
 * Mirrors lib/dailyCardIntro.js: inline locked SYSTEM_PROMPT → assemble
 * envelope → Anthropic json_schema call → server-side validate (retry once
 * on fail) → lib/blurbs.insertPendingBlurb. NEVER auto-publishes. Editor
 * approval is mandatory.
 *
 * This is the PRE-TOURNAMENT variant of the §18 team_outlook brief: no
 * team has played a 2026 World Cup match yet. The prompt forbids any
 * reference to results / scores / xG / "form so far"; the validator
 * enforces it with a hard grounding gate.
 *
 * Re-runs UPSERT — any existing pending_review row for the same (team,
 * blurb_type) is removed first so the queue never stacks duplicates.
 * editor_approved rows are NEVER touched here.
 */

import Anthropic from '@anthropic-ai/sdk';
import { sql } from './db.js';
import { getCurrentBlurb, insertPendingBlurb } from './blurbs.js';
import { getTopN } from './rankings.js';

// claude-sonnet-4-20250514 (the library's listed model) does NOT support the
// Anthropic beta json_schema output format. Falling back to claude-sonnet-4-6
// — same model the Daily Card runs on — which does. Voice register unchanged.
export const MODEL = 'claude-sonnet-4-6';
export const MAX_TOKENS = 800;
export const TEMPERATURE = 0.55;
const WC_LEAGUE_SLUG = 'fifa-wc-2026';

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// =============================================================================
// LOCKED SYSTEM PROMPT
// =============================================================================
export const SYSTEM_PROMPT = `You are a Sportsvyn editor writing the team_outlook blurb that anchors a team's profile page. Two paragraphs in Source Serif italic register — measured, specific, present-tense. The blurb is editor-gated before it surfaces; this draft must read like work you stand behind.

This is the PRE-TOURNAMENT variant. NO team has played a 2026 World Cup match yet. There are no tournament results, no goals, no xG, no "form so far". The envelope contains pre-tournament inputs only — Power Rankings position, squad composition, group draw, group-stage opener.

═══════════════════════════════════════════════════════════════════════
§17.3 — EVALUATIVE-CLAIMS GUARDRAIL  (inviolable)

  ASSERT ONLY FACTS PRESENT IN THE DATA ENVELOPE. Do NOT add the team's
    confederation, continent, qualification path, a venue's city, an
    opponent's nationality / region / continent, or ANY external
    knowledge not in the envelope — even if you believe it is true.
    If a fact is not in the envelope, do not state it. Naming the city
    of a stadium, the continent of an opponent, or a confederation when
    those are not provided is a grounding failure and will be rejected.

  GROUNDED: every evaluative claim about the team must trace to a
    concrete input in the envelope (a ranking number, a squad fact, a
    named fixture, a coach decision present in the data). If you can't
    point at the envelope row that supports it, do not write it.

  NO PREDICTION: no "will win / will advance / should win / ought to /
    deserves to / sets up nicely for / favored to / poised to / will
    likely face / will probably / is expected to / are expected to".
    No framing that asserts what HAPPENS next. Frame difficulty or
    pressure as an OBSERVABLE TO WATCH, not an expected outcome.

  NO EXTERNAL-EVENT CLAIMS — POSITIVE OR NEGATIVE: Do NOT make any
    claim about what a coach, player, manager, federation, or pundit
    has or has NOT said, decided, committed to, announced, picked,
    promised, or done publicly. This INCLUDES NEGATIONS — "has not
    committed", "is yet to confirm", "has said nothing about", "has
    not named", "has yet to settle on", "has refused to comment".
    You have no access to press conferences, team news, or public
    statements. Write ONLY about what the squad data, ranking, and
    group draw show. A selection question must be framed as an
    observable that the data itself raises (e.g. "eleven midfielders
    compete for three starting roles", "the seven-attacker pool
    leaves the front line unsettled on the roster sheet"), NEVER as
    a claim about what the coach has or hasn't decided publicly.

  NO MORALE / ATTITUDE: no claims about how a team "feels", "wants",
    "believes", "hungers for", "is desperate to", "has chemistry",
    "is hungry", "is confident", "lacks belief". Internal states are
    not in the envelope.

  HEDGE ONLY WHEN THE DATA HEDGES: do not insert "perhaps", "maybe",
    "could be argued" to dodge a claim. If the data supports the claim,
    state it. If the data is ambiguous, name the ambiguity directly.

  CLOSE ON A QUESTION: paragraph 2 ends on an unanswered question —
    a specific thing the reader should want their first match to begin
    to answer. Not a rhetorical flourish. Not "we'll see".
═══════════════════════════════════════════════════════════════════════
§18 — STRUCTURE

  Two paragraphs joined by a single blank line. No headings. No bullets.

  PARAGRAPH 1 — THE STANDING (60–100 words):
    Lead with the team's position in Sportsvyn's Power Rankings (rank
    and score, written as "ranked Nth in Sportsvyn's Power Rankings"
    or "second in Sportsvyn's Power Rankings"). Name the squad's
    defining compositional pattern — a fact grounded in the roster
    data in the envelope (a positional balance, a named pillar that
    appears in the squad list, a coach's selection signal). Reference
    HOW they arrive — group draw, seeding, confederation path. Name
    ONE observable that the squad/ranking data supports. End on a
    specific unresolved tension going into the tournament.

  PARAGRAPH 2 — THE OPENING TEST (60–100 words):
    Specify the group-stage opener by NAMED opponent and date (from
    the envelope's next_event). Frame what the FIRST match will begin
    to reveal — an open question, not a prediction. Reference the one
    observable the opener begins to answer. The FINAL SENTENCE of
    paragraph 2 MUST be the unanswered question itself — a sentence
    ending in "?". Do NOT place the question mid-paragraph and then
    close on a declarative summary. The last thing the reader sees
    must be the question.

  HARD TOTAL: 140–200 words across both paragraphs.

  KEY_PHRASE: the 3–6 word phrase from your body that most distinctly
  captures this team's outlook. Pulled VERBATIM from your prose.

§18.2 — OUTPUT SCHEMA (strict JSON):
{
  "p1":  "string — 60–100 words, no leading/trailing whitespace, single paragraph",
  "p2":  "string — 60–100 words, ends with '?', references the named opener",
  "key_phrase": "string — 3–6 words pulled verbatim from p1 or p2",
  "estimated_freshness_hours": "integer — how long this blurb stays accurate before regeneration is warranted; pre-tournament default ~168 (one week)",
  "self_check": "string — one sentence: which specific envelope rows your evaluative claims trace to"
}

§18.4 — VALIDATION RULES (server re-checks these; if you fail, your
draft is REJECTED and regenerated):
  · Word counts: P1 60–100, P2 60–100, total 140–200. Hard limits.
  · Single paragraph each (no internal blank lines).
  · §17.3 guardrail honored (no prophecy verbs, no morale/attitude
    claims, no gambling language, no "looked / seemed / felt").
  · No repetition: P2 must not restate P1's anchor fact in the same words.
  · P2 must contain the named opener (the opponent's name from the
    envelope's next_event).
  · P2's FINAL SENTENCE must be the question — i.e. P2 ends with "?".
    A question that appears mid-paragraph followed by a declarative
    summary FAILS this check.
  · NO external-event claims (positive or negative) about what coaches/
    players/managers/federations have or have not said/decided/named/
    committed to. See §17.3 NO EXTERNAL-EVENT CLAIMS clause.
  · PRE-TOURNAMENT GROUNDING GATE (mandatory): NO references to
    results that have not happened. SPECIFICALLY FORBIDDEN — score
    patterns like "3–1", "2-0", "1 to 0"; verbs in tournament context
    "won the opener / lost to / drew with / scored against / conceded";
    statistical artifacts of a played match ("xG", "xGA", "possession
    share", "shots on target so far"); phrases that imply a played
    match ("opened with", "started the tournament with", "so far in
    the group stage", "form so far"). Reference future fixtures as
    future. Reference squad composition and ranking position as
    present.
  · NO EXTERNAL KNOWLEDGE: every named player, opponent, venue, group
    letter, and number you cite MUST appear in the envelope. Do NOT
    state any city, continent, confederation, qualification path, or
    region unless that specific string appears in the envelope. If
    the envelope gives "Mercedes-Benz Stadium" without a city, you
    name the stadium and stop — you do NOT add "in Atlanta". If
    confederation is not in the envelope, you do not write "CONCACAF",
    "UEFA", "European side", or any continental descriptor.

  · COMPARATIVE RANKING — only when grounded. The envelope carries
    THIS team's rank/score under current_state.ranking AND the opener
    opponent's rank/score under context.opponent_ranking (which may
    be null). You may use comparative framing ("higher-ranked
    opponent", "ranked above them", "a side ranked Nth") ONLY when
    context.opponent_ranking is NOT null and you cite the opponent's
    actual rank (or the comparison is unambiguous from the two
    numbers). If context.opponent_ranking is null, do NOT assert any
    relative ranking — phrase the opener around the named opponent
    and the squad's own observables instead.

═══════════════════════════════════════════════════════════════════════
§18.5 — CALIBRATION  (your voice anchor)

This is a PRE-TOURNAMENT GOOD example. Read it for register, not for
its specific facts. Note: rank+squad+draw in P1; named opener with an
open question in P2; ends on a question; no results referenced.

  "France arrive at the 2026 World Cup ranked third in Sportsvyn's Power
  Rankings, the deepest midfield in the field and the only side with
  three Champions League winners across its starting eleven. The draw
  placed them in Group A alongside Australia, Switzerland, and Iran —
  a path that defers the early stress test while burdening Deschamps
  with the question every reigning runner-up faces: how to keep edge
  from sliding into entitlement. The pieces remain. Whether they
  cohere is the open question.

  Their opener arrives June 13 against Australia in Vancouver. The
  match cannot settle France's tournament; what it begins to settle is
  whether the new midfield triangle plays like a unit or a list. Two
  of the three have started together fewer than ten times for the
  national team. Does the shape hold under tournament pressure, or do
  the cracks start in week one?"

WHAT BAD LOOKS LIKE (do NOT do these):
  · Generic praise: "a side full of talent and ambition"
  · Attitude/morale: "they want it more / hungry / believe / desperate"
  · Prediction: "will lift the trophy / should win the group / favored
    to advance / are dark horses"
  · Hallucinated results: "after their 2–1 win over X, they look
    sharper" — NO MATCHES HAVE BEEN PLAYED
  · Hedging dodge: "perhaps the midfield could prove pivotal" — say
    what the data says or don't make the claim
  · Closing on a flourish, not a question

═══════════════════════════════════════════════════════════════════════
Output STRICT JSON. No commentary. No code fences. No markdown.`;

const SCHEMA = {
  type: 'object',
  properties: {
    p1: { type: 'string' },
    p2: { type: 'string' },
    key_phrase: { type: 'string' },
    estimated_freshness_hours: { type: 'integer' },
    self_check: { type: 'string' },
  },
  required: ['p1', 'p2', 'key_phrase'],
  additionalProperties: false,
};

// =============================================================================
// Envelope assembly — what the model sees
// =============================================================================
export async function assembleEnvelope({ teamId }) {
  if (!Number.isFinite(teamId)) throw new Error('teamId required');

  const teamRows = await sql`
    SELECT id, slug, name, short_name, abbreviation, confederation, coach_name,
           fifa_rank, group_code, metadata
      FROM teams WHERE id = ${teamId} LIMIT 1
  `;
  if (teamRows.length === 0) throw new Error('team not found: ' + teamId);
  const team = teamRows[0];

  // Ranking — the live published edition (covers the full 48-team WC field).
  const top48 = await getTopN({ listSlug: 'team-power', leagueSlug: WC_LEAGUE_SLUG, limit: 48 });
  const ranked = top48.find(r => r.team_id === teamId) ?? null;

  // Group-stage opener — the team's first WC match, group stage.
  const openerRows = await sql`
    SELECT m.slug, m.kickoff_at, m.venue, m.stage, m.group_code,
           ht.name AS home_name, ht.slug AS home_slug,
           at.name AS away_name, at.slug AS away_slug
      FROM matches m
      JOIN teams ht ON ht.id = m.home_team_id
      JOIN teams at ON at.id = m.away_team_id
      JOIN leagues lg ON lg.id = m.league_id
     WHERE lg.slug = ${WC_LEAGUE_SLUG}
       AND m.stage = 'group'
       AND (m.home_team_id = ${teamId} OR m.away_team_id = ${teamId})
     ORDER BY m.kickoff_at ASC LIMIT 1
  `;
  const opener = openerRows[0] ?? null;
  let nextEvent = null;
  let opponentRanking = null;
  if (opener) {
    const isHome = opener.home_slug === team.slug;
    const oppSlug = isHome ? opener.away_slug : opener.home_slug;
    nextEvent = {
      kind: 'group_opener',
      opponent: isHome ? opener.away_name : opener.home_name,
      opponent_slug: oppSlug,
      home_or_away: isHome ? 'home' : 'away',
      kickoff_utc: opener.kickoff_at,
      kickoff_date_pt: new Date(opener.kickoff_at).toLocaleDateString('en-US', {
        timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric',
      }),
      venue: opener.venue,
      group_code: opener.group_code,
    };
    // Look up the opener opponent's row in the SAME ranking edition. If the
    // opponent isn't in the WC field's ranking (rare — non-WC opener
    // edge-case), this stays null and the prompt rule forbids comparative
    // framing.
    const oppRow = top48.find(r => r.team_slug === oppSlug) ?? null;
    if (oppRow) {
      opponentRanking = { rank: oppRow.rank, score: oppRow.score };
    }
  }

  // All group fixtures for context (who else is in the group).
  const groupOpponents = team.group_code ? await sql`
    SELECT DISTINCT
           CASE WHEN m.home_team_id = ${teamId} THEN at.name ELSE ht.name END AS name,
           CASE WHEN m.home_team_id = ${teamId} THEN at.slug ELSE ht.slug END AS slug
      FROM matches m
      JOIN teams ht ON ht.id = m.home_team_id
      JOIN teams at ON at.id = m.away_team_id
      JOIN leagues lg ON lg.id = m.league_id
     WHERE lg.slug = ${WC_LEAGUE_SLUG}
       AND m.stage = 'group'
       AND m.group_code = ${team.group_code}
       AND (m.home_team_id = ${teamId} OR m.away_team_id = ${teamId})
  ` : [];

  // Squad — api-sports-imported players for this team (skip legacy NULL-api
  // duplicates if any remain on the branch; on DEV today, all are imported).
  const squadRows = await sql`
    SELECT id, full_name, known_as, position
      FROM players
     WHERE current_team_id = ${teamId}
       AND external_ids->>'api_sports' IS NOT NULL
     ORDER BY
       CASE position WHEN 'GK' THEN 1 WHEN 'DEF' THEN 2 WHEN 'MID' THEN 3 WHEN 'ATT' THEN 4 ELSE 5 END,
       full_name
     LIMIT 30
  `;
  const byPos = { GK: [], DEF: [], MID: [], ATT: [], OTHER: [] };
  for (const p of squadRows) {
    const k = ['GK', 'DEF', 'MID', 'ATT'].includes(p.position) ? p.position : 'OTHER';
    byPos[k].push(p);
  }
  const squadComposition = {
    total: squadRows.length,
    by_position: { GK: byPos.GK.length, DEF: byPos.DEF.length, MID: byPos.MID.length, ATT: byPos.ATT.length, OTHER: byPos.OTHER.length },
    roster: squadRows.map(p => ({ name: p.known_as || p.full_name, position: p.position })),
  };

  // Trajectory — prior current blurb (for the model to know what we ALREADY
  // said about this team, so the new draft doesn't restate it verbatim).
  const previousOutlook = await getCurrentBlurb({ blurbType: 'team_outlook', teamId });

  return {
    pt_day: new Date().toISOString().slice(0, 10),
    entity: {
      kind: 'team',
      id: team.id,
      slug: team.slug,
      name: team.name,
      short_name: team.short_name,
      abbreviation: team.abbreviation,
      confederation: team.confederation,
      coach_name: team.coach_name,
      fifa_rank: team.fifa_rank,
      group_code: team.group_code,
    },
    current_state: {
      ranking: ranked ? {
        list: 'team-power',
        rank: ranked.rank,
        score: ranked.score,
        edition_label: 'Pre-tournament',
      } : null,
      tournament_record: null,   // explicit null — no WC matches played
      form_window: null,
    },
    context: {
      next_event: nextEvent,
      opponent_ranking: opponentRanking,
      group_opponents: groupOpponents.map(o => ({ name: o.name, slug: o.slug })),
      tournament_position: team.group_code
        ? `Group ${team.group_code} (group-stage opener pending)`
        : 'group-stage opener pending',
    },
    squad_composition: squadComposition,
    trajectory: {
      previous_outlook_blurb: previousOutlook
        ? { id: previousOutlook.id, body: previousOutlook.body, published_at: previousOutlook.published_at }
        : null,
    },
  };
}

// =============================================================================
// Anthropic call
// =============================================================================
export async function generateTeamOutlook(envelope) {
  if (!client) throw new Error('ANTHROPIC_API_KEY missing — cannot call Claude');

  const userContent =
    `Envelope:\n\n${JSON.stringify(envelope, null, 2)}\n\n` +
    `Write the team_outlook blurb for ${envelope.entity.name} per the system prompt. ` +
    `Two paragraphs, 60–100 words each, total 140–200. ` +
    `This is the PRE-TOURNAMENT variant — no World Cup matches have been played. ` +
    `Output STRICT JSON only.`;

  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
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
// Validation — voice lint + structure + pre-tournament grounding gate
// =============================================================================
const VOICE_LINT = [
  // Prophecy / prescription
  { re: /\bwill (?:win|advance|lift|prevail|crash|exit|cruise|dominate|claim|reach)\b/i, label: 'prophecy: "will X"' },
  { re: /\bshould (?:win|advance|lift|prevail|reach|beat|cruise)\b/i,                     label: 'prophecy: "should X"' },
  { re: /\bought to\b/i,                                                                  label: 'prescription: "ought to"' },
  { re: /\bdeserves? to\b/i,                                                              label: 'prescription: "deserves to"' },
  { re: /\b(?:are|is) (?:favored|favoured|poised|tipped|expected) to\b/i,                 label: 'prediction: "favored/poised/expected to"' },
  { re: /\bsets? up nicely\b/i,                                                           label: 'prediction: "sets up nicely"' },
  { re: /\bwill (?:likely|probably)\b/i,                                                  label: 'prediction: "will likely/probably"' },
  { re: /\b(?:is|are) likely to\b/i,                                                      label: 'prediction: "is/are likely to"' },
  { re: /\bare expected to\b/i,                                                           label: 'prediction: "are expected to"' },
  // External-event claims (positive OR negative). Subject — coach/manager/player —
  // followed by a public-statement verb. These describe events outside the envelope.
  { re: /\b(?:coach|manager|head coach|federation)[\s\S]{0,40}\b(?:has|have|is|are|hasn't|haven't|hasn't yet|has yet to|is yet to|are yet to|publicly|not yet|has not|have not)\b[\s\S]{0,40}\b(?:committed|named|announced|said|confirmed|decided|chosen|selected|settled|picked|promised|comment(?:ed)?|reveal(?:ed)?)\b/i,
    label: 'external-event claim about coach/manager (no public-info source)' },
  { re: /\b(?:coach|manager|head coach)[\s\S]{0,30}\b(?:has not|hasn't|is yet to|has yet to|not publicly)\b/i,
    label: 'external-event negation about coach/manager' },
  { re: /\b(?:has|have|is|are)\s+(?:publicly|not publicly)\s+(?:committed|named|announced|said|confirmed)\b/i,
    label: 'public-statement claim (positive or negative)' },
  // Morale / attitude
  { re: /\bwant it more\b/i,                                                              label: 'attitude: "want it more"' },
  { re: /\bhungry\b/i,                                                                    label: 'attitude: "hungry"' },
  { re: /\bdesperate to\b/i,                                                              label: 'attitude: "desperate to"' },
  { re: /\bchemistry\b/i,                                                                 label: 'attitude: "chemistry"' },
  { re: /\bbelief\b/i,                                                                    label: 'attitude: "belief"' },
  { re: /\bswagger\b/i,                                                                   label: 'attitude: "swagger"' },
  { re: /\blooked\b/i,                                                                    label: 'observation-verb: "looked"' },
  { re: /\bseemed\b/i,                                                                    label: 'observation-verb: "seemed"' },
  // Gambling
  { re: /\block\b/i,        label: 'gambling: "lock"' },
  { re: /\btout\b/i,        label: 'gambling: "tout"' },
  { re: /\bsmart money\b/i, label: 'gambling: "smart money"' },
  { re: /\bedge play\b/i,   label: 'gambling: "edge play"' },
  { re: /\bvalue play\b/i,  label: 'gambling: "value play"' },
  { re: /\bover\/under\b/i, label: 'gambling: "over/under"' },
  // Cliché
  { re: /\btale of two halves\b/i,                  label: 'cliché' },
  { re: /\bbeautiful game\b/i,                      label: 'cliché' },
  { re: /\bwriting (?:their|his|her) own story\b/i, label: 'cliché' },
  { re: /\bdark horse(?:s)?\b/i,                    label: 'cliché: "dark horse"' },
  { re: /\bfull of talent and ambition\b/i,         label: 'cliché: "talent and ambition"' },
];

// Pre-tournament grounding gate — flags references to results that haven't happened.
const PRE_TOURNAMENT_FORBIDDEN = [
  { re: /\b\d\s*[-–—]\s*\d\b/,                                                                   label: 'score-pattern (N–N)' },
  { re: /\b(?:won|lost|drew) (?:against|to|with|by|the opener|their opener)\b/i,                  label: 'past-result verb in tournament context' },
  { re: /\b(?:scored|conceded)\s+(?:\d+|a|the|against)\b/i,                                       label: 'past goal-event reference' },
  { re: /\bopened (?:with|the tournament|their (?:campaign|tournament))\b/i,                       label: 'implies opening match has happened' },
  { re: /\bstarted (?:with|the tournament|their (?:campaign|tournament))\b/i,                      label: 'implies tournament has started' },
  { re: /\bso far in the (?:group stage|tournament)\b/i,                                          label: 'implies played matches' },
  { re: /\bform so far\b/i,                                                                       label: 'implies played form' },
  { re: /\bxG[A]?\b/,                                                                              label: 'xG/xGA reference (no matches yet)' },
  { re: /\bpossession (?:share|percentage|pct)\b/i,                                               label: 'possession stat (no matches yet)' },
  { re: /\bshots on target\b/i,                                                                   label: 'shots stat (no matches yet)' },
];

export function validateTeamOutlook(parsed, envelope) {
  const issues = [];
  const p1 = (parsed?.p1 ?? '').trim();
  const p2 = (parsed?.p2 ?? '').trim();
  const body = p1 + '\n\n' + p2;

  const wordsOf = (s) => s.split(/\s+/).filter(Boolean);
  const w1 = wordsOf(p1).length;
  const w2 = wordsOf(p2).length;
  const wT = w1 + w2;

  // Word counts
  if (w1 < 60 || w1 > 100) issues.push(`p1_word_count: ${w1} (need 60–100)`);
  if (w2 < 60 || w2 > 100) issues.push(`p2_word_count: ${w2} (need 60–100)`);
  if (wT < 140 || wT > 200) issues.push(`total_word_count: ${wT} (need 140–200)`);

  // Single paragraph each
  if (/\n\s*\n/.test(p1)) issues.push('p1 has internal blank line');
  if (/\n\s*\n/.test(p2)) issues.push('p2 has internal blank line');

  // VOICE_LINT
  for (const { re, label } of VOICE_LINT) {
    if (re.test(body)) issues.push(`voiceLint: ${label}`);
  }

  // Pre-tournament grounding gate
  for (const { re, label } of PRE_TOURNAMENT_FORBIDDEN) {
    if (re.test(body)) issues.push(`pre_tournament_violation: ${label}`);
  }

  // P2 must reference the named opener (opponent in next_event)
  const opp = envelope?.context?.next_event?.opponent;
  if (opp) {
    if (!p2.toLowerCase().includes(opp.toLowerCase())) issues.push(`p2 missing named opener: "${opp}"`);
  }

  // P2 must end on a question
  const lastChar = p2.trim().slice(-1);
  if (lastChar !== '?') issues.push('p2 does not end with a question mark');

  // No repetition: P1 and P2 should not share 10+ consecutive words verbatim.
  // 6 tripped on boilerplate ("in Sportsvyn's Power Rankings with a"); 10 only
  // fires on real content reuse.
  const long1 = p1.toLowerCase().split(/\s+/);
  const long2 = p2.toLowerCase();
  for (let i = 0; i + 10 <= long1.length; i++) {
    const span = long1.slice(i, i + 10).join(' ');
    if (long2.includes(span)) { issues.push(`p1/p2 repetition: "${span}"`); break; }
  }

  // Grounding lint — whitelist approach.
  //
  // Job: catch a named player / team / place / number that does NOT appear
  // anywhere in the envelope. NOT: sentence-initial capitals, possessives,
  // boilerplate phrases the SYSTEM_PROMPT itself supplies ("Sportsvyn",
  // "Power Rankings", "World Cup", "FIFA"), months / days / Group letters.
  //
  // 1) Build the envelope token set: every Capitalized word that appears in
  //    the envelope strings (team names, opponent, venue, roster names,
  //    group code, etc.). Stored lowercased + accent-stripped so the body's
  //    "Modric" matches the envelope's "Modrić".
  // 2) Tokenize the body's proper-noun sequences. Strip leading "'s",
  //    accents, hyphenated pieces. For each token:
  //       - in BOILERPLATE_ALLOW set → OK
  //       - matches an envelope token → OK
  //       - else → flag
  // 3) Multi-word names ("Cape Verde Islands") are normalized for both
  //    body and envelope before comparison, so the body's "Cape Verde"
  //    matches the envelope's "Cape Verde Islands".
  const norm = (s) => (s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

  // Collect every string field anywhere in the envelope into one bag.
  const envStrings = [];
  function collect(v) {
    if (v == null) return;
    if (typeof v === 'string') envStrings.push(v);
    else if (Array.isArray(v)) v.forEach(collect);
    else if (typeof v === 'object') Object.values(v).forEach(collect);
  }
  collect(envelope);
  const envTokens = new Set();
  for (const s of envStrings) {
    // Pull every Capitalized word (and hyphenated pieces) from the string.
    const ws = s.match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]*/g) ?? [];
    for (const w of ws) envTokens.add(norm(w));
  }

  // Prompt-supplied boilerplate + standard English vocabulary that should
  // not be flagged as ungrounded.
  const BOILERPLATE_ALLOW = new Set([
    // Product / publication
    'sportsvyn', 'power', 'rankings', 'fifa', 'world', 'cup', 'group', 'pre-tournament', 'tournament',
    // Months / days
    'january','february','march','april','may','june','july','august','september','october','november','december',
    'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
    // Articles, conjunctions, prepositions, auxiliaries, common adverbs
    'the','a','an','and','but','or','for','from','into','at','by','in','on','of','to','with','their','they','it','its','that','this','these','those','as','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','can','may','might','must','also','still','yet','then','than','than','so','if','though','because','while',
    // Question words + sentence starters
    'whether','does','how','what','why','who','when','where','which','can','will','do',
    // Common adjectives / descriptors used in the prompt example
    'open','new','old','top','bottom','first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth','only','named','listed','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen','twenty','twenty-six',
    // Editorial connective vocabulary
    'their','they','them','its','his','her','our','we','i','you',
    // Sentence-initial verbs / gerunds — common English prose, not proper nouns.
    'placed','drawn','playing','seeded','ranked','carrying','anchored','led','built',
    'facing','set','named','listed','given','entering','arriving','heading',
  ]);

  // Proper-noun regex — leading + trailing char classes cover the full Latin-1
  // accent set we see in WC squads (â ã ê î ô õ û included alongside the prior
  // á é í ó ú etc.). Without ã, "Guimarães" tokenized to "Guimar" and missed
  // the envelope's "Guimarães".
  const propers = body.match(/\b[A-ZÁÀÂÃÄÇÉÈÊËÍÌÎÏÑÓÒÔÕÖÚÙÛÜ][A-Za-zÁÀÂÃÄÇÉÈÊËÍÌÎÏÑÓÒÔÕÖÚÙÛÜáàâãäçéèêëíìîïñóòôõöúùûü'-]*/g) ?? [];
  const unmatched = [];
  for (const raw of propers) {
    // Strip trailing possessive "'s"
    let tok = raw.replace(/['’]s$/, '');
    if (tok.length < 3) continue;
    const n = norm(tok);
    if (BOILERPLATE_ALLOW.has(n)) continue;
    if (envTokens.has(n)) continue;
    // Hyphenated compound — accept if every part is allowed (e.g. "Mercedes-Benz")
    if (tok.includes('-')) {
      const parts = tok.split('-').map(norm);
      if (parts.every(p => BOILERPLATE_ALLOW.has(p) || envTokens.has(p))) continue;
    }
    unmatched.push(raw);
  }
  if (unmatched.length > 0) issues.push(`grounding: tokens not in envelope: ${[...new Set(unmatched)].slice(0, 8).join(', ')}`);

  return {
    ok: issues.length === 0,
    issues,
    word_counts: { p1: w1, p2: w2, total: wT },
  };
}

// =============================================================================
// Runner — assemble, generate, validate (retry once), UPSERT pending_review
// =============================================================================
export async function runTeamOutlookForTeam({ teamId }) {
  const envelope = await assembleEnvelope({ teamId });

  // First attempt
  let gen = await generateTeamOutlook(envelope);
  if (!gen.ok) return { ok: false, error: gen.error, raw: gen.raw, envelope };
  let validation = validateTeamOutlook(gen.parsed, envelope);
  let attempts = 1;

  // Retry once on validation failure
  if (!validation.ok) {
    const retry = await generateTeamOutlook(envelope);
    attempts = 2;
    if (retry.ok) {
      const retryValidation = validateTeamOutlook(retry.parsed, envelope);
      // Prefer the retry if it validates; otherwise keep the first attempt.
      if (retryValidation.ok || retryValidation.issues.length < validation.issues.length) {
        gen = retry;
        validation = retryValidation;
      }
    }
  }

  const p1 = (gen.parsed?.p1 ?? '').trim();
  const p2 = (gen.parsed?.p2 ?? '').trim();
  const body = p1 + '\n\n' + p2;

  // Idempotency — remove any prior pending_review draft for this team+type
  // BEFORE inserting. editor_approved rows are untouched.
  await sql`
    DELETE FROM editorial_blurbs
     WHERE blurb_type = 'team_outlook' AND team_id = ${teamId} AND status = 'pending_review'
  `;

  const inserted = await insertPendingBlurb({
    blurbType: 'team_outlook',
    entityRef: { kind: 'team', id: teamId },
    body,
    generationInput: {
      variant: 'pre_tournament',
      envelope,
      parsed: gen.parsed,
      key_phrase: gen.parsed?.key_phrase ?? null,
      estimated_freshness_hours: gen.parsed?.estimated_freshness_hours ?? null,
      self_check: gen.parsed?.self_check ?? null,
      validation,
      attempts,
      model: MODEL,
      usage: gen.usage ?? null,
    },
    voiceModelVersion: '1.0',
  });

  return { ok: true, row: inserted, parsed: gen.parsed, envelope, validation, attempts };
}
