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
//   ambiguous  two or more nfl_players rows share this normalized_name AND the
//              team-season context below cannot tell them apart. NEVER
//              ATTACHED, and (fri-11) NEVER MINTED: the row is SKIPPED and
//              reported by name, team and season. The old ruling minted a
//              brand-new player per ambiguous row ('created-ambiguous'); that
//              is what filled PROD with duplicates (the 17 Sep run's 106
//              unreferenced players, 197716-197821), which in turn made more
//              names ambiguous.
//
// TEAM-SEASON CONTEXT (fri-11). When a name has 2+ candidates, each one's
// career evidence (nfl_player_season_totals: season_year + team_key, from
// footballdb 1980-1999 and BDL 2002+, plus this run's own earlier seasons)
// decides:
//   1. team fit: a row for the SAME franchise within one season of this one
//      (franchiseOf() folds relocations: Oilers -> TEN, Raiders -> LV, ...).
//      Exactly one -> exact. Two or more -> ambiguous (real namesakes on one
//      team-year).
//   2. else era fit: any row within two seasons, any team (trades, free
//      agency). Exactly one -> exact. Two or more -> ambiguous.
//   3. else, every candidate has evidence and none is near this season: a
//      different player of the same name -> created. A candidate with NO
//      evidence at all could be anyone, so its name stays ambiguous.

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
 * Every player's career evidence: id -> [{ year, fr }] (fr = franchiseOf(team_key)).
 * ~25k small rows, one query per season's ingest.
 */
export async function loadEvidence(sql) {
  const rows = await sql`SELECT nfl_player_id, season_year, team_key FROM nfl_player_season_totals`;
  const ev = new Map();
  for (const r of rows) addEvidence(ev, r.nfl_player_id, r.season_year, r.team_key);
  return ev;
}

export function addEvidence(ev, id, year, teamKey) {
  if (id == null) return;
  if (!ev.has(id)) ev.set(id, []);
  ev.get(id).push({ year: Number(year), fr: franchiseOf(teamKey) });
}

// Old names and abbreviations -> today's franchise abbreviation. Comparison only;
// stored team_keys are never rewritten here.
const FRANCHISE = new Map(Object.entries({
  'san diego chargers': 'LAC', sd: 'LAC', 'los angeles chargers': 'LAC',
  'washington redskins': 'WAS', 'washington football team': 'WAS', 'washington commanders': 'WAS', wsh: 'WAS',
  'houston oilers': 'TEN', 'tennessee oilers': 'TEN', 'tennessee titans': 'TEN',
  'los angeles raiders': 'LV', 'oakland raiders': 'LV', 'las vegas raiders': 'LV', oak: 'LV',
  'st. louis cardinals': 'ARI', 'phoenix cardinals': 'ARI', 'arizona cardinals': 'ARI',
  'st. louis rams': 'LAR', 'los angeles rams': 'LAR', stl: 'LAR', la: 'LAR',
  'baltimore colts': 'IND', 'indianapolis colts': 'IND',
}));
export function franchiseOf(teamKey) {
  const k = String(teamKey ?? '').trim();
  return FRANCHISE.get(k.toLowerCase()) ?? k.toUpperCase();
}

/**
 * PURE. Pick among 2+ same-name candidates by team-season evidence (see header).
 * -> { outcome: 'exact', nflPlayerId, via: 'team'|'era' } | { outcome: 'ambiguous', fits } | { outcome: 'created' }
 */
export function resolveByContext(candidates, { year, team, evidence }) {
  const fr = franchiseOf(team);
  const evOf = (c) => evidence.get(c.id) ?? [];
  const teamFit = candidates.filter((c) => evOf(c).some((e) => e.fr === fr && Math.abs(e.year - year) <= 1));
  if (teamFit.length === 1) return { outcome: 'exact', nflPlayerId: teamFit[0].id, via: 'team' };
  if (teamFit.length > 1) return { outcome: 'ambiguous', fits: teamFit.map((c) => c.id) };
  const eraFit = candidates.filter((c) => evOf(c).some((e) => Math.abs(e.year - year) <= 2));
  if (eraFit.length === 1) return { outcome: 'exact', nflPlayerId: eraFit[0].id, via: 'era' };
  if (eraFit.length > 1) return { outcome: 'ambiguous', fits: eraFit.map((c) => c.id) };
  if (candidates.some((c) => evOf(c).length === 0)) return { outcome: 'ambiguous', fits: [] };
  return { outcome: 'created' };
}

/**
 * Resolve one footballdb row's identity. `context` ({ year, team, evidence })
 * breaks a same-name tie; without it a tie is ambiguous, as before.
 * @returns {{ outcome: 'exact'|'created'|'ambiguous', nflPlayerId: number|null, position: string, candidateIds?: number[] }}
 */
export function resolveIdentity(rawName, inferredPosition, candidateIndex, context = null) {
  const norm = normalizeName(rawName);
  const candidates = candidateIndex.get(norm) ?? [];
  if (candidates.length === 1) {
    return { outcome: 'exact', nflPlayerId: candidates[0].id, position: candidates[0].position ?? inferredPosition };
  }
  if (candidates.length > 1) {
    const ctx = context ? resolveByContext(candidates, context) : { outcome: 'ambiguous' };
    if (ctx.outcome === 'exact') {
      const c = candidates.find((x) => x.id === ctx.nflPlayerId);
      return { outcome: 'exact', via: ctx.via, nflPlayerId: c.id, position: c.position ?? inferredPosition, candidateIds: candidates.map((x) => x.id) };
    }
    if (ctx.outcome === 'ambiguous') {
      return { outcome: 'ambiguous', nflPlayerId: null, position: inferredPosition, candidateIds: candidates.map((c) => c.id) };
    }
    // ctx 'created': every candidate is a namesake from another era - falls through to a new player.
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
 * resolveIdentity() PLUS the write it implies. exact reuses the matched id and
 * writes nothing new. created mints one nfl_players row (bdl_player_id NULL)
 * and adds it to candidateIndex so later rows and seasons in the run see it.
 * ambiguous writes NOTHING (fri-11): no player, and the caller skips the row
 * and reports it - minting one per ambiguous row is what made the duplicates.
 * Dry run (apply=false) returns the same shape, nflPlayerId null for created.
 *
 * @returns {{ outcome: 'exact'|'created'|'ambiguous', matchedBy: 'exact'|'created'|null,
 *             nflPlayerId: number|null, position: string, via?: string, candidateIds?: number[] }}
 */
export async function resolveAndPersistIdentity(sql, rawName, inferredPosition, candidateIndex, { apply = true, context = null } = {}) {
  const resolved = resolveIdentity(rawName, inferredPosition, candidateIndex, context);

  if (resolved.outcome === 'exact') {
    return { outcome: 'exact', matchedBy: 'exact', nflPlayerId: resolved.nflPlayerId, position: resolved.position, via: resolved.via, candidateIds: resolved.candidateIds };
  }

  if (resolved.outcome === 'created') {
    let nflPlayerId = null;
    if (apply) {
      nflPlayerId = await createPlayer(sql, rawName, inferredPosition);
      const norm = normalizeName(rawName);
      if (!candidateIndex.has(norm)) candidateIndex.set(norm, []);
      candidateIndex.get(norm).push({ id: nflPlayerId, position: inferredPosition });
    }
    return { outcome: 'created', matchedBy: 'created', nflPlayerId, position: inferredPosition };
  }

  return { outcome: 'ambiguous', matchedBy: null, nflPlayerId: null, position: inferredPosition, candidateIds: resolved.candidateIds };
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
