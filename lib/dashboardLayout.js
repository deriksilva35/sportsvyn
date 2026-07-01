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

export async function getResolvedLayout(userId, scope = 'my') {
  // Logged-out / no id -> the registry default set (follows convention).
  if (userId == null) return DEFAULT_ACTIVE.map((id) => ({ id }));

  const rows = await sql`
    SELECT layout FROM user_dashboards
     WHERE user_id = ${userId} AND scope = ${scope}
     LIMIT 1
  `;
  const raw = rows[0]?.layout ?? null;

  // No row (or a non-array layout) -> fall back to the code default. This is
  // the common case today: no user has customized yet.
  if (!Array.isArray(raw)) return DEFAULT_ACTIVE.map((id) => ({ id }));

  // Resolve the stored order against the live registry: keep only entries whose
  // id is still a real panel, preserve order, carry { id, w? } through.
  return raw.filter((p) => p != null && p.id in PANELS);
}
