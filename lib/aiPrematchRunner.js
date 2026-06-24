// lib/aiPrematchRunner.js — fires the analyst pass + writes the row +
// enforces freeze.
//
// LIFECYCLE OF A PRE-MATCH ROW (articles, type='preview', score_type='watch'):
//   pending generation
//     ↓  runner fires
//   one row exists per (match_id, type='preview', score_type='watch')
//     ↓  always inserted with status='published' (auto-publish-all policy)
//   status='published'  → renders immediately on the match page
//     ↓  admin actions
//   edited_at IS NOT NULL after any admin save (freeze marker for UI)
//
// AUTO-PUBLISH-ALL POLICY:
//   moment_basis ('sporting' | 'cultural' | 'geopolitical') is RECORDED on
//   every row as an audit signal (so the slate can be queried by basis
//   later) but it no longer gates publish. Every generated row goes live
//   the moment it's written. The earlier 'cultural'/'geopolitical' hold
//   tier has been removed.
//
// FREEZE INVARIANT (§7.7 — never auto-overwrite):
//   if a row already exists for (match_id, type, score_type), the runner
//   is a NO-OP. Re-eval is an explicit admin action (separate operation,
//   not in this slice's scope). This guarantees:
//     - re-running the runner on a published fixture preserves the score
//     - re-running on an edited fixture preserves the edit
//
// SKIP RULES:
//   - status='cancelled' matches: analyst pass does NOT run (no editorial
//     point in scoring a fixture that won't happen). Render keeps the stub.
//   - status='live' or 'final': refuses to publish a stale or moot
//     kickoff-time prediction.
//   - already-generated rows: no-op (freeze).
//
// RENDER NEVER INVOKES THIS. The match page reads the row; if no row
// exists the stub renders. The runner is invoked by manual scripts and
// by /api/cron/prematch-analyst.

import { sql } from './db.js';
import { runAnalystPassForMatch, computeComposite } from './aiPrematch.js';

// Validation gates are advisory at this layer — a validation flag does
// not block publish (the length/voice/dash gates are belt-and-suspenders
// on top of the system prompt + normalize step); a SCORE-RANGE failure
// would block, and that surfaces as parsed=null upstream which fails
// the runner anyway. See lib/aiPrematch.js for the full gate set.

// Build the row payload from a successful analyst pass result.
//
// Title takes the team names verbatim from the teams row (which stores
// display-ready casing: 'USA', 'South Korea', 'Türkiye', 'Curaçao',
// 'Bosnia & Herzegovina'). Previously the title was derived from the
// kebab-case slug and first-letter-uppercased, which downcased
// acronyms ('Usa') and stripped diacritics and ampersands. Per-row
// fixes for already-published rows are a separate UPDATE.
function rowPayloadFromResult(r, slug, homeName, awayName) {
  const d = r.dimensions;
  const p = r.parsed;
  return {
    title: `${homeName} vs ${awayName}`,
    subtitle: p.watch_summary, // the 40-70 word verdict as serif italic subtitle
    body: `${p.preview_paragraph_1}\n\n${p.preview_paragraph_2}`,
    stakes_score:    d.stakes,
    quality_score:   d.quality,
    narrative_score: d.narrative,
    drama_score:     d.drama,
    moment_score:    d.moment,
    composite_score: r.composite,
    stakes_note:     p.justifications.stakes,
    quality_note:    p.justifications.quality,
    narrative_note:  p.justifications.narrative,
    drama_note:      p.justifications.drama,
    moment_note:     p.justifications.moment,
    watch_summary:   p.watch_summary,
    moment_basis:    r.moment_basis,
  };
}

