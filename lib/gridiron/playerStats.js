// lib/gridiron/playerStats.js - a gridiron player's numbers.
//
// TOTALS ARE A READ, NOT A TABLE. No season-totals table exists and none is
// created here: every figure on the page is SUM over nfl_player_game_stats,
// grouped by season. A stored total is a second copy of a fact that can drift
// from the first, and the game log is the fact.
//
// THE BRIDGE. Tonight's roster import wrote gridiron players into `players`
// keyed on external_ids->>'bdl_player_id'. The 181,182 stat rows predate it and
// key to nfl_players.id - a separate 13,800-row identity table from the
// fantasy/draft side. Both carry the BDL player id, so that is the join:
//     players.external_ids->>'bdl_player_id'  ==  nfl_players.bdl_player_id
// 3,020 of 3,021 rostered NFL players bridge; 1,940 have stats. The 1,081
// without are rookies and camp bodies who have not played, which is an honest
// empty state rather than a gap.
//
// CFB HAS NO STATS YET. gridiron_player_lines is NFL-only and CFBD's season
// endpoint is not imported until relay C. A CFB player therefore takes the same
// zero-row path as an NFL rookie, and deliberately shows the SAME line: the
// reader does not need our pipeline status.

import { sql } from '../db.js';

/**
 * THE COLUMN VOCABULARY, built from the columns that actually exist.
 *
 * nfl_player_game_stats HAS NO TACKLES AND NO TFL. The mock's defensive header
 * reads Tkl/TFL/Sacks/INT, and two of those four are columns this database has
 * never held - checked before mapping rather than after. What defense really
 * carries, measured over 42,684 defensive rows: sacks 42,452 · def_int 1,676 ·
 * fr 1,306 · def_td 282. So defense is Sacks/INT/FR/TD, and the page states
 * four true things instead of two true and two invented.
 *
 * `dec: true` marks a column that can legitimately be a half. Sacks are the
 * only one in the NFL set (numeric in the schema); everything else is an
 * integer count and must never render "6.0" for six catches.
 */
export const COLUMN_SETS = Object.freeze({
  passing: [
    { key: 'pass_cmp', label: 'Cmp' }, { key: 'pass_att', label: 'Att' },
    { key: 'pass_yds', label: 'Yds' }, { key: 'pass_td', label: 'TD' },
    { key: 'pass_int', label: 'INT' },
  ],
  rushing: [
    { key: 'rush_att', label: 'Att' }, { key: 'rush_yds', label: 'Yds' },
    { key: 'rush_td', label: 'TD' }, { key: 'rec', label: 'Rec' },
    { key: 'rec_yds', label: 'Rec Yds' },
  ],
  receiving: [
    { key: 'tgt', label: 'Tgt' }, { key: 'rec', label: 'Rec' },
    { key: 'rec_yds', label: 'Yds' }, { key: 'rec_td', label: 'TD' },
  ],
  kicking: [
    { key: 'fgm', label: 'FGM' }, { key: 'fga', label: 'FGA' },
    { key: 'fg_long', label: 'Long', agg: 'max' }, { key: 'xp', label: 'XP' },
  ],
  defense: [
    { key: 'sacks', label: 'Sacks', dec: true }, { key: 'def_int', label: 'INT' },
    { key: 'fr', label: 'FR' }, { key: 'def_td', label: 'TD' },
  ],
});

// Position -> column set. The abbreviation decides where the group cannot:
// a punter and a kicker are both ST but only one of them kicks field goals,
// and an OL is OFF while having no offensive counting stat at all.
const BY_POSITION = {
  QB: 'passing',
  RB: 'rushing', FB: 'rushing', HB: 'rushing', TB: 'rushing',
  WR: 'receiving', TE: 'receiving',
  K: 'kicking', PK: 'kicking',
};

/**
 * Which columns a player's tables use, or NULL when the player has no
 * counting-stat vocabulary at all (offensive linemen, punters, long snappers).
 * Null means the stats sections do not render - a lineman with four empty
 * columns is worse than a lineman with none.
 */
