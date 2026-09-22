// lib/mlb/cardLines.js - the two lines the mock puts where the strip goes when
// the game is not live: the probables before first pitch, and the decision
// plus the bat of the night after the last out.
//
// PURE. Rows in, strings out, no DB and no I/O - the queries that find these
// rows live in lib/gridiron/scoresV2.js beside every other card query.
//
// WHY NOT statLineText(). That function is the football/soccer line and it
// reads pass_att and goals; a baseball final has neither, and a league branch
// inside it would be the third sport's vocabulary in a function that already
// carries two. The card asks the sport, once, and calls the right one.

import { outsToInnings } from './playsImport.js';

/**
 * "F. Valdez" from "Framber Valdez". A box score prints the surname and a card
 * has room for an initial, which is what the mock shows on every one of its
 * four cards.
 *
 * A ONE-WORD NAME IS LEFT WHOLE rather than turned into "I." - it happens
 * (Ichiro), and an initial with nothing after it names nobody.
 */
export function shortName(full) {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

/**
 * "T. Skubal vs L. Castillo", or null.
 *
 * NO HANDEDNESS. The mock writes "(L)" and "(R)"; StatsAPI's schedule hydrate
 * gives the probable's id and name and NOT the hand, and a second lookup per
 * pitcher per day to print one letter is not worth the call - nor is guessing
 * it. The letter returns when the hand does.
 *
 * TBA IS A REAL ANSWER and is printed. A named starter against an unnamed one
 * is more useful than nothing, and "TBA" is what every scoreboard in the sport
 * says on the second game of a doubleheader.
 */
export function probablesLine(probables) {
  if (!probables) return null;
  const a = shortName(probables.away?.name); const h = shortName(probables.home?.name);
  if (!a && !h) return null;
  return `${a ?? 'TBA'} vs ${h ?? 'TBA'}`;
}

/** The game's winning pitcher. A row with wins > 0, and there is exactly one. */
export function winningPitcher(rows = []) {
  return (rows ?? []).find((r) => Number(r?.wins) > 0) ?? null;
}

/**
 * W / L / SV - what the game page's At Bat module becomes once the game is
 * over. Each is absent when nobody has it, and a save genuinely is absent from
 * most games; a "SV —" would read as a missing value rather than as a fact.
 */
export function decisions(rows = []) {
  const one = (col) => (rows ?? []).find((r) => Number(r?.[col]) > 0) ?? null;
  return { win: one('wins'), loss: one('losses'), save: one('saves') };
}

/**
 * THE BAT OF THE NIGHT: total bases, then RBI, then hits, then the name so a
 * tie is stable rather than whatever order the rows arrived in.
 *
 * A HITLESS GAME IS NOT A BAT OF THE NIGHT. 0-4 tops the field in a game where
 * nobody reached, and printing it under a final would read as praise.
 */
export function batOfTheNight(rows = []) {
  const n = (v) => (v == null || v === '' ? 0 : Number(v) || 0);
  const hitters = (rows ?? []).filter((r) => n(r?.hits) > 0);
  if (!hitters.length) return null;
  return hitters.slice().sort((x, y) =>
    n(y.total_bases) - n(x.total_bases)
    || n(y.rbi) - n(x.rbi)
    || n(y.hits) - n(x.hits)
    || String(x.player_name ?? '').localeCompare(String(y.player_name ?? '')))[0];
}

/** "F. Valdez 7 IP · 9 K · 1 ER" */
export function pitcherLine(row) {
  if (!row) return null;
  const who = shortName(row.player_name);
  if (!who) return null;
  // "7 IP", NOT "7.0 IP" - the mock's own words. A box score column prints
  // 7.0 because it is a column of aligned thirds; a sentence on a card does
  // not, and outsToInnings is the column's formatter. The card drops a whole
  // inning's trailing .0 and keeps every third: 6.2 stays 6.2.
  const ip = outsToInnings(row.outs_recorded);
  const bits = [];
  if (ip) bits.push(`${ip.endsWith('.0') ? ip.slice(0, -2) : ip} IP`);
  // ZERO IS A NUMBER HERE. A shutout is 0 ER and it is the best line on the
  // card; Number(null) is also 0, which is why this asks whether the column
  // was sent before it believes the value - the fifth time in this build.
  const num = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  const k = num(row.strikeouts_pitched); if (k != null && k > 0) bits.push(`${k} K`);
  const er = num(row.earned_runs); if (er != null) bits.push(`${er} ER`);
  return bits.length ? `${who} ${bits.join(' · ')}` : who;
}

/** "Y. Álvarez 2-4 · HR · 3 RBI" */
export function batterLine(row) {
  if (!row) return null;
  const who = shortName(row.player_name);
  if (!who) return null;
  const num = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  const h = num(row.hits); const ab = num(row.at_bats);
  const bits = [];
  if (h != null && ab != null) bits.push(`${h}-${ab}`);
  const hr = num(row.home_runs);
  if (hr != null && hr > 0) bits.push(hr > 1 ? `${hr} HR` : 'HR');
  const rbi = num(row.rbi);
  if (rbi != null && rbi > 0) bits.push(`${rbi} RBI`);
  return bits.length ? `${who} ${bits.join(' · ')}` : who;
}

/**
 * THE FINAL'S FOOT: the decision and the bat, separated as the mock separates
 * them. Either half alone is a line; neither is null.
 */
export function decisionLine(rows = []) {
  const w = pitcherLine(winningPitcher(rows));
  const b = batterLine(batOfTheNight(rows));
  const bits = [w, b].filter(Boolean);
  return bits.length ? bits.join('  ·  ') : null;
}
