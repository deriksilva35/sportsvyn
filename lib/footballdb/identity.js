// lib/footballdb/identity.js — footballdb name -> nfl_players.id.
//
// (normalized_name, team, season): the CONTEXT a match is judged against, not
// a literal join predicate. nfl_players carries no historical per-season team
// - only a CURRENT team_id, which for a player whose career ended in 1985
// describes nothing about 1985. So the actual candidate search is on
// normalized_name alone; team and season are what a human reviewing an
// AMBIGUOUS case would use to break the tie, and they ride on the report for
// exactly that reason. This is the same shape the college-player identity
// path already settled on (nameMatch.js's league='nfl' scope): school/team is
// display and disambiguation context, never the join key itself.
//
// THREE OUTCOMES this function returns, never a fourth.
//   exact      one nfl_players row shares this normalized_name and no other
//              nfl_players row does.
//   created    no nfl_players row shares this normalized_name at all. A new
//              row is minted - bdl_player_id NULL, position from the tab
//              inference below, full_name in "First Last" order (footballdb's
//              own order; no swap needed, confirmed against the source).
//   ambiguous  two or more nfl_players rows share this normalized_name. NEVER
//              ATTACHED to any of them - picking one on a name-only tie is
//              exactly the guess this module exists to refuse. THE CALLER
//              (scripts/footballdb-import.mjs) decides what to do with an
//              ambiguous outcome; per ruling it now mints its OWN brand-new
//              nfl_players row (matched_by 'created-ambiguous' on the season
//              row) rather than dropping the row on the floor - stored, never
//              attached. Still reported by name, team and season, the same
//              rule the college-board recon used when 27 normalized names
//              collided with 2+ real nfl_players rows (Chris Jones -> 4,
//              Mike Williams -> 4).

import { normalizeName } from '../gridiron/nameMatch.js';
import { inferPosition } from '../daily/inferPosition.js';

/**
 * Load every nfl_players row once, keyed by normalized_name -> [{id, position}].
 * One query for a whole season's ingest, not one per player.
 */
export async function loadCandidateIndex(sql) {
  const rows = await sql`SELECT id, normalized_name, position FROM nfl_players WHERE is_team_defense = false`;
  const idx = new Map();
  for (const r of rows) {
    if (!idx.has(r.normalized_name)) idx.set(r.normalized_name, []);
    idx.get(r.normalized_name).push({ id: r.id, position: r.position });
  }
  return idx;
}

/**
 * Resolve one footballdb row's identity.
 * @returns {{ outcome: 'exact'|'created'|'ambiguous', nflPlayerId: number|null, position: string, candidateIds?: number[] }}
 */
export function resolveIdentity(rawName, inferredPosition, candidateIndex) {
  const norm = normalizeName(rawName);
  const candidates = candidateIndex.get(norm) ?? [];
  if (candidates.length === 1) {
    return { outcome: 'exact', nflPlayerId: candidates[0].id, position: candidates[0].position ?? inferredPosition };
  }
  if (candidates.length > 1) {
    return { outcome: 'ambiguous', nflPlayerId: null, position: inferredPosition, candidateIds: candidates.map((c) => c.id) };
  }
  return { outcome: 'created', nflPlayerId: null, position: inferredPosition };
}

/**
 * Create one nfl_players row for a footballdb identity with no BDL match.
 * bdl_player_id NULL - deliberately: this player predates BDL's own 2002
 * floor for the overwhelming majority of created rows (measured on 1995,
 * ~71%), so there is no BDL id to carry. full_name is footballdb's own
 * "First Last" string - the source's convention, not swapped, because it
 * already reads that way (confirmed against the raw workbook, unlike
 * Fantrax's "Last, First").
 */
export async function createPlayer(sql, fullName, position) {
  const norm = normalizeName(fullName);
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0] ?? null;
  const last = parts.length > 1 ? parts.slice(1).join(' ') : null;
  const rows = await sql`
    INSERT INTO nfl_players (first_name, last_name, full_name, normalized_name, position)
    VALUES (${first}, ${last}, ${fullName}, ${norm}, ${position})
    RETURNING id`;
  return rows[0].id;
}

/**
 * resolveIdentity() PLUS the write it implies - the one place the ruling
 * "an ambiguous identity is stored, never attached" lives. exact reuses the
 * matched id and writes nothing new. created and ambiguous both mint a
 * brand-new nfl_players row (ambiguous NEVER attaches to any existing
 * candidate id - the refuse-to-attach law is unchanged), matchedBy
 * distinguishing 'created' from 'created-ambiguous' so the season row can
 * carry the honest provenance. Dry run (apply=false) returns the same shape
 * with nflPlayerId null for created/ambiguous outcomes - no write happens.
 *
 * ONE NEW PLAYER PER AMBIGUOUS ROW, EVEN ACROSS SEASONS - see
 * scripts/footballdb-import.mjs's own comment on this for why reusing one
 * across seasons would be exactly the guess this module exists to refuse.
 *
 * @returns {{ outcome: 'exact'|'created'|'ambiguous', matchedBy: 'exact'|'created'|'created-ambiguous',
 *             nflPlayerId: number|null, position: string, candidateIds?: number[] }}
 */
export async function resolveAndPersistIdentity(sql, rawName, inferredPosition, candidateIndex, { apply = true } = {}) {
  const resolved = resolveIdentity(rawName, inferredPosition, candidateIndex);

  if (resolved.outcome === 'exact') {
    return { outcome: 'exact', matchedBy: 'exact', nflPlayerId: resolved.nflPlayerId, position: resolved.position };
  }

  if (resolved.outcome === 'created') {
    let nflPlayerId = null;
    if (apply) {
      nflPlayerId = await createPlayer(sql, rawName, inferredPosition);
      // Visible to LATER rows in this same season and to subsequent seasons
      // in the same run.
      const norm = normalizeName(rawName);
      if (!candidateIndex.has(norm)) candidateIndex.set(norm, []);
      candidateIndex.get(norm).push({ id: nflPlayerId, position: inferredPosition });
    }
    return { outcome: 'created', matchedBy: 'created', nflPlayerId, position: inferredPosition };
  }

  // ambiguous: a brand-new row, deliberately NOT added to candidateIndex -
  // it already collides with 2+ existing identities; feeding it back in
  // would make every LATER row with this same name even MORE ambiguous.
  let nflPlayerId = null;
  if (apply) nflPlayerId = await createPlayer(sql, rawName, inferredPosition);
  return {
    outcome: 'ambiguous', matchedBy: 'created-ambiguous', nflPlayerId,
    position: inferredPosition, candidateIds: resolved.candidateIds,
  };
}

// ---------------------------------------------------------------------------
// POSITION INFERENCE — footballdb carries NO position column, on any tab, in
// any year. The law itself now lives in lib/daily/inferPosition.js (largest
// scoring component wins, QB gated on 100+ pass attempts - a defect fix:
// this file's own OLD version picked QB off mere field presence, which read
// a running back's one trick-play pass as a starting quarterback). Re-
// exported here so every existing caller (scripts/footballdb-import.mjs)
// keeps importing it from this file, unchanged.
//
// THE HONEST LIMIT: Receiving-tab presence cannot distinguish WR from TE -
// footballdb gives no column that does, and the two positions have no house-
// scoring difference to infer it from either (both score rec/recYds/recTd
// identically under PPR). Every receiving-only row defaults to WR. This is a
// real imprecision, not a silent one: the ingest report counts how many
// CREATED identities landed in this bucket, because a matched (exact)
// identity overrides it with nfl_players' own position where one exists.
// ---------------------------------------------------------------------------
export { inferPosition };