export function columnsFor(position, positionGroup) {
  const pos = String(position ?? '').toUpperCase().trim();
  if (BY_POSITION[pos]) return COLUMN_SETS[BY_POSITION[pos]];
  if (positionGroup === 'DEF') return COLUMN_SETS.defense;
  return null;
}

/**
 * WHICH TWO NUMBERS A POSITION IS ABOUT.
 *
 * The game chart is a shape, not a table - it answers "how has he been going"
 * at a glance, and a glance holds two things. So each position group names at
 * most TWO columns, chosen as the pair a reader of that position actually
 * asks about, and the cap is enforced here rather than left to the render.
 *
 * KEYS ARE LOOKED UP IN THE PLAYER'S OWN COLUMN SET, never assumed. CFB
 * defense carries tackles_tot and NFL defense does not; asking for a column
 * this code has never held would chart a row of nulls and call it production.
 * If a preferred key is absent the pair silently shortens - one honest chart
 * beats two where one is empty.
 */
//
// THE FAMILY IS DETECTED FROM THE COLUMNS' OWN KEYS, not from which object
// they are. columnSetName() compares by IDENTITY against COLUMN_SETS, which
// works for NFL and silently returns null for CFB - cfbColumnsFor builds its
// own set objects in lib/cfb/seasonStats.js. Routing chart selection through
// that lookup gave every CFB defender zero charts while every NFL one got two,
// and nothing threw. Keys are the shared vocabulary; the objects are not.
const CHART_PREFS = [
  { family: 'passing', when: ['pass_yds'], keys: ['pass_yds', 'pass_td'] },
  { family: 'rushing', when: ['rush_yds'], keys: ['rush_yds', 'rec'] },
  { family: 'receiving', when: ['tgt', 'rec_yds'], keys: ['rec', 'rec_yds'] },
  { family: 'kicking', when: ['fgm'], keys: ['fgm', 'xp'] },
  // CFB carries tackles_tot and TFL; NFL carries neither, so the same entry
  // yields Tkl+Sacks for a college defender and Sacks+INT for a pro one.
  { family: 'defense', when: ['sacks', 'def_int', 'tackles_tot'], keys: ['tackles_tot', 'sacks', 'def_int'] },
];

export const MAX_CHARTS = 2;

export function chartsFor(columns) {
  if (!columns?.length) return [];
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const pref = CHART_PREFS.find((p) => p.when.some((k) => byKey.has(k)));
  if (!pref) return [];
  const out = [];
  for (const k of pref.keys) {
    const col = byKey.get(k);
    if (col) out.push(col);
    if (out.length === MAX_CHARTS) break;
  }
  return out;
}

/** The set's name, for the module's context line ("Receiving · 2018-2025"). */
export function columnSetName(columns) {
  for (const [name, set] of Object.entries(COLUMN_SETS)) if (set === columns) return name;
  return null;
}

/**
 * Render one cell. A half-capable column shows one decimal ALWAYS (3 sacks is
 * "3.0", matching how the number is spoken); a count column never shows one.
 */
export function formatStat(col, value) {
  if (value == null) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (col.dec) return n.toFixed(1);
  return Math.round(n).toLocaleString('en-US');
}

/** Sum a set of season rows into the career row. Pure, so it can be checked. */
export function careerFrom(seasons, columns) {
  const out = {};
  for (const col of columns) {
    if (col.agg === 'max') {
      const vals = seasons.map((s) => Number(s[col.key])).filter(Number.isFinite);
      out[col.key] = vals.length ? Math.max(...vals) : null;
      continue;
    }
    let total = 0, seen = false;
    for (const s of seasons) {
      // NULL IS NOT ZERO, and Number(null) IS 0 - which is finite, so a plain
      // isFinite check counted every absent value as a real zero and flipped
      // `seen`. Demario Davis has no defensive touchdowns in any season: every
      // season row rendered "—" while the career row underneath rendered "0".
      // Caught by reading the served career row, not by the conservation test,
      // which compared totals and agreed. SUM ignores nulls and returns null
      // when they are all null; this now does the same.
      if (s[col.key] == null) continue;
      const v = Number(s[col.key]);
      if (Number.isFinite(v)) { total += v; seen = true; }
    }
    // Two decimals then trimmed: summing numeric sacks in floating point turns
    // 0.5 + 0.5 + 0.5 into 1.4999999999999998.
    out[col.key] = seen ? Math.round(total * 100) / 100 : null;
  }
  return out;
}

