/**
 * lib/gridiron/gameBrief.js - the Tier 1 brief, for a code measured in quarters.
 *
 * THE ENVELOPE IS THE WORK. lib/aiBrief.js already writes about touchdowns: its
 * system prompt names "the goal/touchdown/run/etc." and its gates are about
 * sourcing, not about soccer. What it could not do was ASSEMBLE a football
 * game, because assembleEnvelopeFromDb reads match_events, match_lineups and
 * match_statistics - three tables with zero gridiron rows. Pointed at an NFL
 * game it would have handed the model a score, two names and three empty
 * arrays, and the deterministic fallback would have published a brief with
 * nothing in it. That is the exact failure the cron's league allowlist was put
 * there to prevent, and this module is what makes 'nfl' safe to add to it.
 *
 * NO MINUTES. A gridiron event has a quarter and a clock, and the envelope says
 * so in words: quarter "Second", clock "14:55". It deliberately carries no
 * numeric period, because aiBrief's hallucination gate treats a bare ordinal
 * ("in the 4th") as a numeral that must appear in the source. Feeding a quarter
 * NUMBER would license that phrasing for every quarter in the game, including
 * the ones where nothing happened. Feeding the word instead means the model
 * writes "the fourth quarter", which is both better prose and checkable.
 *
 * CFB IS NOT WIRED HERE. The college feed has no scoring-play source, so a CFB
 * envelope would be a score and two names - the thin brief again, wearing a
 * different hat.
 */

import { sql } from '../db.js';
import { generateBrief } from '../aiBrief.js';
import { fantasyPoints } from '../fantasy/scoring.js';
import { getGamePage, proseLine } from './gameDetail.js';

// How many named players per side reach the model. Enough that paragraph 2 has
// material, few enough that the envelope is not a box score in prose.
const LINES_PER_SIDE = 6;

/**
 * Read a stored gridiron game into the shape lib/aiBrief.js consumes.
 * Returns null when the game has nothing to describe - which is the honest
 * outcome for a scheduled fixture and for any game whose detail fetch has not
 * landed yet.
 */
export async function assembleGridironEnvelope(matchId) {
  const rows = await sql`
    SELECT m.slug FROM matches m WHERE m.id = ${matchId} LIMIT 1`;
  if (!rows[0]) throw new Error(`No match row for id ${matchId}`);

  const g = await getGamePage(rows[0].slug);
  if (!g) return null;
  if (g.status !== 'final') return null;
  // A brief with no plays in it is the thin brief. Better to publish nothing
  // and let the page render its line score.
  if (!g.events.length) return null;

  const teamName = (id) => (id === g.home.id ? g.home.name : id === g.away.id ? g.away.name : null);

  const events = g.events.map((e) => ({
    quarter: e.quarter_label ?? null,
    clock: e.clock ?? null,
    type: e.scoring_type ?? null,
    // The provider's prose IS the detail: "Simi Fehoko 5 Yd pass from Carson
    // Beck (Chad Ryland Kick)" carries the yardage, the passer and the try in
    // one string, and every name in it is sourced by definition.
    detail: e.description ?? null,
    team: teamName(e.team_id),
    player: e.player_name ?? null,
    score_after: e.home_score != null && e.away_score != null
      ? { [g.home.name]: e.home_score, [g.away.name]: e.away_score }
      : null,
  }));

  return {
    match: {
      league: g.leagueSlug.toUpperCase(),
      round: [g.seasonPhase === 'PRE' ? 'Preseason' : null, g.weekLabel ?? `Week ${g.week}`]
        .filter(Boolean).join(' · '),
      kickoff_at: g.kickoffAt instanceof Date ? g.kickoffAt.toISOString() : (g.kickoffAt ?? null),
      venue: [g.venue, g.venueCity].filter(Boolean).join(', ') || null,
      status: 'FT',
      score: { home: g.homeScore, away: g.awayScore },
      teams: { home: g.home.name, away: g.away.name },
      // The quarter-by-quarter grid, named plainly. This is what lets paragraph
      // 1 say a first quarter was scoreless without the model inferring it.
      line_score: g.lineScores ?? null,
      // WHAT THE GAME WAS. The prompt's low-stakes branch is written in soccer
      // and reaches for the word "friendly"; a preseason football game is an
      // exhibition, and saying so in the envelope is cheaper than hoping.
      stakes: g.seasonPhase === 'PRE'
        ? 'Preseason exhibition. No standings, no bracket, nothing at stake in the result.'
        : null,
      // THE RULE TRAVELS WITH THE DATA. Put in the envelope rather than the
      // shared SYSTEM_PROMPT because quarters are gridiron's, and the prompt is
      // written for a sport with halves. A constraint stated next to the number
      // it governs is harder to skim past than one twelve fields earlier.
      numeric_claim_rule:
        'EVERY COUNT YOU STATE MUST BE READ FROM scoring_counts, NEVER TALLIED FROM '
        + 'THE EVENT LIST. This covers touchdowns, field goals, points, and any total '
        + 'or run of them. Use by_team for a team\'s touchdowns or field goals, '
        + 'points_by_quarter_by_team for anything about a quarter, and '
        + 'touchdowns_by_scoring_player / field_goals_by_kicker for an individual. '
        + 'A count that belongs to BOTH teams combined must not be attached to one of '
        + 'them. If a run of points spans more than one quarter, say so or name no '
        + 'quarter at all. Yardages, clock times and scorelines are not counts and are '
        + 'read from the events as usual.',
      // COUNTS, DERIVED, so the model reads them instead of tallying twelve
      // events by hand. It got both of these wrong on the first real run -
      // "four field goals" for a kicker who kicked three, "five touchdowns" in
      // a quarter that had four - and neither is the kind of error the gates
      // catch: they check names and minutes, not arithmetic.
      scoring_counts: countScoring(events),
    },
    events,
    // NOT `lineups`. Football has no start XI, and calling this one would put a
    // word in front of the model that does not describe what it is reading.
    player_lines: [g.away, g.home].filter((t) => t?.id).map((t) => ({
      team: t.name,
      players: topLines(g, t.id),
    })),
  };
}

