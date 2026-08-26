// lib/cfb/gameStats.js - CFBD game box scores, nested payload to wide row.
//
// THE GAME ENDPOINT DOES NOT SPEAK THE SEASON ENDPOINT'S LANGUAGE, and reusing
// C's mapping verbatim would have produced a table of nulls. Enumerated from
// /games/players?year=2025&week=1 (191 games) and diffed against the season
// vocabulary:
//
//   passing   season: ATT, COMPLETIONS, INT, PCT, TD, YDS, YPA
//             game:   AVG, C/ATT, INT, QBR, TD, YDS
//   kicking   season: FGA, FGM, LONG, PCT, PTS, XPA, XPM
//             game:   FG, LONG, PCT, PTS, XP
//
// So two of the game endpoint's types are PAIRS IN ONE STRING - "21/31" for
// completions-attempts, "2/3" for field goals - where the season endpoint sends
// each half as its own row. They are split here into the same two columns the
// season table already uses, so one column means one thing across both tables.
// Everything else lines up with C's vocabulary as verified.
//
// The payload is four levels deep - game -> teams -> categories -> types ->
// athletes - and the athlete carries no season, so the season comes from the
// query. The game carries CFBD's own id, which every one of our 934 CFB 2025
// matches already stores as external_ids->>'cfbd_game_id': the join is free,
// exactly as the roster ids were.

import { sql } from '../db.js';

/** [column, category, typeName] for the plain one-value types. */
export const GAME_COLUMNS = Object.freeze([
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

  ['def_int',       'interceptions', 'INT'],
  ['int_yds',       'interceptions', 'YDS'],
  ['int_td',        'interceptions', 'TD'],

  ['fum',           'fumbles',       'FUM'],
  ['fum_lost',      'fumbles',       'LOST'],
  ['fum_rec',       'fumbles',       'REC'],

  ['fg_long',       'kicking',       'LONG'],
  ['kick_pts',      'kicking',       'PTS'],

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

/**
 * The made/attempted pairs. "21/31" -> two columns, in this order.
 * A blank half stays null rather than becoming zero.
 */
export const PAIR_COLUMNS = Object.freeze([
  ['passing', 'C/ATT', ['pass_cmp', 'pass_att']],
  ['kicking', 'FG',    ['fgm', 'fga']],
  ['kicking', 'XP',    ['xpm', 'xpa']],
]);

export const GAME_COLUMN_NAMES = Object.freeze([
  ...GAME_COLUMNS.map(([c]) => c),
  ...PAIR_COLUMNS.flatMap(([, , cols]) => cols),
]);

export const DECIMAL_COLUMNS = Object.freeze(
  new Set(['tackles_tot', 'tackles_solo', 'tfl', 'sacks']),
);

// Types deliberately not stored: derived, or not a counting stat.
const IGNORED = new Set(['passing|AVG', 'passing|QBR', 'rushing|AVG', 'receiving|AVG',
  'kicking|PCT', 'punting|AVG', 'kickReturns|AVG', 'puntReturns|AVG']);

const KEY = new Map(GAME_COLUMNS.map(([col, cat, ty]) => [`${cat}|${ty}`, col]));
const PAIR = new Map(PAIR_COLUMNS.map(([cat, ty, cols]) => [`${cat}|${ty}`, cols]));

export function toNumber(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/,/g, '').trim();
  if (s === '' || s === '-' || s === '--') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "21/31" -> [21, 31]. Anything else -> [null, null]. */
export function splitPair(raw) {
  const s = String(raw ?? '').trim();
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
  return m ? [Number(m[1]), Number(m[2])] : [null, null];
}

/**
 * Flatten one week's payload into wide rows, one per (game, athlete).
 *
 * Unknown (category, type) pairs are COUNTED, not dropped silently - a provider
 * adding a type should be visible in a run summary, not discovered a season on.
 */
export function pivotWeek(games, { season, week, seasonPhase = 'REG' } = {}) {
  const out = new Map();
  const unmapped = new Map();
  for (const g of games ?? []) {
    const gameId = g?.id == null ? null : String(g.id);
    if (!gameId) continue;
    for (const t of g.teams ?? []) {
      for (const c of t.categories ?? []) {
        for (const ty of c.types ?? []) {
          const tag = `${c.name}|${ty.name}`;
          const col = KEY.get(tag);
          const pair = PAIR.get(tag);
          if (!col && !pair && !IGNORED.has(tag)) {
            unmapped.set(tag, (unmapped.get(tag) ?? 0) + (ty.athletes?.length ?? 0));
          }
          if (!col && !pair) continue;
          for (const a of ty.athletes ?? []) {
            const pid = a?.id == null ? null : String(a.id);
            if (!pid) continue;
            const k = `${gameId}|${pid}`;
            if (!out.has(k)) {
              out.set(k, {
                providerGameId: gameId, providerPlayerId: pid,
                player: a.name ?? null, team: t.team ?? null,
                season, week, seasonPhase, stats: {},
              });
            }
            const row = out.get(k).stats;
            if (pair) {
              const [made, att] = splitPair(a.stat);
              if (made != null) row[pair[0]] = made;
              if (att != null) row[pair[1]] = att;
            } else {
              const v = toNumber(a.stat);
              if (v != null) row[col] = v;
            }
          }
        }
      }
    }
  }
  return { rows: [...out.values()], unmapped };
}

// ------------------------------------------------------------------ read

/**
 * A CFB player's recent games, newest first. Shaped like the NFL game log so
 * the same component renders both.
 */
export async function cfbGameLog(playerId, columns, { limit = 4 } = {}) {
  if (playerId == null || !columns?.length) return [];
  const keys = columns.map((c) => c.key);
  const rows = await sql.query(
    `SELECT g.season, g.week, g.opponent, g.result, ${keys.map((k) => `g.${k}`).join(', ')}
       FROM cfb_player_game_stats g
      WHERE g.player_id = $1
      ORDER BY g.season DESC, g.week DESC
      LIMIT $2`,
    [Number(playerId), Number(limit)],
  );
  return rows.map((r) => {
    const out = { season: r.season, week: r.week, opponent: r.opponent, result: r.result };
    for (const k of keys) out[k] = r[k] == null ? null : Number(r[k]);
    return out;
  });
}
