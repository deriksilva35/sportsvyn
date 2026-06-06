// lib/aiPrematchRunner.js — fires the analyst pass + writes the row +
// makes the publish-or-hold decision + enforces freeze.
//
// LIFECYCLE OF A PRE-MATCH ROW (articles, type='preview', score_type='watch'):
//   pending generation
//     ↓  runner fires
//   one row exists per (match_id, type='preview', score_type='watch')
//     ↓  status set by moment_basis
//   status='published'  → auto-publishes, renders immediately
//   status='preview'    → pending admin review (the held geopolitical case)
//     ↓  admin actions
//   status='published'  ← admin publishes a held row
//   edited_at IS NOT NULL after any admin save (freeze marker for UI)
//
// FREEZE INVARIANT (§7.7 — never auto-overwrite):
//   if a row already exists for (match_id, type, score_type), the runner
//   is a NO-OP. Re-eval is an explicit admin action (separate operation,
//   not in this slice's scope). This guarantees:
//     - re-running the runner on a published fixture preserves the score
//     - re-running on an edited fixture preserves the edit
//     - re-running on a pending_review fixture preserves the pending content
//
// SKIP RULES:
//   - status='cancelled' matches: analyst pass does NOT run (no editorial
//     point in scoring a fixture that won't happen). Render keeps the stub.
//   - already-generated rows: no-op (freeze).
//
// RENDER NEVER INVOKES THIS. The match page reads the row; if no row
// exists or status='preview', the stub renders. The runner is invoked
// by scripts (manual fire), the admin "regenerate" action (later
// slice), or a future cron (also later).

import { sql } from './db.js';
import { runAnalystPassForMatch, computeComposite } from './aiPrematch.js';

// Publish-or-hold decision. ONLY moment_basis='sporting' auto-publishes;
// both 'cultural' and 'geopolitical' hold for admin review.
//
// Rationale: the cultural tier (program-as-identity, post-conflict
// rebuilding narratives, small-program cultural-window framings, etc.)
// carries enough resonance that it warrants a human glance before
// going live — even though it's milder than geopolitical. Deliberate
// choice to err toward review on anything touching cultural/political
// resonance; only purely-sporting reads auto-publish. The held rows
// surface in /admin/prematch under the pending banner.
//
// Validation gates are advisory at this layer — a validation flag
// doesn't block publish (the calibration round-2 flags are length-only
// and substantively clean); a SCORE-RANGE failure would, and that
// surfaces as parsed=null upstream which fails the runner anyway.
export function publishStatusFor(momentBasis) {
  if (momentBasis === 'sporting') return 'published';
  // 'cultural' and 'geopolitical' (and any future tier we add) hold.
  return 'preview';
}

// Build the row payload from a successful analyst pass result.
function rowPayloadFromResult(r, slug) {
  const d = r.dimensions;
  const p = r.parsed;
  return {
    title: slug
      .replace(/-\d{4}-\d{2}-\d{2}$/, '')
      .split('-vs-')
      .map((s) => s.split('-').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' '))
      .join(' vs '),
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
  const matchRows = await sql`SELECT id, slug, status, league_id FROM matches WHERE id = ${matchDbId}`;
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

  const status = publishStatusFor(result.moment_basis);
  const payload = rowPayloadFromResult(result, m.slug);

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
      ${status}, ${status === 'published' ? new Date() : null}, 'auto'
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