/**
 * Every tally a brief is likely to want, counted once and correctly.
 *
 * Per quarter, per team, and per scoring player - that last one is what stops
 * "four field goals" being written about a kicker with three, because his
 * three appears in the data as a number rather than as three separate rows to
 * add up.
 */
export function countScoring(events) {
  const bump = (o, k, type) => {
    o[k] ??= {};
    o[k][type] = (o[k][type] ?? 0) + 1;
  };
  const by_quarter = {}; const by_team = {};
  // POINTS, PER QUARTER, PER TEAM - the one tally a quarter-level sentence
  // actually needs, and the one the model was left to do in its head.
  //
  // by_quarter above counts PLAY TYPES ("Second: {FG:1, TD:2}"), which says
  // nothing about who scored them or what they were worth. On 14 Aug the brief
  // for Miami at Washington read "Washington answered with 20 consecutive
  // points across the second quarter". Washington scored 17 in the second and
  // the last 3 in the fourth. Every fact needed to say that correctly was in
  // the envelope - as five events the model had to difference by hand.
  //
  // Derived from score_after DELTAS rather than from the provider's line_score:
  // line_score is patchy on live rows (see lineScore.js) and a null quarter
  // there would silently drop points, whereas the events are the same rows the
  // rest of the brief is checked against.
  const points_by_quarter_by_team = {};
  const running = {};
  // THE KEY NAMES CARRY THE SEMANTICS, because the model reads them. A generic
  // "by_player" invites the reading that a quarterback's entry is all the
  // touchdowns he was involved in; the first run took a passer with two
  // touchdown throws and one touchdown run and called it "three passing
  // touchdowns". A passing touchdown is credited HERE to the receiver, and the
  // key says so.
  const touchdowns_by_scoring_player = {};
  const field_goals_by_kicker = {};
  for (const e of events) {
    const type = e.type ?? 'SCORE';
    if (e.quarter) bump(by_quarter, e.quarter, type);
    if (e.team) bump(by_team, e.team, type);
    // Points added by THIS play, from the running score it left behind. A play
    // with no score_after contributes nothing rather than a guessed 7.
    if (e.quarter && e.score_after) {
      for (const [team, total] of Object.entries(e.score_after)) {
        const delta = Number(total) - (running[team] ?? 0);
        running[team] = Number(total);
        if (delta > 0) {
          points_by_quarter_by_team[e.quarter] ??= {};
          points_by_quarter_by_team[e.quarter][team] =
            (points_by_quarter_by_team[e.quarter][team] ?? 0) + delta;
        }
      }
    }
    if (!e.player) continue;
    if (type === 'FG') field_goals_by_kicker[e.player] = (field_goals_by_kicker[e.player] ?? 0) + 1;
    else if (type === 'TD') {
      touchdowns_by_scoring_player[e.player] = (touchdowns_by_scoring_player[e.player] ?? 0) + 1;
    }
  }
  return {
    total_scoring_plays: events.length,
    by_quarter,
    by_team,
    points_by_quarter_by_team,
    touchdowns_by_scoring_player,
    field_goals_by_kicker,
  };
}

