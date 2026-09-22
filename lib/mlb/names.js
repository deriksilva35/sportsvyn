// lib/mlb/names.js - the bridge between two providers that share no player id.
//
// THERE IS NO ID IN COMMON AND THIS WAS MEASURED, NOT ASSUMED. A BDL player
// object carries id, first_name, last_name, full_name, debut_year, jersey,
// college, position, active, birth_place, dob, age, height, weight, draft,
// bats_throws, team - and nothing that is an MLBAM id. statsapi speaks MLBAM
// ids only (Nick Martinez is 607259 there and 626 in BDL). So a posted lineup
// or a probable starter from statsapi can only be matched to the pool - whose
// rows are BDL players, because mlb_player_game_stats.bdl_player_id is what
// the scorer settles against - BY NAME.
//
// THE EXISTING PROBABLE FLAG COULD NEVER LIGHT, and this is what found it:
// lib/october/pool.js compared String(p.id) === String(probableId), a BDL id
// against an MLBAM id, so `probable` was false on every row of every game ever
// built. The arm the card exists to offer first was sorted like any other arm.
//
// EXACT NAMES MATCH HALF THE TIME. The 18 posted starters of 2026-09-22's
// TB @ NYY against those two clubs' BDL rosters: NINE hit, NINE missed.
//
//   Yandy Díaz / Luis García Jr. / José Caballero / Ali Sánchez
//     -> accents. BDL carries no accented character on either roster; every
//        name is folded to ASCII at its end.
//   Liam Hicks / Chandler Simpson / Ben Rice / George Lombard Jr. /
//   Spencer Jones
//     -> NOT a name problem at all: they are on PAGE TWO of BDL's player list
//        for their club, and the pool's fetchRoster read one page of 100. See
//        lib/october/pool.js.
//
// After folding, 13 of 18; after paging as well, 18 of 18.
//
// WHAT THIS DELIBERATELY DOES NOT DO is fuzzy matching. No initials, no
// Levenshtein, no "last name plus club" fallback. A name that does not match
// after folding is a MISS that shows up as an unstarred row, which is a thin
// card; a near-match that resolves to the wrong player puts another man's
// batting order on a reader's slot and scores him.

/**
 * A name folded to its comparable form: diacritics stripped, case dropped,
 * periods/apostrophes/hyphens removed, whitespace collapsed.
 *
 * SUFFIXES STAY. "George Lombard Jr." and "George Lombard" are different
 * players often enough in baseball - a father and a son both reach the majors -
 * that dropping "Jr." to gain a match would be inventing one.
 */
export function normName(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'`’]/g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Map(normName -> the row), first spelling wins. PURE. */
export function byName(rows = [], key = 'full_name') {
  const out = new Map();
  for (const r of rows) {
    const n = normName(typeof key === 'function' ? key(r) : r?.[key]);
    if (n && !out.has(n)) out.set(n, r);
  }
  return out;
}

/**
 * Does this pool row name the same player as that provider entry? Ids FIRST,
 * because a caller that does hold a shared id should not lose to a spelling -
 * and names only when the ids are from different spaces, which is the normal
 * case here.
 */
export function samePlayer(poolRow, other) {
  if (!poolRow || !other) return false;
  if (poolRow.playerId != null && other.id != null && String(poolRow.playerId) === String(other.id)) return true;
  const a = normName(poolRow.name ?? poolRow.full_name);
  const b = normName(other.name ?? other.full_name);
  return Boolean(a) && a === b;
}
