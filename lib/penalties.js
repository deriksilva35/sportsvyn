// lib/penalties.js — shared penalty-shootout DISPLAY helper.
//
// penSuffix() returns the "(4-3 pens)" qualifier for a shootout-decided match,
// or "" when it doesn't apply. Display-only: it reads the already-captured
// home_penalties/away_penalties + the regulation score; it never decides a
// winner (the bracket resolver owns that). Used by BOTH the bracket cell and
// the match-page scoreline so the two surfaces are textually identical.
//
// Shown ONLY when the result was level in regulation (home === away) AND both
// shootout tallies are present — the same condition the bracket uses to decide
// on penalties. Otherwise "" (a non-level final, or partial/missing pen data,
// renders nothing — never "(null)" / "(undefined)"). Hyphen, never an em dash.

export function penSuffix(homeScore, awayScore, homePens, awayPens) {
  if (homePens == null || awayPens == null) return '';
  if (homeScore == null || awayScore == null) return '';
  if (homeScore !== awayScore) return ''; // only on a level regulation result
  return `(${homePens}-${awayPens} pens)`;
}