/**
 * The players worth naming, ranked by the SAME scoring module the page and the
 * sim use. Not because the brief is about fantasy - it is not, and the points
 * are never shown to the model - but because "who had the biggest game" needs
 * an ordering, and the app already has exactly one answer to that question.
 */
function topLines(game, teamId) {
  const byPlayer = new Map();
  for (const l of game.lines) {
    if (l.team_id !== teamId) continue;
    if (!['passing', 'rushing', 'receiving'].includes(l.stat_group)) continue;
    if (!byPlayer.has(l.player_name)) byPlayer.set(l.player_name, { name: l.player_name, parsed: {} });
    Object.assign(byPlayer.get(l.player_name).parsed, l.parsed ?? {});
  }
  return [...byPlayer.values()]
    .map((p) => ({ name: p.name, line: proseLine(p), rank: fantasyPoints(p.parsed, 'ppr') }))
    .filter((p) => p.line !== '')
    .sort((a, b) => b.rank - a.rank)
    .slice(0, LINES_PER_SIDE)
    .map(({ name, line }) => ({ name, line }));
}

/**
 * The deterministic last resort, in football. Bland and accurate: who won,
 * where, and every scoring play by quarter. Never reached unless the model
 * fails gating twice.
 */
export function gridironFallback(envelope) {
  const m = envelope.match ?? {};
  const home = m.teams?.home ?? 'Home';
  const away = m.teams?.away ?? 'Away';
  const hs = m.score?.home ?? 0;
  const as = m.score?.away ?? 0;

  const byQuarter = new Map();
  for (const e of envelope.events ?? []) {
    const q = e.quarter ?? 'Unknown';
    if (!byQuarter.has(q)) byQuarter.set(q, []);
    byQuarter.get(q).push(`${e.detail ?? e.player ?? 'Score'}${e.clock ? ` (${e.clock})` : ''}`);
  }
  const plays = [...byQuarter.entries()].map(([q, list]) => `${q}: ${list.join('; ')}.`).join(' ');

  const winner = hs > as ? home : as > hs ? away : null;
  const headline = winner
    ? `${winner} wins ${Math.max(hs, as)}-${Math.min(hs, as)} over ${winner === home ? away : home}${m.venue ? ` at ${m.venue}` : ''}.`
    : `${away} and ${home} finish level at ${hs}${m.venue ? ` at ${m.venue}` : ''}.`;

  return {
    headline,
    paragraph_1: `${away} ${as}, ${home} ${hs}.${plays ? ` ${plays}` : ''}`,
    paragraph_2: `${m.league ?? 'Football'}${m.round ? ` · ${m.round}` : ''}${m.venue ? ` · ${m.venue}` : ''}.`,
    paragraph_3: null,
  };
}

