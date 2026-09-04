// lib/footballdb/parse.js — footballdb tabs -> one row per (player, team).
//
// ONE PARSER FOR ALL TWENTY YEARS (ruled). The header census found the nine
// tabs and every column name byte-identical across 1980-1999, so this file
// contains no season branch of any kind - every rule below reacts to what a
// CELL says, never to what year it is.
//
// SCOPED TO THE FIVE TABS THAT FEED THE HOUSE SCORER. Passing, Rushing,
// Receiving, Kicking, Defense carry every field lib/fantasy/scoring.js's
// fantasyPoints() reads (passYds/Td/int, rushYds/Td, recYds/Td/rec, fgm, xp,
// sacks, defInt, defTd). Scoring, Punting, Kickoff Returns and Punt Returns
// are NOT read: Scoring restates TDs the category tabs already carry (Rush
// TD, Rec TD) plus fields with no house column (Saf, 2pt, block/return TDs);
// the three return/punt tabs score nothing at all under this house's PPR
// formula - it has no return-TD or punting term. Reading them would be
// parsing data this ingest can never use.
//
// '--' IS THE SOURCE'S OWN "NOT TRACKED" MARKER, NOT A ZERO. Detected per
// cell: whenever footballdb writes '--', this parser writes NULL, wherever
// and whenever it appears - the 1980-1981 Defense Sack/SkYd gap is this rule
// firing on real data, not a rule ABOUT 1980-1981. SkYd itself is dropped
// regardless: nfl_player_game_stats has no sack-yardage column, so footballdb's
// SkYd (real from 1994, per the census) has no home in the house schema and is
// never parsed here.
//
// RetTD (Punting tab) and FC (Kickoff Returns tab) ARE NOT PARSED, PERIOD -
// not because of any per-season rule, but because neither tab is read at all
// (see above). Naming them here is the record of why, since the two are the
// canonical examples of a column with no honest content: RetTD reads dead
// across the full 1980-1999 census, and FC on a KICKOFF return is a
// structural artifact of the shared 10-column return-tab template (Fair Catch
// only means something on a PUNT return) rather than a real count of
// anything. If Punting or Kickoff Returns are ever read for some other
// purpose, both stay excluded there too.

const num = (v) => {
  if (v == null || v === '--') return null;
  const n = Number(String(v).replace(/t$/, '')); // "99t" (TD-ending long play) -> 99
  return Number.isFinite(n) ? n : null;
};

/** "39/39" -> { made: 39, att: 39 }; null-safe. */
function frac(v) {
  if (v == null || v === '--') return { made: null, att: null };
  const m = String(v).match(/^(\d+)\/(\d+)$/);
  if (!m) return { made: null, att: null };
  return { made: Number(m[1]), att: Number(m[2]) };
}

function indexHeaders(headers) {
  const idx = {};
  headers.forEach((h, i) => { if (h != null) idx[h] = i; });
  return idx;
}

/** rows -> [{ rawName, team, ...fields }], one per row, for one tab. */
function tabRecords(tab, fieldMap) {
  if (!tab) return [];
  const idx = indexHeaders(tab.headers);
  const get = (row, key) => (idx[key] != null ? row[idx[key]] : null);
  return tab.rows.map((row) => {
    const rec = { rawName: get(row, 'Player'), team: get(row, 'Team') };
    for (const [outKey, sourceKey] of Object.entries(fieldMap)) rec[outKey] = get(row, sourceKey);
    return rec;
  }).filter((r) => r.rawName && r.team);
}

/**
 * A workbook (as returned by xlsxReader.readWorkbook) -> season rows, one per
 * (rawName, team). Traded players are NOT merged across teams - footballdb's
 * own per-team split IS the row key here, same as the source.
 */
export function toSeasonRows(workbook) {
  const passing = tabRecords(workbook.Passing, {
    passAtt: 'Att', passCmp: 'Cmp', passYds: 'Yds', passTd: 'TD', passInt: 'Int',
  });
  const rushing = tabRecords(workbook.Rushing, {
    games: 'Gms', rushAtt: 'Att', rushYds: 'Yds', rushTd: 'TD', rushLg: 'Lg',
  });
  const receiving = tabRecords(workbook.Receiving, {
    games: 'Gms', rec: 'Rec', recYds: 'Yds', recTd: 'TD', recLg: 'Lg',
  });
  const kicking = tabRecords(workbook.Kicking, { pat: 'PAT', fg: 'FG', fgLong: 'Lg' });
  const defense = tabRecords(workbook.Defense, { defInt: 'Int', defTd: 'TD', sacks: 'Sack' });

  // Merge by (rawName, team) — the exact key footballdb's own per-team split
  // uses, so a passing/rushing dual-threat (or a two-way player) collapses
  // into one row and a traded player still gets two.
  const byKey = new Map();
  const get = (rawName, team) => {
    const k = `${rawName} ${team}`;
    if (!byKey.has(k)) byKey.set(k, { rawName, team });
    return byKey.get(k);
  };

  for (const r of passing) {
    const row = get(r.rawName, r.team);
    row.passAtt = num(r.passAtt); row.passCmp = num(r.passCmp);
    row.passYds = num(r.passYds); row.passTd = num(r.passTd); row.passInt = num(r.passInt);
  }
  for (const r of rushing) {
    const row = get(r.rawName, r.team);
    row.rushAtt = num(r.rushAtt); row.rushYds = num(r.rushYds); row.rushTd = num(r.rushTd);
    // MAX, THE SAME TRAILING-'t' RULE AS EVERY OTHER Lg COLUMN: num() already
    // strips it ("55t" -> 55, the long play that went for a score). A season's
    // Rushing tab has exactly one row per (player, team), so there is nothing
    // to take a max OVER here - this IS the season's long, stored as given.
    row.rushLong = num(r.rushLg);
    // GAMES: keep the first non-null category value seen (Rushing before
    // Receiving, the tab order footballdb itself uses). If a later category
    // disagrees, that disagreement is recorded, not resolved — the same
    // discipline the James Stewart 14+4=18 anomaly got: report, do not
    // silently reconcile a games count the source itself may not intend as
    // one number.
    const g = num(r.games);
    if (g != null && row.games == null) row.games = g;
    else if (g != null && row.games != null && row.games !== g) row.gamesConflict = [row.games, g];
  }
  for (const r of receiving) {
    const row = get(r.rawName, r.team);
    row.rec = num(r.rec); row.recYds = num(r.recYds); row.recTd = num(r.recTd);
    row.recLong = num(r.recLg); // same rule as rushLong, above
    const g = num(r.games);
    if (g != null && row.games == null) row.games = g;
    else if (g != null && row.games != null && row.games !== g) row.gamesConflict = [row.games, g];
  }
  for (const r of kicking) {
    const row = get(r.rawName, r.team);
    const pat = frac(r.pat); const fg = frac(r.fg);
    row.xp = pat.made; row.fga = fg.att; row.fgm = fg.made; row.fgLong = num(r.fgLong);
  }
  for (const r of defense) {
    const row = get(r.rawName, r.team);
    row.defInt = num(r.defInt); row.defTd = num(r.defTd); row.sacks = num(r.sacks);
  }

  return [...byKey.values()];
}

/** The About tab's "Teams covered: N." line -> N, or null if the line is missing/unparsable. */
export function teamCountFromAbout(aboutLines) {
  for (const line of aboutLines) {
    const m = line.match(/Teams covered:\s*(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
}
