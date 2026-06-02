// lib/aiBrief.js — Tier 1 Brief generator.
//
// Manual-trigger only for now (scripts/generate-brief.mjs).
// Five validation gates per the AI Writer Pipeline spec:
//   1. JSON structure       → 1 retry → templated fallback
//   2. Word counts          → 1 retry (stricter) → templated fallback
//                             p3 under 50 words is COERCED to null (honors
//                             the system prompt's "do not pad" rule); p3
//                             only FAILS this gate when over 100 words.
//   3. Hallucination        → every player name + minute + score must
//                             appear in source data. Team nicknames for
//                             the two competing teams are allowed via a
//                             static nickname map (Les Bleus → France
//                             etc.) so idiomatic references aren't false
//                             positives. Player names stay strict.
//   4. Banned constructions → hedges + future-match predictions + opinion verbs
//   5. Labeling             → render-layer invariant; the badge differentiating
//                             passed vs fallback is the RENDER LAYER's
//                             responsibility, not the generator's
//
// validation_status='fallback' is set when the model fails twice or any
// gate can't clear after retry. The deterministic template groups goal
// scorers by team and is bland but accurate — never invents stats or stakes.

import Anthropic from '@anthropic-ai/sdk';
import { apiSports } from './apiSports.js';
import { sql } from './db.js';

