// lib/dashboardLayout.js -- read-only resolver for a user's My Sportsvyn panel
// layout. Mirrors lib/follows.js conventions:
//   · null userId -> safe default (the registry DEFAULT_ACTIVE set) so a caller
//     can pass session?.user?.id straight through without a branch.
//   · never throws on absence -- a no-row or null/non-array layout collapses to
//     the default set. Genuine SQL failures still propagate.
//
// The stored layout is an ordered array of { id, w? } objects (see migration
// 038). We RESOLVE it against the live code registry (lib/panels.js): entries
// whose id is no longer a known panel are dropped, stored order preserved. A
// row's w (width override) is carried through untouched -- it is dormant
// metadata for the future customize/width UI; the render path ignores it today.
//
// scope defaults to 'my' so this call site and every current caller behaves
// exactly as the single-view design did (migration 039 added the scope column
// with default 'my'; /my reads the 'my' scope).

import { sql } from './db.js';
import { PANELS, DEFAULT_ACTIVE } from './panels.js';
import { vocabularyFor } from './scopeVocabulary.js';

export async function getResolvedLayout(userId, scope = 'my') {
  // An id means different things in different scopes: a panel id in 'my', a
  // league id in 'today'. An unknown scope resolves to [] rather than guessing
  // with the panel registry and silently dropping everything.
  const vocab = vocabularyFor(scope);
  if (!vocab) return [];

  // Logged-out / no id -> the scope's default set (follows convention).
  if (userId == null) return vocab.defaults();

  const rows = await sql`
    SELECT layout FROM user_dashboards
     WHERE user_id = ${userId} AND scope = ${scope}
     LIMIT 1
  `;
  const raw = rows[0]?.layout ?? null;

  // No row (or a non-array layout) -> fall back to the scope's default.
  if (!Array.isArray(raw)) return vocab.defaults();

  // Resolve the stored order against the live vocabulary: keep only entries
  // whose id still means something in THIS scope, preserve order, carry
  // { id, w? } through. For 'my' that is exactly `p.id in PANELS`, which is
  // what this line said before scopes had different vocabularies.
  return raw.filter((p) => p != null && vocab.isValidRead(p.id));
}