// ---------------------------------------------------------------------------
// THE INPUT GATE
// ---------------------------------------------------------------------------
/**
 * DO THE TWO SOURCES IN THE ENVELOPE AGREE WITH EACH OTHER?
 *
 * This is arithmetic on our own derived data, and it runs BEFORE the model is
 * called. It parses no prose, so it has no false-positive classes: it cannot
 * misread "Mevis and Butker combined for five" as a claim about one team,
 * because it never reads a sentence. It only asks whether the running score on
 * the last scoring play equals the final score we stored.
 *
 * IT EXISTS BECAUSE OF BRIEF #191. That game's event spine ended KC 9 - LAR 20
 * while the stored score and the provider's line_score both said KC 12: a
 * fourth-quarter Butker field goal had not been ingested when the brief fired,
 * 38 seconds after the events were written. The envelope therefore contained
 * two mutually contradictory truths, and the model - correctly, per its own
 * instructions - read the quarter split from line_score and the field-goal
 * count from scoring_counts, which is derived from the incomplete event list.
 * It published "Butker was good on all three of his attempts" alongside a
 * fourth quarter he could only have reached with four. Neither half was a
 * hallucination. The inputs were broken, and no prose gate can reliably catch a
 * brief that is faithfully reporting bad data.
 *
 * SO THE FIX IS UPSTREAM: if the inputs disagree, do not ask the model to
 * reconcile them. Publish the deterministic template, which lists only the
 * plays we actually have and cannot invent a reconciliation because it is never
 * asked to make one.
 *
 * THE RUNNING SCORE IS THE SUM, and using it avoids having to know what a
 * scoring play is worth - two-point conversions, missed extra points and safeties
 * all price themselves correctly in a number the provider already computed. Max
 * rather than last, so the check does not depend on event ordering; scores are
 * monotonic.
 *
 * INDETERMINATE IS NOT FAILURE. A provider that omits running scores entirely
 * leaves nothing to compare, and refusing every such game would trade one
 * silent fault for a louder one. That case passes and says so.
 */
export function reconcileScores(envelope) {
  const m = envelope?.match ?? {};
  const homeName = m.teams?.home;
  const awayName = m.teams?.away;
  const stored = { home: m.score?.home ?? null, away: m.score?.away ?? null };

  let events = null;
  for (const e of envelope?.events ?? []) {
    const s = e?.score_after;
    if (!s) continue;
    const h = Number(s[homeName]);
    const a = Number(s[awayName]);
    if (!Number.isFinite(h) || !Number.isFinite(a)) continue;
    events = events
      ? { home: Math.max(events.home, h), away: Math.max(events.away, a) }
      : { home: h, away: a };
  }

  if (!Number.isFinite(stored.home) || !Number.isFinite(stored.away)) {
    return { ok: false, reason: 'no stored score', stored, events, delta: null };
  }
  if (!events) {
    return { ok: true, indeterminate: true, reason: 'events carry no running score', stored, events: null, delta: null };
  }

  const delta = { home: stored.home - events.home, away: stored.away - events.away };
  const ok = delta.home === 0 && delta.away === 0;
  return {
    ok,
    ...(ok ? {} : { reason: 'stored score disagrees with the scoring plays' }),
    stored,
    events,
    delta,
  };
}

/** Assemble, generate, gate. Returns null when there is nothing to brief. */
export async function generateGameBrief(matchId) {
  const envelope = await assembleGridironEnvelope(matchId);
  if (!envelope) return null;

  // BLOCKING, and before the model is called - not a veto on its output.
  const reconciled = reconcileScores(envelope);
  if (!reconciled.ok) {
    console.log('[brief-gate] input_mismatch', JSON.stringify({
      match_id: matchId,
      reason: reconciled.reason,
      stored: reconciled.stored,
      events: reconciled.events,
      delta: reconciled.delta,
    }));
    return {
      ...gridironFallback(envelope),
      attempts: [],
      validation_status: 'fallback',
      model: null,                       // no model was called; do not imply one was
      raw_response: { gate: 'input_mismatch', ...reconciled },
      envelope,
    };
  }

  const result = await generateBrief(envelope, { fallback: gridironFallback });
  return { ...result, envelope };
}

/**
 * The brief as the game page wants it: paragraphs already assembled, and a
 * published stamp in ET.
 *
 * ONLY PUBLISHED ROWS RENDER. A generated-but-unpublished row is a draft, and
 * the page is not a preview surface.
 */
export async function getBriefForMatch(matchId) {
  const rows = await sql`
    SELECT headline, paragraph_1, paragraph_2, paragraph_3,
           validation_status, published_at, generated_at
      FROM match_briefs
     WHERE match_id = ${matchId} AND kind = 'auto' AND published_at IS NOT NULL
     ORDER BY published_at DESC
     LIMIT 1`;
  const b = rows[0];
  if (!b) return null;
  const stamp = b.published_at ?? b.generated_at;
  return {
    headline: b.headline,
    paragraphs: [b.paragraph_1, b.paragraph_2, b.paragraph_3].filter(Boolean),
    validationStatus: b.validation_status,
    publishedLabel: stamp
      ? `${new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: false,
      }).format(new Date(stamp))} ET`
      : null,
  };
}