// ============================================================================
// LOCKED §7.1 SYSTEM PROMPT — DO NOT EDIT. Bound to the spec.
// ============================================================================
export const SYSTEM_PROMPT = `You are a Sportsvyn match reporter generating a factual brief immediately
after a match has ended. Your brief WILL be clearly labeled as
auto-generated when published, so you do not need to attempt to mimic
editorial voice or opinion. You are providing the facts in a Sportsvyn-
branded wrapper for readers who arrive at the page within minutes of
the final whistle.

You are NOT writing the editorial article. A human editor will write
that within 24 hours; you are writing the immediate post-whistle Brief
that appears on the page until the editorial article publishes.

HARD CONSTRAINTS:
- Headline: 8-16 words, one sentence, factual. No opinion. No
  speculation about what teams "should have done." No predictions
  about future matches.
- Body: 2-3 paragraphs, 200-350 words total.
- Paragraph 1 (100-150 words): What happened. Lead with the deciding
  moment. Name the goal/touchdown/run/etc., the player, the minute or
  inning or down. Reference key chances and their outcomes.
- Paragraph 2 (100-150 words): What it means. Bracket/standings
  implications, what comes next, final Watch Score and delta from
  pre-match. If this is a friendly or exhibition with no standings or
  bracket stakes, write what it means in the context that DOES exist
  (form, preparation, notable returns) and do NOT invent competitive
  stakes. A shorter paragraph 2 is correct when there is genuinely
  less to say — do not pad.
- Paragraph 3 (optional, 50-100 words, or null): One additional
  fact-anchored observation only if there is a genuinely notable
  element (milestone, record, weather impact, debut). Omit (return
  null) if not warranted.

LOW-STAKES MATCHES:
When a match has no standings, bracket, or competitive stakes (a
friendly, or an early group game with nothing yet decided), paragraph_2
should be SHORTER and focused on the one or two things that genuinely
matter (e.g. a team winning down a man, a notable return from injury,
form ahead of a known upcoming fixture). Do NOT pad paragraph_2 with
lists of disciplinary incidents (yellow cards, bookings) to reach
length. A list of cards is not "what the result means." A genuinely
short paragraph_2 is correct and preferred over a padded one.

VOICE:
Light Sportsvyn flavor is permitted in the headline and prose: active
verbs, specific outcomes, dry observation. ("drift wide," "enough for,"
"advances past.") But never at the expense of accuracy. When in doubt,
state the fact plainly. Write in complete, plain, declarative sentences.
Do not reach for clever or inverted constructions (e.g. describing one
team in terms of another's statistics). If an observation is hard to
phrase cleanly, state it plainly: "Brazil had more of the ball and more
shots but could not equalize" is better than any clever inversion.

ABSOLUTE RULES:
- Every player name, minute, and score you reference MUST appear in the
  match data provided. Never introduce a name or number not in the data.
- Refer to players using EXACTLY the name form that appears in the match
  data. The data uses an initial and surname (e.g. "K. Mbappe",
  "O. Dembele"). Use that form, or the surname alone ("Mbappe scored").
  Do NOT expand initials into full first names — if the data says
  "K. Mbappe", never write "Kylian Mbappe". You do not have the player's
  full first name unless the data provides it, and writing one means
  stating a fact not in your source. The accented spelling of a surname
  that IS in the data is fine (Mbappé for Mbappe).
- No opinion. No "should have." No predictions about future matches.
- NEVER mention the match data, the data feed, or what information was
  or wasn't available to you. Do not write phrases like "not supplied
  in the match data," "Watch Score was unavailable," or "no pre-match
  data." When a category of context (Watch Score, bracket, standings,
  pre-match delta) does not exist for this match, simply write around
  its absence in silence. The reader must never see any reference to
  your inputs or their gaps.
- Report ONLY what happened in THIS match. Do not invent or infer any
  fact not present in the match data: no career history ("his first
  international goal," "her 50th cap"), no claims about a player's or
  team's past or record, no competitive stakes that don't exist (a
  friendly has nothing to "draw level" with, no standings to climb).
  If the match data does not state it, do not write it. When in doubt
  about whether a fact is in the data, leave it out.
- Output STRICT JSON only, matching exactly this schema, no markdown
  fences, no preamble:
  {
    "headline": "string (8-16 words, one sentence)",
    "paragraph_1": "string (100-150 words)",
    "paragraph_2": "string (100-150 words)",
    "paragraph_3": "string (50-100 words) or null"
  }

Example good headline: "Yamal's 23rd-minute strike enough for Spain as
Morocco's chances drift wide of a draw."
Example bad headline: "Spain limps past Morocco in a match they should
have lost."`;

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ============================================================================
// Team nickname allowlist — keyed by lowercased team name. The hallucination
// gate adds tokens from the two competing teams' nicknames to the allowed
// set so idiomatic references like "Les Bleus" don't false-positive.
// ============================================================================
const NICKNAME_MAP = {
  argentina:        ['La Albiceleste', 'Albiceleste'],
  australia:        ['Socceroos'],
  belgium:          ['Red Devils'],
  brazil:           ['Seleção', 'A Seleção', 'Canarinho'],
  cameroon:         ['Indomitable Lions'],
  colombia:         ['Los Cafeteros', 'Cafeteros'],
  croatia:          ['Vatreni'],
  denmark:          ['Danish Dynamite'],
  ecuador:          ['La Tri', 'La Tricolor'],
  egypt:            ['Pharaohs'],
  england:          ['Three Lions'],
  france:           ['Les Bleus', 'Bleus'],
  germany:          ['Die Mannschaft', 'Mannschaft', 'Nationalelf'],
  ghana:            ['Black Stars'],
  iceland:          ['Strákarnir okkar'],
  iran:             ['Team Melli'],
  italy:            ['Azzurri', 'Gli Azzurri'],
  'ivory coast':    ['Les Éléphants', 'Elephants'],
  "côte d'ivoire":  ['Les Éléphants', 'Elephants'],
  japan:            ['Samurai Blue'],
  mexico:           ['El Tri', 'Tri'],
  morocco:          ['Atlas Lions'],
  netherlands:      ['Oranje'],
  nigeria:          ['Super Eagles'],
  poland:           ['Biało-czerwoni'],
  portugal:         ['Seleção das Quinas'],
  russia:           ['Sbornaya'],
  scotland:         ['Tartan Army'],
  senegal:          ['Lions of Teranga', 'Teranga Lions'],
  'south korea':    ['Taeguk Warriors'],
  spain:            ['La Roja', 'Roja'],
  sweden:           ['Blågult'],
  switzerland:      ['Nati'],
  tunisia:          ['Eagles of Carthage'],
  uruguay:          ['La Celeste', 'Celeste'],
  usa:              ['USMNT', 'Stars and Stripes'],
  'united states':  ['USMNT', 'Stars and Stripes'],
  wales:            ['The Dragons'],
};

// ============================================================================
// Data envelope assembly — omit fields we don't have rather than faking.
// ============================================================================

const STAT_TYPE_MAP = {
  'Ball Possession':    'possession_pct',
  'Total Shots':        'shots',
  'Shots on Goal':      'shots_on_target',
  'expected_goals':     'xg',
  'goals_prevented':    'goals_prevented',
  'Corner Kicks':       'corners',
  'Yellow Cards':       'yellow_cards',
  'Red Cards':          'red_cards',
};

function parseStatValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    if (raw.endsWith('%')) return Number(raw.slice(0, -1));
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function extractStatistics(statsArray, homeTeamName) {
  if (!statsArray?.length) return null;
  const out = {};
  for (const side of statsArray) {
    const teamName = side.team?.name;
    const key = teamName === homeTeamName ? 'home' : 'away';
    const obj = { team: teamName };
    for (const stat of side.statistics ?? []) {
      const mapped = STAT_TYPE_MAP[stat.type];
      if (!mapped) continue;
      const v = parseStatValue(stat.value);
      if (v === null) continue;
      obj[mapped] = v;
    }
    out[key] = obj;
  }
  return out;
}

