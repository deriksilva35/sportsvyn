// lib/wire/take.js — the take, and the rules that make it safe to print.
//
// A TAKE SITS UNDER A HEADLINE SOMEBODY ELSE WROTE, in a product whose whole
// claim is that its numbers are checkable. So the writer is given ONLY the
// headline and an envelope of our own numbers, and the output is rejected -
// not repaired - if it says anything the envelope does not support.
//
// THE NUMERIC-SUBSET CHECK IS THE LOAD-BEARING GUARD. A model asked for "one
// specific figure" will happily produce a plausible one. Every numeral in the
// take must appear in the envelope; if it does not, the take is thrown away and
// the item keeps its headline. That is cheap to enforce and impossible to argue
// with, which is the only kind of guard worth having against invention.
//
// AN EMPTY ENVELOPE MEANS NO TAKE, NOT A FILLER TAKE. If we hold nothing about
// the teams in a headline we have nothing to say next to it, and saying
// something anyway is exactly the failure this file exists to prevent.

import Anthropic from '@anthropic-ai/sdk';
import { sql } from '../db.js';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 300;
const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

export const TAKE_PROMPT_SLUG = 'wire_take';
export const MAX_CHARS = 240;
export const MAX_SENTENCES = 2;

// ---------------------------------------------------------------- envelope

/**
 * OUR NUMBERS ABOUT THE TEAMS IN THIS HEADLINE, and nothing else.
 *
 * Every field is optional and the envelope is allowed to come back empty -
 * which is a real answer, not a failure. It is built from tables the product
 * already reads, so a take can never cite a figure no surface could show.
 */
