// lib/cfb/seasonStats.js - CFBD season stats, long payload to wide row.
//
// THE PAYLOAD IS LONG AND THE TABLE IS WIDE. CFBD returns one object per
// (player, category, statType) - 139,136 of them for a season - so a single
// player is spread across a dozen rows. Pivoting at IMPORT rather than at read
// keeps the render dumb: the page selects a row and prints columns, exactly as
// the NFL side does over its already-wide table.
//
// EVERY KEY BELOW WAS READ OFF THE LIVE PAYLOAD, NOT GUESSED. The A relay's
// lesson was that a mock can ask for a column the database has never held; the
// same applies to a provider. Enumerated from /stats/player/season?year=2025
// &team=Georgia (673 rows):
//
//   defensive      PD, QB HUR, SACKS, SOLO, TD, TFL, TOT
//   fumbles        FUM, LOST, REC
//   interceptions  AVG, INT, TD, YDS
//   kickReturns    AVG, LONG, NO, TD, YDS
//   kicking        FGA, FGM, LONG, PCT, PTS, XPA, XPM
//   passing        ATT, COMPLETIONS, INT, PCT, TD, YDS, YPA
//   puntReturns    AVG, LONG, NO, TD, YDS
//   punting        In 20, LONG, NO, TB, YDS, YPP
//   receiving      LONG, REC, TD, YDS, YPR
//   rushing        CAR, LONG, TD, YDS, YPC
//
// TWO THINGS THAT WOULD HAVE BEEN WRONG BY ASSUMPTION:
//
//   1. A DEFENDER'S INTERCEPTIONS ARE NOT IN `defensive`. The category carries
//      PD/QB HUR/SACKS/SOLO/TD/TFL/TOT and no INT at all - picks live in their
//      own `interceptions` category. Mapping the mock's defensive INT column to
//      defensive.INT would have silently produced an all-null column.
//   2. The provider's names are not ours. Completions is COMPLETIONS, carries
//      are CAR, and "In 20" has a space in it.
//
// AND ONE THING THE PAYLOAD DOES NOT CARRY: games played. There is no GP
// statType in any category, so the wide row has no games column and the render
// must not claim one.
//
// DERIVED RATIOS ARE NOT STORED. PCT, AVG, YPA, YPC, YPR, YPP are all functions
// of columns we do store; keeping a second copy invites the two to disagree
// after a correction. Computed at read if ever needed.

import { sql } from '../db.js';

/**
 * The wide columns: [column, category, statType].
 * Order here is the column order in migration 077.
 */
export const WIDE_COLUMNS = Object.freeze([
  ['pass_att',      'passing',       'ATT'],
  ['pass_cmp',      'passing',       'COMPLETIONS'],
  ['pass_yds',      'passing',       'YDS'],
  ['pass_td',       'passing',       'TD'],
  ['pass_int',      'passing',       'INT'],

  ['rush_car',      'rushing',       'CAR'],
  ['rush_yds',      'rushing',       'YDS'],
  ['rush_td',       'rushing',       'TD'],
  ['rush_long',     'rushing',       'LONG'],

  ['rec',           'receiving',     'REC'],
  ['rec_yds',       'receiving',     'YDS'],
  ['rec_td',        'receiving',     'TD'],
  ['rec_long',      'receiving',     'LONG'],

  ['tackles_tot',   'defensive',     'TOT'],
  ['tackles_solo',  'defensive',     'SOLO'],
  ['tfl',           'defensive',     'TFL'],
  ['sacks',         'defensive',     'SACKS'],
  ['qb_hur',        'defensive',     'QB HUR'],
  ['pass_def',      'defensive',     'PD'],
  ['def_td',        'defensive',     'TD'],

  // Picks are their own category - see the note above.
  ['def_int',       'interceptions', 'INT'],
  ['int_yds',       'interceptions', 'YDS'],
  ['int_td',        'interceptions', 'TD'],

  ['fum',           'fumbles',       'FUM'],
  ['fum_lost',      'fumbles',       'LOST'],
  ['fum_rec',       'fumbles',       'REC'],

  ['fgm',           'kicking',       'FGM'],
  ['fga',           'kicking',       'FGA'],
  ['fg_long',       'kicking',       'LONG'],
  ['kick_pts',      'kicking',       'PTS'],
  ['xpm',           'kicking',       'XPM'],
  ['xpa',           'kicking',       'XPA'],

  ['punts',         'punting',       'NO'],
  ['punt_yds',      'punting',       'YDS'],
  ['punt_long',     'punting',       'LONG'],
  ['punt_in20',     'punting',       'In 20'],
  ['punt_tb',       'punting',       'TB'],

  ['kr',            'kickReturns',   'NO'],
  ['kr_yds',        'kickReturns',   'YDS'],
  ['kr_td',         'kickReturns',   'TD'],
  ['kr_long',       'kickReturns',   'LONG'],

  ['pr',            'puntReturns',   'NO'],
  ['pr_yds',        'puntReturns',   'YDS'],
  ['pr_td',         'puntReturns',   'TD'],
  ['pr_long',       'puntReturns',   'LONG'],
]);

export const WIDE_COLUMN_NAMES = Object.freeze(WIDE_COLUMNS.map(([c]) => c));

// Columns that can legitimately be a half. CFB tracks half-tackles: a shared
// stop is 0.5 to each defender, so TFL and SACKS are genuinely fractional and
// TOT/SOLO can be too. Everything else is a whole count.
export const DECIMAL_COLUMNS = Object.freeze(
  new Set(['tackles_tot', 'tackles_solo', 'tfl', 'sacks']),
);