function normalizePerson(p) {
  if (!p) return null;
  const out = {};
  if (p.player?.number != null) out.number = p.player.number;
  if (p.player?.name) out.name = p.player.name;
  if (p.player?.pos) out.position = p.player.pos;
  return Object.keys(out).length ? out : null;
}

export function assembleBriefPrompt(matchData) {
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

function normalizeFromApiSports(fixture, events, lineups, statistics) {
  const homeName = fixture.teams?.home?.name;
  const data = {
    match: {
      league: fixture.league?.name ?? null,
      round: fixture.league?.round ?? null,
      kickoff_at: fixture.fixture?.date ?? null,
      venue: fixture.fixture?.venue?.name ?? null,
      status: fixture.fixture?.status?.short ?? null,
      score: {
        home: fixture.goals?.home ?? null,
        away: fixture.goals?.away ?? null,
      },
      teams: {
        home: homeName,
        away: fixture.teams?.away?.name,
      },
    },
    events: (events ?? []).map((e) => ({
      minute: e.time?.elapsed ?? null,
      extra: e.time?.extra ?? null,
      type: e.type ?? null,
      detail: e.detail ?? null,
      team: e.team?.name ?? null,
      player: e.player?.name ?? null,
      assist: e.assist?.name ?? null,
    })),
    lineups: (lineups ?? []).map((side) => ({
      team: side.team?.name ?? null,
      formation: side.formation ?? null,
      coach: side.coach?.name ?? null,
      startXI: (side.startXI ?? []).map(normalizePerson).filter(Boolean),
      substitutes: (side.substitutes ?? []).map(normalizePerson).filter(Boolean),
    })),
    statistics: extractStatistics(statistics, homeName),
  };
  return assembleBriefPrompt(data);
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
    ? `${retryInstruction}\n\nMatch data:\n`
    : 'Match data:\n';
  const userContent = `${prefix}${JSON.stringify(envelope, null, 2)}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });
  return response;
}

// ============================================================================
// p3 coercion — honor the "do not pad" rule.
// ============================================================================
function coerceShortP3(parsed) {
  if (typeof parsed?.paragraph_3 !== 'string') return;
  if (countWords(parsed.paragraph_3) < 50) {
    parsed.paragraph_3 = null;
  }
}

// ============================================================================
// Validation gates
// ============================================================================

function countWords(s) {
  if (!s || typeof s !== 'string') return 0;
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// Gate 1
function gateJsonStructure(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { pass: false, reason: 'response did not parse as JSON object' };
  }
  if (typeof parsed.headline !== 'string')    return { pass: false, reason: 'headline missing or not string' };
  if (typeof parsed.paragraph_1 !== 'string') return { pass: false, reason: 'paragraph_1 missing or not string' };
  if (typeof parsed.paragraph_2 !== 'string') return { pass: false, reason: 'paragraph_2 missing or not string' };
  if (!('paragraph_3' in parsed))             return { pass: false, reason: 'paragraph_3 key absent (must be string or null)' };
  if (parsed.paragraph_3 !== null && typeof parsed.paragraph_3 !== 'string') {
    return { pass: false, reason: 'paragraph_3 must be string or null' };
  }
  return { pass: true };
}

// Gate 2 — p3 under 50 is COERCED to null before this runs, so the only p3
// failure that survives here is "over 100 words" (still a real violation).
//
// p1 and p2 floors both relax for "honestly thin" matches, but on
// DIFFERENT signals by design — paragraph_1 ("what happened") tracks
// EVENT DENSITY, paragraph_2 ("what it means") tracks STAKES. They are
// two distinct ways a brief can have less to say:
//
//   p1 floor — relaxes 100→70 when the match has thin event material
//              (lowStakes OR <=2 goals). Catches both thin friendlies
//              AND low-event-but-high-stakes WC matches (a 0-0 / 1-0
//              group game has stakes but two paragraphs of event prose
//              isn't there honestly — Georgia–Romania 1-1 friendly fell
//              into this floor at 96 words despite producing a clean,
//              factual paragraph; we'd rather ship that than a template).
//
//   p2 floor — relaxes 100→60 when lowStakes only (rich-context matches
//              with bracket / standings / win_probability / watch_score
//              keep the 100 floor because "what it means" has more
//              substance there).
//
// AUTO-PUBLISH NOTE: this gate sits on a path that publishes
// unattended. The 70 floor + the system prompt's explicit "do not pad"
// + the hallucination + banned-constructions gates are what hold the
// quality line — relaxing word counts without touching those would be
// the actual risk. We're only correcting an asymmetry that made honest
// thin recaps land as bland template strings.
// Exported (alongside the internal runAllGates flow) so DEV regression
// tests can verify floor calibration with synthetic envelopes without
// needing to mock the Anthropic SDK. Production callers go through
// runAllGates → generateBrief, not this directly.
export function gateWordCounts(parsed, envelope) {
  const richContext = !!(
    envelope?.match?.bracket ??
    envelope?.match?.standings ??
    envelope?.match?.win_probability ??
    envelope?.match?.watch_score
  );
  const lowStakes = !richContext;

  // Count is_current goals in the envelope. Same definition as
  // lib/liveWatchScore: event_type='Goal' AND detail !== 'Missed Penalty'.
  // (The envelope's events array was already pruned to is_current=true
  // by assembleEnvelopeFromDb / normalizeFromApiSports.)
  const goalCount = (envelope?.events ?? [])
    .filter((e) => e?.type === 'Goal' && e?.detail !== 'Missed Penalty')
    .length;

  const p1Floor = (lowStakes || goalCount <= 2) ? 70 : 100;
  const p2Floor = lowStakes ? 60 : 100;

  const issues = [];
  const h = countWords(parsed.headline);
  if (h < 8 || h > 16) issues.push(`headline ${h} words (need 8-16)`);
  const p1 = countWords(parsed.paragraph_1);
  if (p1 < p1Floor || p1 > 150) issues.push(`paragraph_1 ${p1} words (need ${p1Floor}-150)`);
  const p2 = countWords(parsed.paragraph_2);
  if (p2 < p2Floor || p2 > 150) issues.push(`paragraph_2 ${p2} words (need ${p2Floor}-150)`);
  if (parsed.paragraph_3 !== null) {
    const p3 = countWords(parsed.paragraph_3);
    if (p3 > 100) issues.push(`paragraph_3 ${p3} words (>100)`);
    // p3 < 50 is impossible at this point — coerceShortP3 already nulled it.
  }
  return { pass: issues.length === 0, reason: issues.join('; ') };
}

// Gate 3 — hallucination check
//
// fold(s) — diacritic-normalize + lowercase. The source feed often stores
// accent-stripped names ("Mbappe") while the model correctly writes the
// canonical form ("Mbappé"). Both sides go through fold() before
// comparison so the strict per-spec rule ("every name must be in source")
// isn't tripped by spelling variants of the same name.
function fold(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function tokenizeName(name, into) {
  if (!name) return;
  for (const tok of String(name).split(/[\s\-/]+/)) {
    const clean = tok.replace(/[^a-zA-ZÀ-ſ'']/g, '');
    if (clean.length >= 2) into.add(fold(clean));
  }
}

function collectSourceTokens(envelope) {
  const tokens = new Set();

  // Match meta
  tokenizeName(envelope.match?.teams?.home, tokens);
  tokenizeName(envelope.match?.teams?.away, tokens);
  tokenizeName(envelope.match?.venue, tokens);
  tokenizeName(envelope.match?.league, tokens);
  tokenizeName(envelope.match?.round, tokens);

  // Team nicknames for the two competing teams
  for (const team of [envelope.match?.teams?.home, envelope.match?.teams?.away]) {
    if (!team) continue;
    const nicks = NICKNAME_MAP[team.toLowerCase()] ?? [];
    for (const nick of nicks) tokenizeName(nick, tokens);
  }

  // Lineups
  for (const side of envelope.lineups ?? []) {
    tokenizeName(side.team, tokens);
    tokenizeName(side.coach, tokens);
    for (const p of [...(side.startXI ?? []), ...(side.substitutes ?? [])]) {
      tokenizeName(p.name, tokens);
    }
  }

  // Events
  for (const e of envelope.events ?? []) {
    tokenizeName(e.team, tokens);
    tokenizeName(e.player, tokens);
    tokenizeName(e.assist, tokens);
  }
  return tokens;
}

// Stoppage-aware. Returns TWO sets: base minutes (e.g. {17, 33, 66, 90})
// and stoppage-notation tokens (e.g. {"90+3", "45+2"}). Prose references
// to "{N}+{M}rd minute" or "{N}+{M}'" validate against the stoppage set;
// references to plain "{N}rd minute" validate against the base set.
// Strict: a stoppage reference must EXACTLY match an event with that
// extra (not fall back to the base minute), so "90+5" still fails when
// the only stoppage event is "90+3".
function collectSourceMinutes(envelope) {
  const baseSet     = new Set();
  const stoppageSet = new Set();
  for (const e of envelope.events ?? []) {
    if (typeof e.minute === 'number') {
      baseSet.add(e.minute);
      if (typeof e.extra === 'number' && e.extra > 0) {
        stoppageSet.add(`${e.minute}+${e.extra}`);
      }
    }
  }
  return { baseSet, stoppageSet };
}

const SENTENCE_START_OK = new Set([
  'a','an','the','this','that','these','those','his','her','their','its','our','your','my',
  'after','before','during','despite','although','though','while','when','where','what',
  'home','away','first','second','third','final','both','either','neither','one','two','three',
  'goalkeeper','defender','midfielder','forward','striker','manager','coach',
  // Common prepositions / conjunctions that can begin a capitalized phrase
  // ("For France...", "In the second half...") — they shouldn't be treated
  // as part of a player-name candidate by the hallucination gate.
  'for','as','in','on','at','with','by','against','over','under','into','through',
  'within','from','and','but','or','yet','still','also','meanwhile','however',
]);

const COMMON_PROSE_CAPS = new Set([
  'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
  'january','february','march','april','may','june','july','august','september','october','november','december',
  'sportsvyn','watch','score','tier','brief',
  'normal','goal','goals','card','cards','yellow','red','corner','corners','shot','shots',
  'half','time','minute','match','tournament','friendly','round','group','stage','league','cup','final',
  'world','exhibition','possession','expected','xg',
  'champions','europa','euro','copa',
]);

function findReferencedNames(text) {
  const out = new Set();
  // `\b` is ASCII-only in JS regex (without the `u` flag) and chops accented
  // surnames mid-word — "Ibrahima Konaté" would capture as "Ibrahima Konat"
  // because there's no word boundary AFTER "é". Use Unicode-aware
  // lookbehind / lookahead instead so the full accented name comes through.
  const wordChar = `[A-Za-zÀ-ſ'\\-]`;
  const fullName = new RegExp(
    `(?<!${wordChar})([A-Z][a-zA-ZÀ-ſ'\\-]{1,}(?:\\s+[A-Z][a-zA-ZÀ-ſ'\\-]{1,})+)(?!${wordChar})`,
    'g'
  );
  const poss = new RegExp(
    `(?<!${wordChar})([A-Z][a-zA-ZÀ-ſ'\\-]{2,})'s(?!${wordChar})`,
    'g'
  );
  let m;
  while ((m = fullName.exec(text)) !== null) out.add(m[1]);
  while ((m = poss.exec(text)) !== null) out.add(m[1]);
  return [...out];
}

// Two-layer extraction. The base patterns (the four originals) are
// "stoppage-blind" — without intervention they extract "3rd minute" out
// of "90+3rd minute", causing a false-positive hallucination flag on
// every correctly-stated stoppage reference. The fix is a pre-pass that
// captures any "{N}+{M}" stoppage notation FIRST and MASKS those
// substrings before the base patterns run, so they can't leak.
//
// Returns:
//   baseMinutes  — integers extracted from plain "{N}rd minute" / "{N}'"
//                  / "minute {N}" / "in the {N}th" prose
//   stoppageRefs — "{N}+{M}" strings extracted from "{N}+{M}rd minute"
//                  / "{N}+{M}'" / "{N}+{M}" prose
const STOPPAGE_PAT = /\b(\d{1,3})\+(\d{1,2})(?:st|nd|rd|th)?(?:'|\s*minute)?\b/gi;

function findReferencedMinutes(text) {
  const baseMinutes  = new Set();
  const stoppageRefs = new Set();

  // 1. Stoppage pre-pass — capture "{N}+{M}" tokens.
  STOPPAGE_PAT.lastIndex = 0;
  let sm;
  while ((sm = STOPPAGE_PAT.exec(text)) !== null) {
    stoppageRefs.add(`${Number(sm[1])}+${Number(sm[2])}`);
  }

  // 2. Mask the stoppage substrings with whitespace so the base patterns
  //    can't re-extract their numeric components. Equal-length replacement
  //    preserves the rest of the regex offsets.
  const cleaned = text.replace(STOPPAGE_PAT, (s) => ' '.repeat(s.length));

  // 3. Base patterns run against the masked text. Identical to before;
  //    only the input has changed.
  const basePatterns = [
    /\b(\d{1,3})(?:st|nd|rd|th)[- ]?minute\b/gi,
    /\b(\d{1,3})'(?=\D|$)/g,
    /\bminute (\d{1,3})\b/gi,
    /\bin the (\d{1,3})(?:st|nd|rd|th)\b/gi,
  ];
  for (const re of basePatterns) {
    let m;
    while ((m = re.exec(cleaned)) !== null) baseMinutes.add(Number(m[1]));
  }

  return { baseMinutes: [...baseMinutes], stoppageRefs: [...stoppageRefs] };
}

// Exported (alongside the internal runAllGates flow) so DEV regression
// tests can verify hallucination behavior with synthetic envelopes
// without needing to mock the Anthropic SDK. Same shape as gateWordCounts.
export function gateHallucination(parsed, envelope) {
  const sourceTokens = collectSourceTokens(envelope);
  const { baseSet, stoppageSet } = collectSourceMinutes(envelope);

  const text = [parsed.headline, parsed.paragraph_1, parsed.paragraph_2, parsed.paragraph_3 ?? '']
    .filter((s) => typeof s === 'string')
    .join(' ');

  const issues = [];

  const { baseMinutes, stoppageRefs } = findReferencedMinutes(text);
  for (const min of baseMinutes) {
    if (!baseSet.has(min)) issues.push(`minute ${min}' not in source events`);
  }
  for (const ref of stoppageRefs) {
    if (!stoppageSet.has(ref)) issues.push(`stoppage minute ${ref}' not in source events`);
  }

  for (const name of findReferencedNames(text)) {
    const toks = name.split(/\s+/).map((t) => fold(t.replace(/[^a-zA-ZÀ-ſ'']/g, '')));
    const checkToks = toks.filter((t) => t.length >= 3);
    const missing = checkToks.filter((t) => {
      // Strip a trailing possessive. The optional `s` catches both
      // "Mbappe's" → "mbappe" and "Deschamps'" (no following s) →
      // "deschamps". Apostrophe variants — straight or curly.
      const stripped = t.replace(/['']s?$/, '');
      return (
        !sourceTokens.has(stripped) &&
        !SENTENCE_START_OK.has(stripped) &&
        !COMMON_PROSE_CAPS.has(stripped)
      );
    });
    if (missing.length > 0) {
      issues.push(`"${name}" not in source (missing: ${missing.join(', ')})`);
    }
  }

  return { pass: issues.length === 0, reason: [...new Set(issues)].slice(0, 6).join(' | ') };
}

// Gate 4 — banned constructions
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
];

function gateBannedConstructions(parsed) {
  const text = [parsed.headline, parsed.paragraph_1, parsed.paragraph_2, parsed.paragraph_3 ?? '']
    .filter((s) => typeof s === 'string')
    .join(' ');
  const issues = [];
  for (const { re, label } of BANNED_PATTERNS) {
    if (re.test(text)) issues.push(label);
  }
  return { pass: issues.length === 0, reason: issues.join('; ') };
}

// Gate 5 — render-layer invariant
// NOTE: The "validation_status='passed' vs 'fallback'" badge differentiation
// is the RENDER LAYER's responsibility. The match-page render MUST surface
// the badge so readers can see which path produced the brief. This gate is
// not enforceable here; it's a contract reminder.

function runAllGates(parsed, envelope) {
  const results = [];
  const s = gateJsonStructure(parsed);
  results.push({ name: 'json_structure', ...s });
  if (!s.pass) return results;

  results.push({ name: 'word_counts', ...gateWordCounts(parsed, envelope) });
  results.push({ name: 'hallucination', ...gateHallucination(parsed, envelope) });
  results.push({ name: 'banned_constructions', ...gateBannedConstructions(parsed) });
  return results;
}

// ============================================================================
// Templated fallback — bland, deterministic, accurate.
// Goal scorers are grouped by team so the line reads
//   "France: K. Mbappé 32', H. Ekitike 65'. Brazil: Bremer 78'."
// rather than as an undifferentiated list.
// ============================================================================
function templatedFallback(envelope) {
  const m = envelope.match ?? {};
  const home = m.teams?.home ?? 'Home';
  const away = m.teams?.away ?? 'Away';
  const hs = m.score?.home ?? 0;
  const as = m.score?.away ?? 0;
  const venue = m.venue ?? null;
  const round = m.round ?? null;
  const league = m.league ?? 'Friendly';

  const goalsByTeam = new Map();
  for (const e of envelope.events ?? []) {
    if (!e.type || !/goal/i.test(e.type)) continue;
    if (/missed|cancelled/i.test(e.detail ?? '')) continue;
    const team = e.team ?? 'Unknown';
    if (!goalsByTeam.has(team)) goalsByTeam.set(team, []);
    goalsByTeam.get(team).push(`${e.player ?? 'Unknown'} ${e.minute ?? '?'}'`);
  }

  const scorerLine = [...goalsByTeam.entries()]
    .map(([team, list]) => `${team}: ${list.join(', ')}.`)
    .join(' ');

  const xgHome = envelope.statistics?.home?.xg;
  const xgAway = envelope.statistics?.away?.xg;
  const xgLine = xgHome != null && xgAway != null ? ` xG: ${xgHome} vs ${xgAway}.` : '';

  const headline = `${home} ${hs}-${as} ${away}${venue ? ` at ${venue}` : ''}.`;
  const paragraph_1 = `${home} ${hs}-${as} ${away}.${scorerLine ? ` ${scorerLine}` : ''}${xgLine}`;
  const paragraph_2 = `${league}${round ? ` · ${round}` : ''}${venue ? ` · ${venue}` : ''}.`;

  return { headline, paragraph_1, paragraph_2, paragraph_3: null };
}

// ============================================================================
// Orchestration — populates an `attempts` array with each call's parsed
// output (or error) + its gate results so the script can print the prose
// for every attempt before the gate trace.
// ============================================================================

export async function generateBrief(matchData) {
  const envelope = assembleBriefPrompt(matchData);
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
      if (parsed) coerceShortP3(parsed);
    } catch (err) {
      error = String(err?.message ?? err);
    }
    const gates = error
      ? [{ name: 'api_call', pass: false, reason: error }]
      : runAllGates(parsed, envelope);
    const entry = {
      attempt: attemptN,
      parsed_output: parsed ?? null,
      error,
      gates,
    };
    attempts.push(entry);
    return entry;
  }

  // Attempt 1
  const a1 = await doAttempt(1);
  if (a1.parsed_output && a1.gates.every((g) => g.pass)) {
    return finalize({ parsed: a1.parsed_output, attempts, lastRaw, validation_status: 'passed' });
  }

  // Attempt 2 — failure-type-aware retry instruction. The generic "list of
  // failures" wording made the model pad volume; a p2-under-floor case gets
  // a specific instruction to expand existing meaning rather than introduce
  // unrelated event-level filler.
  const retryInstruction = buildRetryInstruction(a1.gates);
  const a2 = await doAttempt(2, retryInstruction);
  if (a2.parsed_output && a2.gates.every((g) => g.pass)) {
    return finalize({ parsed: a2.parsed_output, attempts, lastRaw, validation_status: 'passed' });
  }

  // Fallback
  const fb = templatedFallback(envelope);
  return finalize({ parsed: fb, attempts, lastRaw, validation_status: 'fallback' });
}

