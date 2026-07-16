// lib/fantasy/readWriter.js — THE READ generator. House AI pattern
// (cf. lib/aiRankingBlurb.js): server-built envelope -> one Anthropic call in the
// voice-bible register -> server-side validators -> deterministic fallback on
// failure. Persisted once to draft_reads (migration 048); read thereafter, never
// regenerated on view.
//
// GENERATION TIMING (v1): SYNCHRONOUS on first results view. getOrCreateRead is
// called by the results server component: the grade + ledger are computed
// instantly (pure grade.js) and the AI prose is generated + persisted in the same
// request (a few seconds on the first view only; every later view reads the row).
// A later session can move prose to a Suspense boundary if the wait matters.

import Anthropic from '@anthropic-ai/sdk';
import { sql } from '../db.js';
import { getResults } from './drafts.js';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 500;
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

export const SYSTEM_PROMPT = `You are a Sportsvyn editorial voice writing THE READ: one short verdict on a finished fantasy mock draft. The grade and the numbers are already computed and shown next to your prose. Your job is to explain WHY the draft earned that grade, using the specific picks in the envelope, in the measured Sportsvyn register.

VOICE:
- Open on an observation, not a greeting or a score restatement. You are describing what happened, not congratulating anyone.
- Explain the grade with the envelope's specific callouts: the best value, the biggest reach, the pivot pick, any bye stack. Name the actual players and rounds.
- Measured and specific. No hype, no hedging filler, no cheerleading.

GROUNDING: The grade derives ONLY from the rows and components provided in this envelope; do not attribute the grade to anything else.

BANNED (hard):
- No praise interjections: "nice job", "great pick", "well done", "nailed it", "crushed it". No exclamation marks at all.
- No draft advice or second-guessing framed as instruction: "you should have", "next time take", "would have been better to", "instead you could have". You describe what the draft IS, not what it should have been.
- No hedging: "maybe", "perhaps", "arguably", "it could be argued".
- No predictions about the real season ("will win", "should finish").
- No gambling language.

PUNCTUATION: Hyphens only. NEVER an em dash or en dash used as one. Use commas, colons, semicolons, periods.

LITERAL NAMES (non-negotiable): use player names EXACTLY as they appear in the envelope. Never expand an abbreviated first name, never substitute a nickname or a fuller form from outside knowledge. Only name players that appear in the envelope.

LENGTH: 90 to 140 words. One tight paragraph.

OUTPUT SCHEMA (strict JSON, nothing else): { "prose": "string, 90-140 words" }`;

const READ_SCHEMA = { type: 'object', properties: { prose: { type: 'string' } }, required: ['prose'], additionalProperties: false };

const dv = (pk) => Math.round(pk.overallPick - pk.adpAtPick); // display value (positive-good)

// ---- envelope (server-built; the only source of names) ----
// K and DST feed neither value nor construction, so the writer must not narrate
// them: their rows (and synthetic fillers) are kept OUT of the ledger and the
// callouts entirely. The roster shape carries only a neutral "filled on schedule"
// fact, no names. With no K/DST names anywhere in the envelope, the grounding
// validator now catches any DST/Defense/Kicker mention as a hallucinated name.
const isNarratable = (pk) => pk && pk.slotPos !== 'K' && pk.slotPos !== 'DST' && !pk.synthetic;