const KEY = new Map(WIDE_COLUMNS.map(([col, cat, st]) => [`${cat}|${st}`, col]));

/** "12.5" -> 12.5, "1,014" -> 1014, junk -> null. Never NaN into the table. */
export function toNumber(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/,/g, '').trim();
  if (s === '' || s === '-' || s === '--') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pivot the long payload into one wide object per (playerId, season).
 *
 * UNKNOWN (category, statType) PAIRS ARE COUNTED, NOT DROPPED SILENTLY. A
 * provider adding a stat type is exactly the kind of change that should be
 * visible in a run summary rather than discovered a season later - the same
 * posture noteUnmapped() takes for drive results and positions.
 */
export function pivotSeasonRows(rows) {
  const byPlayer = new Map();
  const unmapped = new Map();
  for (const r of rows ?? []) {
    const pid = r?.playerId == null ? null : String(r.playerId);
    if (!pid) continue;
    const k = `${pid}|${r.season}`;
    if (!byPlayer.has(k)) {
      byPlayer.set(k, {
        providerPlayerId: pid,
        season: Number(r.season),
        player: r.player ?? null,
        position: r.position ?? null,
        team: r.team ?? null,
        conference: r.conference ?? null,
        stats: {},
      });
    }
    const col = KEY.get(`${r.category}|${r.statType}`);
    if (!col) {
      const tag = `${r.category}|${r.statType}`;
      unmapped.set(tag, (unmapped.get(tag) ?? 0) + 1);
      continue;
    }
    const v = toNumber(r.stat);
    if (v != null) byPlayer.get(k).stats[col] = v;
  }
  return { rows: [...byPlayer.values()], unmapped };
}

// ------------------------------------------------------------------ render

/**
 * The CFB column vocabulary, position-group aware.
 *
 * THIS IS WHERE THE CODES DIVERGE, and it is a data fact rather than a design
 * one. NFL defense renders Sacks/INT/FR/TD because nfl_player_game_stats has no
 * tackles column and never has. CFBD DOES carry tackles and TFL, so CFB defense
 * renders the mock's Tkl/TFL/Sacks/INT. Same table grammar, different columns,
 * because the two providers know different things.
 */
export const CFB_COLUMN_SETS = Object.freeze({
  passing: [
    { key: 'pass_cmp', label: 'Cmp' }, { key: 'pass_att', label: 'Att' },
    { key: 'pass_yds', label: 'Yds' }, { key: 'pass_td', label: 'TD' },
    { key: 'pass_int', label: 'INT' },
  ],
  rushing: [
    { key: 'rush_car', label: 'Car' }, { key: 'rush_yds', label: 'Yds' },
    { key: 'rush_td', label: 'TD' }, { key: 'rec', label: 'Rec' },
    { key: 'rec_yds', label: 'Rec Yds' },
  ],
  receiving: [
    { key: 'rec', label: 'Rec' }, { key: 'rec_yds', label: 'Yds' },
    { key: 'rec_td', label: 'TD' }, { key: 'rec_long', label: 'Long', agg: 'max' },
  ],
  kicking: [
    { key: 'fgm', label: 'FGM' }, { key: 'fga', label: 'FGA' },
    { key: 'fg_long', label: 'Long', agg: 'max' }, { key: 'xpm', label: 'XP' },
  ],
  defense: [
    { key: 'tackles_tot', label: 'Tkl', dec: true },
    { key: 'tfl', label: 'TFL', dec: true },
    { key: 'sacks', label: 'Sacks', dec: true },
    { key: 'def_int', label: 'INT' },
  ],
});

const BY_POSITION = {
  QB: 'passing',
  RB: 'rushing', FB: 'rushing', HB: 'rushing', TB: 'rushing',
  WR: 'receiving', TE: 'receiving',
  K: 'kicking', PK: 'kicking',
};

/** Same contract as the NFL side: null means render no stat table at all. */
export function cfbColumnsFor(position, positionGroup) {
  const pos = String(position ?? '').toUpperCase().trim();
  if (BY_POSITION[pos]) return CFB_COLUMN_SETS[BY_POSITION[pos]];
  if (positionGroup === 'DEF') return CFB_COLUMN_SETS.defense;
  return null;
}

export function cfbColumnSetName(columns) {
  for (const [name, set] of Object.entries(CFB_COLUMN_SETS)) if (set === columns) return name;
  return null;
}

// ------------------------------------------------------------------ read

/**
 * A CFB player's season rows, newest first.
 *
 * Only the columns the render asked for, so a defender's query does not haul
 * back forty null kicking columns. Returns [] for a player with no rows, which
 * is the same shape the NFL reader returns and lands on the same empty line.
 */
export async function cfbSeasonTotals(playerId, columns) {
  if (playerId == null || !columns?.length) return [];
  const keys = columns.map((c) => c.key);
  const rows = await sql.query(
    `SELECT season, ${keys.join(', ')}
       FROM cfb_player_season_stats
      WHERE player_id = $1
      ORDER BY season DESC`,
    [Number(playerId)],
  );
  // NUMERIC comes back from pg as a string; the render's formatter expects a
  // number and Number('57.0') is 57, so this is the one place to do it.
  return rows.map((r) => {
    const out = { season: r.season };
    for (const k of keys) out[k] = r[k] == null ? null : Number(r[k]);
    return out;
  });
}
