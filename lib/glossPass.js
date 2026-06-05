// lib/glossPass.js — V1 Live Key Moments generation pass.
//
// A separate pass from the live poller. The poller writes structured
// match_events rows INSTANTLY (lib/events.js syncMatchEvents). This
// pass picks up qualifying events with gloss IS NULL, generates a
// gloss via the FROZEN lib/liveGloss.js generator, and writes the
// result to match_events.gloss.
//
// State machine for match_events.gloss (set in migration 027):
//   NULL  → candidate, pass will try
//   ''    → tried already, model returned null or gates dropped — never retry
//   text  → gate-passing gloss, render under the row
//
// Idempotent: only acts on NULL-gloss rows. Re-running this pass is a
// no-op for already-processed events.
//
// VAR lockstep: if an event's is_current flips false (overturn), the
// render filters it out and the gloss vanishes with the row. A
// corrected replacement event is a fresh row with gloss=NULL — the next
// pass tick fills it.
//
// Critical-path discipline: the live poller MUST stay fast. This pass
// is a separate cron entry (or manual invocation) so AI latency never
// gates the structured row write. A gloss-generation failure must NEVER
// affect the row that already exists in the DB.

import { sql } from './db.js';
import {
  buildGlossEnvelope,
  generateGloss,
  validateGloss,
  isQualifyingEvent,
} from './liveGloss.js';

// Candidate-match selector for the cron pass.
//
// Window: live OR finished within 6h. Mirrors the brief sweep's window
// — catches in-progress matches AND just-finished matches whose final
// events landed between cron ticks (no straggler events get stranded).
// Older matches are not glossed retroactively; if you want to backfill
// a single older match, call runGlossPassForMatch(id) directly via
// scripts/run-gloss-pass.mjs.
//
// EXISTS subquery scopes the candidate set to matches with at least
// one un-glossed qualifying event — empty-work skip without a join.
export async function findCandidateMatches({ limit = 20 } = {}) {
  const rows = await sql`
    SELECT m.id, m.slug, m.status, m.kickoff_at
      FROM matches m
     WHERE m.status IN ('live', 'final')
       AND m.kickoff_at > now() - interval '6 hours'
       AND EXISTS (
         SELECT 1 FROM match_events e
          WHERE e.match_id = m.id
            AND e.is_current = true
            AND e.gloss IS NULL
            AND e.event_type IN ('Goal', 'Card', 'Var')
       )
     ORDER BY m.status = 'live' DESC, m.kickoff_at DESC
     LIMIT ${limit}
  `;
  return rows;
}

// Per-match processor. Reused by the cron route AND by the manual dev
// script. Identical envelope construction to the dry-run — buildGlossEnvelope
// from liveGloss.js, scoreAt computing the cumulative state from all
// is_current events up to the moment.
//
// Returns a per-event result array so callers can log behavior:
//   { event_id, outcome: 'kept'|'dropped'|'error', reason?, gloss? }
//
// Writes to DB:
//   - validateGloss PASS+kept → text gloss written
//   - validateGloss model_returned_null → '' written
//   - validateGloss DROP (gate failure)  → '' written
//   - generateGloss error                → '' written
// Never writes a gate-failing gloss as text — empty string is the
// "tried, nothing safe to show" marker that prevents retry.
export async function runGlossPassForMatch(matchId) {
  const matchRows = await sql`
    SELECT
      m.id, m.slug, m.status, m.stage, m.group_code,
      m.home_score, m.away_score, m.kickoff_at,
      ht.name AS home_name, ht.abbreviation AS home_abbreviation,
      at.name AS away_name, at.abbreviation AS away_abbreviation,
      l.name AS league_name
    FROM matches m
    JOIN teams ht ON ht.id = m.home_team_id
    JOIN teams at ON at.id = m.away_team_id
    JOIN leagues l ON l.id = m.league_id
    WHERE m.id = ${matchId}
  `;
  if (matchRows.length === 0) {
    return { match_id: matchId, error: 'match_not_found', results: [] };
  }
  const match = matchRows[0];

  // is_current=true is load-bearing for scoreAt's cumulative count. Same
  // discipline the dry-run runs under — superseded rows (VAR-cancelled,
  // corrected) must not be counted into the score state passed to the model.
  const events = await sql`
    SELECT id, minute, minute_extra, event_type, detail,
           team_side, team_api_id, player_name, assist_name, is_current, gloss
    FROM match_events
    WHERE match_id = ${matchId}
      AND is_current = true
    ORDER BY minute ASC, COALESCE(minute_extra, 0) ASC, id ASC
  `;

  // Only events without a gloss AND that the canonical qualifying-event
  // predicate accepts. Reuses isQualifyingEvent from liveGloss.js so
  // dry-run + live identical.
  const candidates = events.filter((e) => e.gloss === null && isQualifyingEvent(e));

  const results = [];
  for (const event of candidates) {
    const envelope = buildGlossEnvelope(event, {
      match,
      events,
      prematch_angle: null,
    });

    let glossToWrite = '';   // '' = "tried, nothing to show" sentinel
    let outcome = 'dropped';
    let reason = null;
    let modelGloss = null;

    try {
      const gen = await generateGloss(envelope);
      if (gen.error) {
        outcome = 'error';
        reason = gen.error;
      } else if (gen.gloss == null) {
        outcome = 'dropped';
        reason = 'model_returned_null';
      } else {
        modelGloss = gen.gloss;
        const valid = validateGloss(gen.gloss, envelope);
        if (valid.ok && valid.kept) {
          glossToWrite = gen.gloss;
          outcome = 'kept';
        } else {
          outcome = 'dropped';
          reason = valid.reason;
        }
      }
    } catch (err) {
      outcome = 'error';
      reason = String(err?.message ?? err);
    }

    // Single UPDATE per event, conditional on gloss IS NULL so a race
    // against another concurrent pass tick can't double-write or
    // overwrite a kept gloss.
    const updated = await sql`
      UPDATE match_events
         SET gloss = ${glossToWrite}
       WHERE id = ${event.id}
         AND gloss IS NULL
       RETURNING id
    `;

    results.push({
      event_id: event.id,
      minute: event.minute,
      minute_extra: event.minute_extra,
      event_type: event.event_type,
      detail: event.detail,
      player: event.player_name,
      outcome,
      reason,
      gloss: glossToWrite || null,
      raced: updated.length === 0,
    });
  }

  return {
    match_id: matchId,
    slug: match.slug,
    candidates: candidates.length,
    results,
  };
}