function buildEnvelope(results) {
  const { config, grade, gradeScore, components, userPicks, bestValue, biggestReach, pivot, byeStackWarnings, positionalBalance } = results;
  const nm = (pk) => (pk == null ? null : pk.playerName);
  const hasK = userPicks.some((p) => p.slotPos === 'K');
  const hasDst = userPicks.some((p) => p.slotPos === 'DST');
  return {
    preset: { name: config.name, teams: config.teams_count, scoring: config.scoring_format },
    grade, gradeScore,
    components: { value: components.valueScore, construction: components.constructionScore, lateStarters: components.lateStarters, byeStacks: components.byeStackCount },
    rosterShape: positionalBalance,
    kickerAndDefense: hasK && hasDst ? 'filled on schedule (excluded from the grade and this envelope)' : 'incomplete',
    callouts: {
      bestValue: isNarratable(bestValue) ? { name: nm(bestValue), pos: bestValue.slotPos, round: bestValue.round, valuePicks: dv(bestValue) } : null,
      biggestReach: isNarratable(biggestReach) ? { name: nm(biggestReach), pos: biggestReach.slotPos, round: biggestReach.round, valuePicks: dv(biggestReach) } : null,
      pivot: isNarratable(pivot) ? { name: nm(pivot), pos: pivot.slotPos, round: pivot.round } : null,
    },
    byeStacks: byeStackWarnings.map((w) => ({ week: w.bye, starters: w.players })),
    ledger: userPicks.slice().sort((a, b) => a.overallPick - b.overallPick)
      .filter(isNarratable) // skill picks only — no K/DST, no synthetic fillers
      .map((pk) => ({ round: pk.round, overall: pk.overallPick, name: nm(pk), pos: pk.slotPos, adp: Math.round(pk.adpAtPick), value: dv(pk) })),
  };
}

async function generate(envelope) {
  if (!client) return { ok: false, error: 'no_api_key' };
  const user = `Draft envelope:\n\n${JSON.stringify(envelope, null, 2)}\n\nWrite THE READ per the system instructions. 90-140 words, explain the ${envelope.grade} grade with the specific callouts, only name players in the envelope. Output STRICT JSON only.`;
  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: user }], output_format: { type: 'json_schema', schema: READ_SCHEMA },
    });
  } catch (err) { return { ok: false, error: String(err?.message ?? err) }; }
  const text = response?.content?.[0]?.text ?? '';
  try { return { ok: true, prose: JSON.parse(text.trim()).prose, usage: response.usage }; }
  catch { return { ok: false, error: 'json_parse_failure', raw: text }; }
}