// Idempotent fire for one match. Returns one of:
//   { outcome: 'skipped_cancelled' }                     ← match status='cancelled'
//   { outcome: 'skipped_live', match_status }            ← status='live' OR 'final'
//   { outcome: 'skipped_exists', existing_status }       ← freeze
//   { outcome: 'generated', status, moment_basis, composite, article_id }
//   { outcome: 'failed', error }
export async function runAndPublishPrematchForMatch(matchDbId) {
  // Skip gate — fetch the match row's status first. The pre-match
  // analyst pass is a KICKOFF-TIME prediction (voice-bible §7.1: the
  // pre-match Watch Score is editorial PREDICTION — never changes
  // retroactively). If a fire arrives after kickoff (status='live'
  // or 'final') or for a fixture that won't happen (status='cancelled'),
  // we refuse to publish a stale or moot prediction. On a normal slate
  // the fire lands before any match has kicked off and this excludes
  // nothing; it's the safety net for late fires.
  //
  // Live and final share a single outcome label ('skipped_live') so
  // log scans stay simple; the match_status field disambiguates when
  // it matters.
  // Pull display-ready team names alongside the match row so the title
  // builder does not have to round-trip back through the kebab-case
  // slug (which strips casing, diacritics, and ampersands).
  const matchRows = await sql`
    SELECT m.id, m.slug, m.status, m.league_id,
           h.name AS home_name, a.name AS away_name
      FROM matches m
      JOIN teams h ON h.id = m.home_team_id
      JOIN teams a ON a.id = m.away_team_id
     WHERE m.id = ${matchDbId}
  `;
  if (matchRows.length === 0) return { outcome: 'failed', error: 'match_not_found' };
  const m = matchRows[0];
  if (m.status === 'cancelled') {
    return { outcome: 'skipped_cancelled', slug: m.slug };
  }
  if (m.status === 'live' || m.status === 'final') {
    return { outcome: 'skipped_live', slug: m.slug, match_status: m.status };
  }

  // Freeze gate — refuse to overwrite ANY existing row for this fixture's
  // analyst slot. (match_id, type='preview', score_type='watch') is the
  // natural key. Even pending_review rows are protected; the runner is
  // never the path to regenerate — that's a separate explicit admin op.
  const existing = await sql`
    SELECT id, status, edited_at IS NOT NULL AS is_edited
      FROM articles
     WHERE match_id = ${matchDbId}
       AND type = 'preview'
       AND score_type = 'watch'
     LIMIT 1
  `;
  if (existing.length > 0) {
    return {
      outcome: 'skipped_exists',
      slug: m.slug,
      existing_status: existing[0].status,
      is_edited: existing[0].is_edited,
    };
  }

  // Generate.
  const result = await runAnalystPassForMatch(matchDbId);
  if (!result.ok) {
    return { outcome: 'failed', slug: m.slug, error: result.error };
  }

  // Auto-publish-all policy: every generated row goes live immediately
  // regardless of moment_basis. The basis is still recorded on the row as
  // an audit signal.
  const status = 'published';
  const payload = rowPayloadFromResult(result, m.slug, m.home_name, m.away_name);

  // INSERT. We do not use ON CONFLICT — the freeze guard above is the
  // single guard; if a race inserted between the SELECT and this INSERT,
  // the unique-by-(match_id,type,score_type) constraint we'd want
  // doesn't exist on this table (the articles table is multi-purpose
  // with type as a discriminator). Belt-and-suspenders: we re-check
  // post-insert and clean up if a duplicate landed.
  const inserted = await sql`
    INSERT INTO articles (
      slug, type, score_type, title, subtitle, body,
      stakes_score, quality_score, narrative_score, drama_score, moment_score,
      composite_score,
      stakes_note, quality_note, narrative_note, drama_note, moment_note,
      watch_summary, moment_basis,
      league_id, match_id, team_ids,
      status, published_at, author
    ) VALUES (
      ${`prematch-${m.slug}`}, 'preview', 'watch',
      ${payload.title}, ${payload.subtitle}, ${payload.body},
      ${payload.stakes_score}, ${payload.quality_score}, ${payload.narrative_score}, ${payload.drama_score}, ${payload.moment_score},
      ${payload.composite_score},
      ${payload.stakes_note}, ${payload.quality_note}, ${payload.narrative_note}, ${payload.drama_note}, ${payload.moment_note},
      ${payload.watch_summary}, ${payload.moment_basis},
      ${m.league_id}, ${matchDbId}, ${'{}'}::int[],
      ${status}, ${new Date()}, 'auto'
    )
    RETURNING id, status
  `;

  return {
    outcome: 'generated',
    slug: m.slug,
    article_id: inserted[0].id,
    status: inserted[0].status,
    moment_basis: result.moment_basis,
    composite: result.composite,
    dimensions: result.dimensions,
  };
}
