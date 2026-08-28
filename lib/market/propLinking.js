// lib/market/propLinking.js — vendor prop labels -> our player rows.
//
// READ-TIME, NOT STORED, by ruling. Odds rows are rewritten every tick, so a
// player_id stored on the row would be re-resolved four times a day per game
// and could sit stale between the insert and the resolve. Resolution is a pure
// function over two small inputs we already load for the page - 1,236 distinct
// labels against rosters of ~70 - so it is computed where it is used and cannot
// go out of date. If profiling ever demands a cache, the pre-agreed shape is a
// (team_id, normalized_label) -> player_id table with ambiguity stored as an
// explicit null; nothing here would have to change to add it.
//
// THE RESOLUTION SPACE IS THE EVENT'S TWO ROSTERS, AND THAT IS THE WHOLE
// SAFETY ARGUMENT. Surname matching across 30,969 players would be reckless;
// across the ~70 who could actually appear in this game it is close to exact.
// The constraint is not an optimisation, it is what makes the fallback legal.
//
// THREE LABEL SHAPES, measured on live rows:
//   "John McGinn"                 anytime markets - a bare name
//   "Mikkel Damsgaard Over"       O/U markets - name plus a side
//   "Carolina Panthers D/ST"      NOT A PERSON. 52 live NFL rows are a team
//                                 defense; they are excluded as a market-scope
//                                 class BEFORE matching and are not counted as
//                                 misses, because nothing was missed.
//
// WHY THE SURNAME FALLBACK EXISTS. Our EPL squads come from API-Sports, which
// stores "M. Gusto"; the odds vendor sends "Malo Gusto". Exact matching linked
// 7.7% of EPL rows. That is not a data gap, it is two vendors disagreeing about
// how to write a name - the same shape as the club-name mismatch that cost the
// EPL odds join half its events. normalizeName drops the period, so both sides
// share the surname "gusto", and the fallback lifts EPL to 86.8%.
//
// AN AMBIGUOUS SURNAME RESOLVES TO NOTHING. Two players on the same roster
// sharing a surname is the one case where a guess would be worse than an
// absence: a linked row grows a chart and a hit-rate line, and attaching that
// to the wrong brother is a confident lie. Twelve live EPL rows land here.

import { normalizeName } from '../gridiron/nameMatch.js';

export { normalizeName };

/** Marks a surname shared by two players on one roster - never resolvable. */
export const AMBIGUOUS = Symbol('ambiguous-surname');

const OU_SUFFIX = /\s+(over|under)$/i;
const TEAM_DEFENSE = /\bd\/st\b|\bdst\b|\bdefense\b/i;

/**
 * Is this label a market-scope class rather than a person? Checked on the RAW
 * label, before normalization strips the slash out of "D/ST".
 */
export function isTeamSelection(label) {
  return TEAM_DEFENSE.test(String(label ?? ''));
}

/**
 * The label with its Over/Under side removed. The side is a property of the
 * market row, not of the person, and leaving it on makes every O/U label miss.
 */
export function stripSide(label) {
  return String(label ?? '').replace(OU_SUFFIX, '').trim();
}

/** Vendor label -> the normalized name we match on. */
export function normalizeLabel(label) {
  return normalizeName(stripSide(label));
}

/** The last token of a normalized name, or '' when there is not one. */
export function surnameOf(normalized) {
  const parts = String(normalized ?? '').split(' ').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

/**
 * Index one event's two rosters for matching.
 *
 * Built ONCE PER EVENT and handed to every row of that event - the relay's
 * "rosters loaded once per page, not per row". A per-row roster query would be
 * 3,059 queries to render one board.
 */
export function buildRosterIndex(players) {
  const exact = new Map();
  const surname = new Map();
  for (const p of players ?? []) {
    const n = normalizeName(p.full_name);
    if (!n) continue;
    // First writer wins on an exact collision; an exact duplicate name inside
    // one roster is a data problem, not a matching one, and it is vanishingly
    // rarer than the surname case below.
    if (!exact.has(n)) exact.set(n, p.id);
    const s = surnameOf(n);
    if (!s) continue;
    if (!surname.has(s)) surname.set(s, p.id);
    else if (surname.get(s) !== p.id) surname.set(s, AMBIGUOUS);
  }
  return { exact, surname };
}

/**
 * Resolve one vendor label against one event's rosters.
 *
 * @returns { playerId, how } - how is 'exact' | 'surname', or null when the
 *          label does not resolve. `how` rides back so the measurement can say
 *          which rule carried a league rather than only that something did.
 */
export function resolveProp(label, indexes) {
  if (isTeamSelection(label)) return null;
  const n = normalizeLabel(label);
  if (!n) return null;
  const list = Array.isArray(indexes) ? indexes : [indexes];

  for (const ix of list) {
    const hit = ix?.exact?.get(n);
    if (hit != null) return { playerId: hit, how: 'exact' };
  }
  // Only when NO roster has an exact match. An exact hit on the away side must
  // never lose to a surname hit on the home side.
  const s = surnameOf(n);
  if (!s) return null;
  let found = null;
  for (const ix of list) {
    const hit = ix?.surname?.get(s);
    if (hit === AMBIGUOUS) return null;
    if (hit != null) {
      // The same surname on BOTH rosters is ambiguous across the event, even
      // though neither roster alone would say so.
      if (found != null && found !== hit) return null;
      found = hit;
    }
  }
  return found == null ? null : { playerId: found, how: 'surname' };
}

/**
 * BATCH ENTRY POINT. One roster load per EVENT, then a pure pass over the rows.
 *
 * @param rows  prop rows carrying { match_id, selection_label, home_team_id,
 *              away_team_id }
 * @returns Map of `${match_id}|${selection_label}` -> { playerId, how }
 */
export async function resolveProps(sql, rows) {
  const out = new Map();
  if (!rows?.length) return out;

  const teamIds = [...new Set(rows.flatMap((r) => [r.home_team_id, r.away_team_id]).filter((v) => v != null))];
  if (!teamIds.length) return out;

  // ONE QUERY for every roster the page touches, not one per event and
  // certainly not one per row.
  const players = await sql`
    SELECT id, full_name, current_team_id FROM players
     WHERE current_team_id = ANY(${teamIds})`;

  const byTeam = new Map();
  for (const p of players) {
    if (!byTeam.has(p.current_team_id)) byTeam.set(p.current_team_id, []);
    byTeam.get(p.current_team_id).push(p);
  }
  const indexByTeam = new Map();
  for (const [tid, list] of byTeam) indexByTeam.set(tid, buildRosterIndex(list));

  for (const r of rows) {
    const key = `${r.match_id}|${r.selection_label}`;
    if (out.has(key)) continue;
    const indexes = [indexByTeam.get(r.home_team_id), indexByTeam.get(r.away_team_id)].filter(Boolean);
    const hit = resolveProp(r.selection_label, indexes);
    if (hit) out.set(key, hit);
  }
  return out;
}