// ---- validators (run before persist) ----
const BANNED = [
  /\bnice job\b/i, /\bgreat pick\b/i, /\bwell done\b/i, /\bnailed it\b/i, /\bcrushed it\b/i,
  /\byou should have\b/i, /\bshould['’]?ve\b/i, /\bnext time\b/i, /\bwould have been better\b/i,
  /\binstead you\b/i, /\bmaybe\b/i, /\bperhaps\b/i, /\barguably\b/i,
  /\bwill (win|finish|make|reach)\b/i, /\bsmart money\b/i, /\block of\b/i, /!/,
];
function nameTokenSet(envelope) {
  const s = new Set();
  const add = (n) => { if (!n) return; for (const t of n.split(/\s+/)) { const tok = t.replace(/['’.]+$/u, ''); if (tok.length >= 3) s.add(tok); } };
  for (const row of envelope.ledger) add(row.name);
  for (const w of envelope.byeStacks) for (const p of w.starters) add(p);
  return s;
}
// Allowlist of capitalized non-name tokens: sentence openers, numbers, ordinals,
// and sim/football/preset vocabulary. A capitalized token that is neither in here
// nor a grounded roster token is treated as a (hallucinated) player name.
const STOP = new Set([
  'The', 'This', 'That', 'These', 'Those', 'Their', 'There', 'They', 'Your', 'You', 'His', 'Her',
  'With', 'When', 'While', 'After', 'Before', 'Both', 'Each', 'Every', 'Some', 'Most', 'Only', 'Then',
  'Than', 'Here', 'What', 'Which', 'Who', 'How', 'Now', 'Not', 'But', 'And', 'For', 'Its', 'Watch', 'Overall',
  'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth',
  'Round', 'Rounds', 'Pick', 'Picks', 'Value', 'Reach', 'Pivot', 'Bench', 'Starter', 'Starters',
  'Week', 'Bye', 'Draft', 'Season', 'Roster', 'ADP', 'Best', 'Biggest', 'Read', 'Sportsvyn',
  'Standard', 'PPR', 'Half', 'Non', 'Team', 'Teams', 'Casual', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'DST', 'Replacement',
]);

export function validateRead(prose, envelope) {
  const issues = [];
  const wc = (prose || '').trim().split(/\s+/).filter(Boolean).length;
  if (wc < 90 || wc > 140) issues.push(`length ${wc} (need 90-140)`);
  if (/[—–]/.test(prose)) issues.push('em/en dash');
  for (const re of BANNED) if (re.test(prose)) issues.push(`banned: ${re}`);
  // grounding: player names are MULTI-WORD TitleCase ("First Last"). Scan only
  // those sequences (single capitalized words are dominated by sentence openers /
  // adverbs and are not name-shaped). A sequence is ungrounded if it carries a
  // token that is neither allowlisted (STOP) nor a grounded roster name token.
  const names = nameTokenSet(envelope);
  const clean = (t) => t.replace(/['’.]+$/u, '').replace(/['’]s$/u, '');
  for (const m of (prose || '').matchAll(/\b\p{Lu}[\p{Ll}'’.]+(?:\s+\p{Lu}[\p{Ll}'’.]+){1,2}\b/gu)) {
    const toks = m[0].split(/\s+/).map(clean).filter((t) => t.length >= 3);
    const ungrounded = toks.filter((t) => !STOP.has(t) && !names.has(t));
    if (ungrounded.length) issues.push(`ungrounded name: "${m[0]}" (${ungrounded.join(', ')})`);
  }
  return { ok: issues.length === 0, issues, wordCount: wc };
}

// ---- deterministic fallback (assembled from callouts) ----
function fallbackProse(envelope) {
  const { grade, gradeScore, callouts, components, byeStacks, preset } = envelope;
  const parts = [`This ${preset.name} draft grades ${grade} (${gradeScore}).`];
  if (callouts.bestValue) parts.push(`The value came at ${callouts.bestValue.name} in round ${callouts.bestValue.round}, ${callouts.bestValue.valuePicks} picks past his ADP.`);
  if (callouts.biggestReach) parts.push(`The biggest reach was ${callouts.biggestReach.name} in round ${callouts.biggestReach.round}.`);
  if (callouts.pivot) parts.push(`${callouts.pivot.name} was the pivot, the pick that answered the roster's most pressing need.`);
  const cx = components.value >= components.construction
    ? `The grade leans on value over the market (${components.value}) more than roster build (${components.construction}).`
    : `Roster construction (${components.construction}) carried this one more than market value (${components.value}).`;
  parts.push(cx);
  if (byeStacks.length) parts.push(`Watch week ${byeStacks[0].week}: ${byeStacks[0].starters.length} starters share a bye.`);
  return parts.join(' ');
}

// ---- orchestrator: generate once, persist, read thereafter ----
export async function getOrCreateRead(draftId, userId) {
  const results = await getResults(draftId, userId);
  if (!results) return null;
  if (results.draft.status !== 'completed') return { results, notComplete: true };

  const existing = (await sql`SELECT grade, grade_score, components, prose, prose_source, model FROM draft_reads WHERE draft_id = ${draftId} LIMIT 1`)[0];
  if (existing) {
    return { results, prose: existing.prose, proseSource: existing.prose_source, model: existing.model };
  }

  const envelope = buildEnvelope(results);
  const gen = await generate(envelope);
  let prose; let source; let model = null; let validation = null;
  if (gen.ok) {
    validation = validateRead(gen.prose, envelope);
    if (validation.ok) { prose = gen.prose; source = 'ai'; model = MODEL; }
  }
  if (!prose) { prose = fallbackProse(envelope); source = 'fallback'; }

  await sql`
    INSERT INTO draft_reads (draft_id, grade, grade_score, components, prose, prose_source, model)
    VALUES (${draftId}, ${results.grade}, ${results.gradeScore}, ${JSON.stringify(results.components)}::jsonb, ${prose}, ${source}, ${model})
    ON CONFLICT (draft_id) DO NOTHING`;
  const row = (await sql`SELECT prose, prose_source, model FROM draft_reads WHERE draft_id = ${draftId} LIMIT 1`)[0];
  return { results, prose: row.prose, proseSource: row.prose_source, model: row.model, validation };
}
