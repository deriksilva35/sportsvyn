// lib/fantasy/dstName.js - HOW A TEAM DEFENSE IS NAMED. The one derivation.
//
// The provider name field is not a name for a defense. FFC writes "Seattle
// Defense"; the Fantrax ADP feed writes whatever its team row carried that day
// - "Team", "Team Offense", "Defense/Special Teams", "Team Defense" - and on
// 2 Sep 2026 all 32 of those rendered as the display name in the pick list
// while the row's own sub-line knew DST·HOU. So for a defense the name is
// DERIVED FROM THE TEAM, via the teams table, in one grammar:
//
//     <club name> D/ST        Houston Texans D/ST
//
// and the provider field is never read for one. Every DTO the flow-core hands
// a room (pool row, pick, keeper, undo) passes through displayName(), so the
// pick list, queue, roster, board cell, results and tracker all carry the
// derived name and none of them decides for itself. Non-defense rows are the
// provider's name, verbatim.
//
// The short forms (board cell, tracker ledger) derive from the full name by
// its grammar, because the client has no club table: the nickname is the last
// word before the suffix - "Texans", and "Commanders" for Washington.

import { TEAM_ABBR_ALIAS } from '../gridiron/nameMatch.js';

export const DST_SUFFIX = 'D/ST';

// The pool spells a team defense 'DEF' (FFC vocabulary; the Fantrax import maps
// DST -> DEF). Roster slots spell it 'DST'. Both are a defense.
export function isTeamDefense(position) {
  return position === 'DEF' || position === 'DST';
}

// `clubs` is Map<teams.abbreviation, teams.name> for the NFL (32 rows). The pool
// carries FFC codes (WAS), the teams table carries BDL codes (WSH); the alias
// table is the matcher's own, so the name and the stats join agree on the club.
// A code the table cannot place still never falls back to the provider field -
// it renders as the code itself ("XXX D/ST"), which is at least true.
export function dstDisplayName(team, clubs) {
  const code = team == null ? null : String(team).toUpperCase();
  const abbr = code == null ? null : (TEAM_ABBR_ALIAS[code] ?? code);
  const club = abbr == null ? null : clubs?.get(abbr) ?? null;
  return `${club ?? abbr ?? '?'} ${DST_SUFFIX}`;
}

// The display name for any pool/pick row: the club's for a defense, the
// provider's for everyone else.
export function displayName(row, clubs) {
  return isTeamDefense(row?.position) ? dstDisplayName(row?.team, clubs) : (row?.name ?? null);
}

export function isDstName(name) {
  return typeof name === 'string' && name.endsWith(` ${DST_SUFFIX}`);
}

// "Houston Texans D/ST" -> "Texans". The board cell already labels the row DST.
export function dstNickname(name) {
  if (!isDstName(name)) return null;
  const words = name.slice(0, -(DST_SUFFIX.length + 1)).trim().split(/\s+/);
  return words[words.length - 1] || null;
}

// "Houston Texans D/ST" -> "Texans D/ST", for surfaces that shorten a person's
// name to "J. Chase" - an initial makes no sense on a club.
export function dstShortName(name) {
  const nick = dstNickname(name);
  return nick ? `${nick} ${DST_SUFFIX}` : null;
}