function buildRetryInstruction(gates) {
  const failed = gates.filter((g) => !g.pass);
  if (!failed.length) return '';

  // Detect the specific "paragraph_2 under floor" case from the word_counts
  // gate's reason string. Format is "paragraph_2 N words (need MIN-150)".
  const wc = failed.find((g) => g.name === 'word_counts');
  const p2Under = wc?.reason?.match(/paragraph_2 (\d+) words \(need (\d+)-/);
  const p2UnderFloor = p2Under && Number(p2Under[1]) < Number(p2Under[2]);

  if (p2UnderFloor) {
    let instr = `Your paragraph_2 was too short. Expand the EXISTING analysis of what the result means — add depth to the points already made. Do NOT introduce new event-level details (cards, substitutions, individual bookings) unless they directly bear on what the result means. Padding with a list of incidents is not acceptable.`;
    const others = failed
      .filter((g) => g.name !== 'word_counts')
      .map((g) => `${g.name}: ${g.reason}`)
      .join(' | ');
    if (others) instr += ` Also address: ${others}.`;
    return instr;
  }

  const reasons = failed.map((g) => `${g.name}: ${g.reason}`).join(' | ');
  return `Your previous response failed validation: ${reasons}. Re-read the system constraints. Output STRICT JSON with the exact schema. Stay within the word counts (headline 8-16, paragraph_1 100-150, paragraph_2 100-150, paragraph_3 50-100 or null). Reference only players, minutes, and scores present in the match data below.`;
}

function finalize({ parsed, attempts, lastRaw, validation_status }) {
  return {
    headline: parsed.headline,
    paragraph_1: parsed.paragraph_1,
    paragraph_2: parsed.paragraph_2,
    paragraph_3: parsed.paragraph_3 ?? null,
    attempts,
    validation_status,
    model: MODEL,
    raw_response: lastRaw,
  };
}

export async function generateBriefForFixture(fixtureId) {
  const [fixtures, events, lineups, statistics] = await Promise.all([
    apiSports.fixture(fixtureId),
    apiSports.events(fixtureId).catch(() => []),
    apiSports.lineups(fixtureId).catch(() => []),
    apiSports.statistics(fixtureId).catch(() => []),
  ]);
  const f = fixtures[0];
  if (!f) throw new Error(`API-Sports returned no fixture for id ${fixtureId}`);
  const envelope = normalizeFromApiSports(f, events, lineups, statistics);
  const result = await generateBrief(envelope);
  return { ...result, envelope };
}

// ============================================================================
// DB-read path — the auto-brief sweep cron's entry point.
//
// Reads only is_current=true rows from match_events / match_lineups /
// match_statistics, so VAR-cancelled events (the Colombia phantom-Diaz case)
// are filtered at the source. Score/league/teams come from the matches row
// the live cron has already written. Zero new API-Sports calls.
//
// Output envelope shape is byte-compatible with normalizeFromApiSports's
// output, so the system prompt + all five validation gates work unchanged.
// ============================================================================

const STAGE_LABELS = {
  group:        null,            // synthesized with group_code below
  round_of_32:  'Round of 32',
  round_of_16:  'Round of 16',
  quarter:      'Quarterfinal',
  semi:         'Semifinal',
  third_place:  'Third-place playoff',
  final:        'Final',
};

function synthesizeRoundLabel(stage, groupCode) {
  if (!stage) return null;
  if (stage === 'group') return groupCode ? `Group ${groupCode}` : 'Group Stage';
  return STAGE_LABELS[stage] ?? null;
}

function normalizeDbLineupPlayer(p) {
  if (!p) return null;
  const out = {};
  if (p.number != null) out.number = p.number;
  if (p.name) out.name = p.name;
  if (p.pos) out.position = p.pos;
  return Object.keys(out).length ? out : null;
}

// match_statistics.stats is already keyed by API-Sports stat 'type'
// (lib/statistics.js writes it through verbatim), so we reuse STAT_TYPE_MAP
// and parseStatValue() — same code path as extractStatistics(). The only
// difference is the input shape: a flat object per side instead of the
// API-Sports {team, statistics:[{type,value}]} array.
function extractStatisticsFromDb(statRows, homeName, awayName) {
  if (!statRows?.length) return null;
  const out = {};
  for (const row of statRows) {
    const side = row.team_side;
    if (side !== 'home' && side !== 'away') continue;
    const obj = { team: side === 'home' ? homeName : awayName };
    const stats = row.stats ?? {};
    for (const [type, value] of Object.entries(stats)) {
      const mapped = STAT_TYPE_MAP[type];
      if (!mapped) continue;
      const v = parseStatValue(value);
      if (v === null) continue;
      obj[mapped] = v;
    }
    out[side] = obj;
  }
  return Object.keys(out).length ? out : null;
}

export async function assembleEnvelopeFromDb(matchDbId) {
  const matchRows = await sql`
    SELECT m.id,
           m.kickoff_at,
           m.venue,
           m.status,
           m.home_score,
           m.away_score,
           m.stage,
           m.group_code,
           l.name AS league_name,
           h.name AS home_name,
           a.name AS away_name
      FROM matches m
      LEFT JOIN leagues l ON l.id = m.league_id
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE m.id = ${matchDbId}
     LIMIT 1
  `;
  const m = matchRows[0];
  if (!m) throw new Error(`No match row for id ${matchDbId}`);

  // is_current=true is the spec-mandated filter. Phantom events (e.g. a goal
  // cancelled by VAR — flipped to is_current=false by syncMatchEvents)
  // cannot reach the model.
  const eventRows = await sql`
    SELECT minute, minute_extra, event_type, detail, team_side,
           player_name, assist_name
      FROM match_events
     WHERE match_id = ${matchDbId} AND is_current = true
     ORDER BY minute ASC, minute_extra ASC NULLS LAST, id ASC
  `;

  const lineupRows = await sql`
    SELECT team_side, formation, players
      FROM match_lineups
     WHERE match_id = ${matchDbId} AND is_current = true
  `;

  const statRows = await sql`
    SELECT team_side, stats
      FROM match_statistics
     WHERE match_id = ${matchDbId} AND is_current = true
  `;

  const kickoffIso = m.kickoff_at instanceof Date
    ? m.kickoff_at.toISOString()
    : (m.kickoff_at ?? null);

  const data = {
    match: {
      league:     m.league_name ?? null,
      round:      synthesizeRoundLabel(m.stage, m.group_code),
      kickoff_at: kickoffIso,
      venue:      m.venue ?? null,
      status:     m.status === 'final' ? 'FT' : m.status,
      score: {
        home: m.home_score,
        away: m.away_score,
      },
      teams: {
        home: m.home_name,
        away: m.away_name,
      },
    },
    events: eventRows.map((e) => ({
      minute: e.minute,
      extra:  e.minute_extra,
      type:   e.event_type,
      detail: e.detail,
      team:   e.team_side === 'home' ? m.home_name : m.away_name,
      player: e.player_name,
      assist: e.assist_name,
    })),
    lineups: lineupRows.map((side) => {
      const players = Array.isArray(side.players) ? side.players : [];
      const starting = players
        .filter((p) => p?.role === 'starting')
        .map(normalizeDbLineupPlayer)
        .filter(Boolean);
      const bench = players
        .filter((p) => p?.role === 'bench')
        .map(normalizeDbLineupPlayer)
        .filter(Boolean);
      return {
        team:        side.team_side === 'home' ? m.home_name : m.away_name,
        formation:   side.formation ?? null,
        coach:       null,                                  // not stored in match_lineups
        startXI:     starting,
        substitutes: bench,
      };
    }),
    statistics: extractStatisticsFromDb(statRows, m.home_name, m.away_name),
  };

  return assembleBriefPrompt(data);
}

export async function generateBriefFromDb(matchDbId) {
  const envelope = await assembleEnvelopeFromDb(matchDbId);
  const result = await generateBrief(envelope);
  return { ...result, envelope };
}
