'use server';

/**
 * Server Actions for the My Sportsvyn dashboard layout.
 *
 * saveUserLayout is the FIRST writer to user_dashboards. It mirrors the
 * app/actions/follows.js conventions: auth is resolved INSIDE the action
 * (the client-supplied userId is never trusted), the write is idempotent
 * (INSERT ... ON CONFLICT DO UPDATE, keyed on the composite (user_id,
 * scope) PK from migration 039), and the return value is a typed result
 * so the client can branch on .ok without remembering a shape.
 *
 * The sanitizer is the SAFETY BOUNDARY. The layout arrives from an
 * untrusted client, so we rebuild it entry-by-entry from the server-side
 * registry rather than storing what was sent:
 *   - only ids that are BOTH in the PANELS registry AND have a binding in
 *     PANEL_BINDINGS survive. That rejects bogus ids, unbuilt panels, and
 *     member-tier panels (which carry no binding today) in one test -- a
 *     panel a user cannot render must never be persisted.
 *   - ids are de-duped, first-seen order preserved (order = render order).
 *   - w (a dormant width override for the future customize UI) is kept
 *     only when it is a positive integer; we never invent a default w.
 * An empty result is never written: persisting a layout that renders
 * nothing would strand the user on a blank /my, so we return without a
 * write and the caller keeps its current/default view.
 *
 * Return shapes:
 *   { ok: false, reason: 'unauthenticated' }
 *   { ok: false, reason: 'bad_input' }      -- layout was not an array
 *   { ok: false, reason: 'empty_layout' }   -- nothing survived sanitizing
 *   { ok: false, reason: 'bad_scope' }       -- scope not 'my' | 'all'
 *   { ok: true,  layout: sanitized }
 */

import { sql } from '@/lib/db';
import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';
import { PANELS } from '@/lib/panels';
import { PANEL_BINDINGS } from '@/lib/panelLoaders';
import { vocabularyFor } from '@/lib/scopeVocabulary';

// SCOPES ARE VOCABULARIES NOW, not a name whitelist. 'today' stores league ids
// against the same table (migration 039's scope column, exactly its stated
// purpose); sanitizing those against PANELS would have rejected every one and
// returned 'empty_layout', which reads to a user as "my chips don't save".
// 'all' is kept because it was already accepted here.
const EXTRA_SCOPES = new Set(['all']);

export async function saveUserLayout(layout, scope = 'my') {
  // 1. Auth INSIDE the action -- never trust a client-supplied userId.
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, reason: 'unauthenticated' };

  // 2. Validate + sanitize the incoming layout. This is the safety boundary.
  if (!Array.isArray(layout)) return { ok: false, reason: 'bad_input' };

  // 4. Validate scope FIRST - the vocabulary decides what a valid id is, so it
  //    has to be resolved before anything can be sanitized against it. (This
  //    check used to sit after the loop; with per-scope vocabularies that
  //    ordering would sanitize against the wrong dictionary.)
  const vocab = vocabularyFor(scope);
  if (!vocab && !EXTRA_SCOPES.has(scope)) return { ok: false, reason: 'bad_scope' };

  const sanitized = [];
  const seen = new Set();
  for (const entry of layout) {
    const id = entry?.id;
    // Rebuilt entry-by-entry from the SERVER's vocabulary, never stored as
    // sent. For 'my' that is still "registered AND bound" - the bound check is
    // what rejects unbuilt and member-tier panels.
    if (typeof id !== 'string') continue;
    if (vocab && !vocab.isValidWrite(id, { bindings: PANEL_BINDINGS })) continue;
    if (!vocab && !(id in PANELS && id in PANEL_BINDINGS)) continue;
    if (seen.has(id)) continue; // dedupe, first-seen order preserved
    seen.add(id);
    // w is dormant width metadata: keep only a positive integer, else drop it.
    const w = entry.w;
    sanitized.push(Number.isInteger(w) && w > 0 ? { id, w } : { id });
  }

  // 3. Never persist a layout that would render nothing.
  if (sanitized.length === 0) return { ok: false, reason: 'empty_layout' };

  // 5. Idempotent upsert on the composite (user_id, scope) PK.
  await sql`
    INSERT INTO user_dashboards (user_id, scope, layout, updated_at)
    VALUES (${userId}, ${scope}, ${JSON.stringify(sanitized)}::jsonb, now())
    ON CONFLICT (user_id, scope) DO UPDATE
      SET layout = EXCLUDED.layout, updated_at = now()
  `;

  // 6. Re-render the resolved layout on the server surface.
  revalidatePath(scope === 'today' ? '/' : '/my');

  // 7. Echo the sanitized layout the client should now treat as canonical.
  return { ok: true, layout: sanitized };
}