// The aggregate expression per column, reused by both reads.
const aggSql = (columns) => columns
  .map((c) => `${c.agg === 'max' ? 'max' : 'sum'}(s.${c.key}) AS ${c.key}`)
  .join(', ');

/**
 * Per-season totals, newest first. Regular season and postseason are summed
 * together deliberately - the page says "season", and splitting them would need
 * a column the mock does not have.
 */
export async function seasonTotals(bdlPlayerId, columns) {
  if (bdlPlayerId == null || !columns?.length) return [];
  const rows = await sql.query(
    `SELECT m.season_year AS season, count(*)::int AS games, ${aggSql(columns)}
       FROM nfl_player_game_stats s
       JOIN nfl_players np ON np.id = s.nfl_player_id
       JOIN matches m ON m.id = s.match_id
      WHERE np.bdl_player_id = $1 AND m.season_year IS NOT NULL
      GROUP BY m.season_year
      ORDER BY m.season_year DESC`,
    [Number(bdlPlayerId)],
  );
  return rows;
}

/**
 * Recent games, newest first. Opponent and result are derived from the match
 * row, using the stat row's own team_id to decide which side the player was on
 * - a player traded mid-season has rows on both, and reading his CURRENT team
 * would mislabel every game before the trade.
 */
export async function gameLog(bdlPlayerId, columns, { limit = 4, season = null } = {}) {
  if (bdlPlayerId == null || !columns?.length) return [];
  const cols = columns.map((c) => `s.${c.key}`).join(', ');
  // SEASON-SCOPED READS TAKE THE WHOLE SEASON. `limit` exists for the
  // four-row preview the page has always shown; a season's log is bounded by
  // the season itself, and truncating it would make the chart lie about a
  // stretch it claims to cover.
  const rows = await sql.query(
    `SELECT m.season_year AS season, m.week, m.status,
            m.home_team_id, m.away_team_id, m.home_score, m.away_score,
            s.team_id,
            ht.abbreviation AS home_abbr, at.abbreviation AS away_abbr,
            ${cols}
       FROM nfl_player_game_stats s
       JOIN nfl_players np ON np.id = s.nfl_player_id
       JOIN matches m ON m.id = s.match_id
       LEFT JOIN teams ht ON ht.id = m.home_team_id
       LEFT JOIN teams at ON at.id = m.away_team_id
      WHERE np.bdl_player_id = $1
        AND ($3::int IS NULL OR m.season_year = $3::int)
      ORDER BY m.kickoff_at DESC NULLS LAST
      LIMIT $2`,
    [Number(bdlPlayerId), season == null ? Number(limit) : 40, season == null ? null : Number(season)],
  );
  return rows.map((r) => {
    const home = r.team_id != null && r.team_id === r.home_team_id;
    const oppAbbr = home ? r.away_abbr : r.home_abbr;
    const us = home ? r.home_score : r.away_score;
    const them = home ? r.away_score : r.home_score;
    let result = null;
    if (r.status === 'final' && us != null && them != null) {
      result = `${us > them ? 'W' : us < them ? 'L' : 'T'} ${us}-${them}`;
    }
    return { ...r, opponent: `${home ? 'vs' : 'at'} ${oppAbbr ?? '—'}`, result };
  });
}

/** The BDL id a gridiron player carries, or null. */
export function bdlIdOf(player) {
  const raw = player?.external_ids?.bdl_player_id;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