export async function buildEnvelope(item, { season }) {
  const teamIds = (item.team_ids ?? []).filter(Boolean);
  if (!teamIds.length) return null;

  const [teams, records, ranks, nextGames, lastFinals] = await Promise.all([
    sql`SELECT id, abbreviation, name FROM teams WHERE id = ANY(${teamIds})`,
    sql`SELECT team_id, wins, losses, ties, streak, points_for, points_against
          FROM team_records
         WHERE team_id = ANY(${teamIds}) AND season = ${season} AND season_type = 'regular'`,
    sql`SELECT ap.team_id, ap.rank, ap.week
          FROM ap_rankings ap
         WHERE ap.team_id = ANY(${teamIds}) AND ap.season = ${season}
         ORDER BY ap.week DESC`,
    sql`SELECT m.id, m.slug, m.kickoff_at, m.home_team_id, m.away_team_id,
               h.abbreviation AS home_abbr, a.abbreviation AS away_abbr,
               o.selection_label, o.selection_value, o.movement_24h_prob, o.market_type
          FROM matches m
          LEFT JOIN teams h ON h.id = m.home_team_id
          LEFT JOIN teams a ON a.id = m.away_team_id
          LEFT JOIN odds_markets o ON o.match_id = m.id AND o.is_current
               AND o.market_scope = 'match' AND o.market_type = 'spread'
         WHERE m.status = 'scheduled' AND m.season_year = ${season}
           AND (m.home_team_id = ANY(${teamIds}) OR m.away_team_id = ANY(${teamIds}))
         ORDER BY m.kickoff_at ASC LIMIT 4`,
    sql`SELECT m.id, m.home_score, m.away_score, m.home_team_id, m.away_team_id,
               h.abbreviation AS home_abbr, a.abbreviation AS away_abbr, m.kickoff_at
          FROM matches m
          LEFT JOIN teams h ON h.id = m.home_team_id
          LEFT JOIN teams a ON a.id = m.away_team_id
         -- SCOPED TO THIS SEASON, and the sentinel is why. Unscoped, the
         -- envelope handed a writer Northwestern's 34-7 win from a PRIOR
         -- season and it came back as "opened its home slate with a 34-7 win"
         -- - a true score, attached to the wrong year. Every guard passed,
         -- because the numeral was real. A take can only be checkable if the
         -- envelope cannot offer last season as this one.
         WHERE m.status = 'final' AND m.season_year = ${season}
           AND (m.home_team_id = ANY(${teamIds}) OR m.away_team_id = ANY(${teamIds}))
         ORDER BY m.kickoff_at DESC LIMIT 2`,
  ]);

  const env = {
    teams: teams.map((t) => ({ abbr: t.abbreviation, name: t.name })),
    records: records.map((r) => ({
      team: teams.find((t) => t.id === r.team_id)?.abbreviation ?? null,
      record: r.ties ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`,
      streak: r.streak ?? null, pointsFor: r.points_for ?? null, pointsAgainst: r.points_against ?? null,
    })),
    apRanks: ranks.map((r) => ({
      team: teams.find((t) => t.id === r.team_id)?.abbreviation ?? null, rank: r.rank, week: r.week,
    })),
    // EVERY NUMBER SAYS WHAT IT IS AND WHOSE IT IS.
    //
    // The first sentinel run proved why. The envelope handed over
    // `score: "27-24"` and `line: "Over 3"` as bare strings, and the writer
    // produced "New Orleans went 27-24 at Dallas" and "a line that moved 0.14
    // POINTS in the last 24 hours" - the second being a probability move
    // described as spread points. The numeric-subset check passed both,
    // because the numerals were real; only the MEANING was invented. A guard
    // on numerals cannot catch a misdescribed unit, so the envelope has to
    // remove the ambiguity instead of relying on one.
    nextGame: nextGames.filter((g) => g.selection_value).slice(0, 2).map((g) => ({
      awayTeam: g.away_abbr,
      homeTeam: g.home_abbr,
      spreadOn: g.selection_label ?? null,
      spreadValue: g.selection_value == null ? null : String(g.selection_value),
      spreadMoveLast24hInProbabilityPoints:
        g.movement_24h_prob == null ? null : Number(g.movement_24h_prob),
    })),
    lastFinal: lastFinals.map((g) => ({
      awayTeam: g.away_abbr,
      awayScore: g.away_score,
      homeTeam: g.home_abbr,
      homeScore: g.home_score,
    })),
  };

  // EMPTY IS EMPTY. Team names alone are not numbers, and a take built on them
  // would be a sentence with nothing behind it.
  const hasNumbers = env.records.length || env.apRanks.length
    || env.nextGame.length || env.lastFinal.length;
  return hasNumbers ? env : null;
}

// -------------------------------------------------------------- the guards

/**
 * Every numeral the envelope contains - VALUES AND FIELD NAMES BOTH.
 *
 * THE FIELD NAMES COUNT, and the second sentinel run is why. Field names carry
 * units, and a take that describes one correctly quotes it:
 * `spreadMoveLast24hInProbabilityPoints` produces "in the last 24 hours", and
 * a check that knew only the VALUES rejected that as an invented 24. It was
 * being accepted or rejected by luck - the one take that passed did so because
 * a team happened to have scored 24 points.
 *
 * A numeral in a field name is part of what the envelope states, so it is
 * known. This widens the guard by a handful of small integers and keeps it
 * exact where it matters: a figure that appears nowhere in the envelope, name
 * or value, is still a rejection.
 */
export function envelopeNumbers(env) {
  const out = new Set();
  const nums = (s) => { for (const m of String(s).matchAll(/\d+(?:\.\d+)?/g)) out.add(m[0]); };
  const walk = (v) => {
    if (v == null) return;
    if (typeof v === 'number') { out.add(String(v)); out.add(String(Math.abs(v))); return; }
    if (typeof v === 'string') { nums(v); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) { nums(k); walk(val); }
    }
  };
  walk(env);
  return out;
}

/**
 * THE FOUR REJECTIONS, each returning WHY so the ledger can carry it.
 * A take is printed only when all four pass.
 */
export function validateTake(text, env) {
  const t = String(text ?? '').trim();
  if (!t || t.toUpperCase() === 'NONE') return { ok: false, reason: 'none' };
  if (t.includes('—')) return { ok: false, reason: 'em_dash' };
  if (t.length > MAX_CHARS) return { ok: false, reason: `too_long_${t.length}` };
  const sentences = t.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim()).length;
  if (sentences > MAX_SENTENCES) return { ok: false, reason: `too_many_sentences_${sentences}` };

  // THE SUBSET CHECK. Every numeral in the take must be in the envelope.
  const known = envelopeNumbers(env);
  for (const m of t.matchAll(/\d+(?:\.\d+)?/g)) {
    if (!known.has(m[0])) return { ok: false, reason: `unknown_number_${m[0]}` };
  }
  return { ok: true, text: t };
}

// ---------------------------------------------------------------- the call

const FALLBACK_SYSTEM = [
  'WIRE TAKE - one or two sentences beneath a headline.',
  'You are given a headline (an external fact, already attributed) and an envelope of',
  "Sportsvyn's own numbers about the team(s) involved. Write what our numbers say next",
  'to this headline. One specific figure, observed not predicted. Present tense.',
  'No adjectives of judgment, no "could", "should", "expect", "look for".',
  'No pick, no lean, no recommendation. Never introduce a fact, name, or number that is',
  'not in the envelope - if the envelope has nothing relevant, output NONE.',
  'Hyphens only, never em dashes. Max 2 sentences, max 240 characters.',
  "Voice: calibrated to the samples provided (Derik's Sportsvyn prose), not to any other outlet.",
].join(' ');

/** The registered prompt, or the ruled text above if it has not been seeded. */
export async function takePrompt() {
  try {
    const [r] = await sql`
      SELECT system_prompt, model, max_tokens, temperature
        FROM ai_prompt_templates
       WHERE slug = ${TAKE_PROMPT_SLUG} AND is_active
       ORDER BY version DESC LIMIT 1`;
    if (r?.system_prompt) return r;
  } catch { /* fall through */ }
  return { system_prompt: FALLBACK_SYSTEM, model: MODEL, max_tokens: MAX_TOKENS, temperature: 0.4 };
}

/**
 * THE WRITER RECEIVES THE HEADLINE AND THE ENVELOPE. Nothing else - no lane, no
 * url, no source, no other items. It cannot cite what it was never given.
 */
export async function generateTake(item, env, { prompt } = {}) {
  if (!client) return { ok: false, reason: 'no_api_key' };
  if (!env) return { ok: false, reason: 'empty_envelope' };
  const p = prompt ?? await takePrompt();
  // THE FIELD NAMES ARE THE UNITS. Say so, so the writer does not have to
  // guess what a bare number measures.
  const user = `Headline: ${item.headline}\n\nEnvelope (every field name states what its number is; `
    + `use no figure that is not here, and describe each one only as its field name describes it):\n`
    + `${JSON.stringify(env, null, 2)}\n\n`
    + 'Write the take per the system instructions, or output NONE.';
  let res;
  try {
    res = await client.messages.create({
      model: p.model ?? MODEL,
      max_tokens: p.max_tokens ?? MAX_TOKENS,
      temperature: p.temperature ?? 0.4,
      system: p.system_prompt,
      messages: [{ role: 'user', content: user }],
    });
  } catch (e) { return { ok: false, reason: `api_error:${String(e?.message ?? e).slice(0, 80)}` }; }
  const text = res?.content?.[0]?.text ?? '';
  const v = validateTake(text, env);
  return v.ok ? { ok: true, text: v.text, raw: text } : { ok: false, reason: v.reason, raw: text };
}

/** Items that could take one: a resolved team, no take yet, recent. */
export async function takeCandidates({ limit = 8 } = {}) {
  return sql`
    SELECT id, headline, lane, team_ids, league_id
      FROM news_items
     WHERE take IS NULL
       AND array_length(team_ids, 1) >= 1
       AND seen_at > now() - interval '2 days'
     ORDER BY seen_at DESC
     LIMIT ${limit}`;
}

export async function writeTake(id, text) {
  await sql`UPDATE news_items SET take = ${text}, take_generated_at = now() WHERE id = ${id}`;
}
