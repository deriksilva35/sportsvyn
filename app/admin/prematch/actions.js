'use server';

/**
 * Server Actions for /admin/prematch/[id] edit form.
 *
 * Two actions:
 *   - saveEdit(formData) — write the edited values back, recompute composite
 *                          server-side (flat mean), set edited_at = now().
 *   - publishHeld(id)    — flip status from 'preview' → 'published' for a
 *                          pending_review row.
 *
 * Both actions are server-side ONLY. They are reachable through the form
 * action prop in the edit page; the proxy.js Basic Auth matcher covers
 * /admin/:path*, but Next 16 Server Actions land at /_next/... — for
 * defense-in-depth, BOTH actions re-verify ADMIN_SECRET presence on the
 * server (the proxy catches the rendered page request; a deferred POST
 * could theoretically miss it).
 */

import { sql } from '@/lib/db';
import { recomputeCompositeFromRow } from '@/lib/aiPrematch';
import { revalidatePath } from 'next/cache';

function clamp10(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
}

function assertAdminEnv() {
  // Defense-in-depth: the proxy already gates /admin/* page requests, but
  // a Server Action POST is dispatched through /_next/... which the
  // matcher doesn't cover by default. Refuse to act if the admin env is
  // missing — same fail-closed shape as proxy.js itself.
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_SECRET) {
    throw new Error('Admin auth misconfigured');
  }
}

export async function saveEdit(formData) {
  assertAdminEnv();
  const id = Number(formData.get('id'));
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid article id');

  // Read existing row to confirm it's an analyst-pass row (defensive).
  const existing = await sql`
    SELECT id FROM articles WHERE id = ${id} AND type = 'preview' AND score_type = 'watch'
  `;
  if (existing.length === 0) throw new Error('Article not found or not an analyst-pass row');

  // Pull and clamp dim scores (recompute composite from the edited set).
  const dims = {
    stakes_score:    clamp10(formData.get('stakes_score')),
    quality_score:   clamp10(formData.get('quality_score')),
    narrative_score: clamp10(formData.get('narrative_score')),
    drama_score:     clamp10(formData.get('drama_score')),
    moment_score:    clamp10(formData.get('moment_score')),
  };
  const composite = recomputeCompositeFromRow(dims);

  // Optional text fields — empty string OK, NULL not allowed for notes/body.
  const fields = {
    title:          (formData.get('title') ?? '').toString().trim(),
    subtitle:       (formData.get('subtitle') ?? '').toString().trim(),
    body:           (formData.get('body') ?? '').toString().trim(),
    watch_summary:  (formData.get('watch_summary') ?? '').toString().trim(),
    stakes_note:    (formData.get('stakes_note') ?? '').toString().trim(),
    quality_note:   (formData.get('quality_note') ?? '').toString().trim(),
    narrative_note: (formData.get('narrative_note') ?? '').toString().trim(),
    drama_note:     (formData.get('drama_note') ?? '').toString().trim(),
    moment_note:    (formData.get('moment_note') ?? '').toString().trim(),
    moment_basis:   (formData.get('moment_basis') ?? '').toString().trim() || null,
  };

  // moment_basis enum gate — the CHECK constraint will reject bad values,
  // but catch in the action for a cleaner error.
  if (fields.moment_basis && !['sporting', 'cultural', 'geopolitical'].includes(fields.moment_basis)) {
    throw new Error(`Invalid moment_basis: ${fields.moment_basis}`);
  }

  await sql`
    UPDATE articles SET
      title = ${fields.title},
      subtitle = ${fields.subtitle},
      body = ${fields.body},
      watch_summary = ${fields.watch_summary},
      stakes_score = ${dims.stakes_score},
      quality_score = ${dims.quality_score},
      narrative_score = ${dims.narrative_score},
      drama_score = ${dims.drama_score},
      moment_score = ${dims.moment_score},
      composite_score = ${composite},
      stakes_note = ${fields.stakes_note},
      quality_note = ${fields.quality_note},
      narrative_note = ${fields.narrative_note},
      drama_note = ${fields.drama_note},
      moment_note = ${fields.moment_note},
      moment_basis = ${fields.moment_basis},
      edited_at = now(),
      updated_at = now()
    WHERE id = ${id}
  `;

  // Force the match-page render to pick up the new values on next request.
  revalidatePath('/admin/prematch');
  revalidatePath(`/admin/prematch/${id}`);
}

export async function publishHeld(formData) {
  assertAdminEnv();
  const id = Number(formData.get('id'));
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid article id');

  await sql`
    UPDATE articles
       SET status = 'published',
           published_at = COALESCE(published_at, now()),
           updated_at = now()
     WHERE id = ${id}
       AND type = 'preview' AND score_type = 'watch'
  `;

  revalidatePath('/admin/prematch');
  revalidatePath(`/admin/prematch/${id}`);
}

export async function unpublish(formData) {
  assertAdminEnv();
  const id = Number(formData.get('id'));
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid article id');

  await sql`
    UPDATE articles
       SET status = 'unpublished',
           updated_at = now()
     WHERE id = ${id}
       AND type = 'preview' AND score_type = 'watch'
  `;

  revalidatePath('/admin/prematch');
  revalidatePath(`/admin/prematch/${id}`);
}
