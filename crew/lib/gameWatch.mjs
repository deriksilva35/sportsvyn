// crew/lib/gameWatch.mjs - game-watch: the Watcher's GAME rules G1-G6 (crew/watch-rules.md).
// Reads the crew_stats views g1_lock_unstarted .. g5_retention_not_ok (each is that rule's SQL and
// returns rows ONLY when the rule fires) and live_matches_v for G6. No arguments, read only.
// One line per firing row: `G<n> <severity> <key> <detail>`. Severity is the rule's ticket severity
// (page | warn | live, as watch-rules.md states them); key is the dedupe key:
//   G1 match id, G2 contest id, G3 match id, G4 contest id, G5 `data-retention`, G6 match id.
import { parseArgs, requireReaderUrl } from './common.mjs';
import { query, num } from './db.mjs';

const tok = (v) => String(v ?? '-').replace(/\s+/g, '_');

/** The reads, one per rule. G6 is the rule's own SQL over live_matches_v (watch-rules.md). */
export const SQL = Object.freeze({
  g1: 'SELECT * FROM crew_stats.g1_lock_unstarted',
  g2: 'SELECT * FROM crew_stats.g2_card_incomplete',
  g3: 'SELECT * FROM crew_stats.g3_kickoff_midnight_untbd',
  g4: 'SELECT * FROM crew_stats.g4_board_unsettled',
  g5: 'SELECT * FROM crew_stats.g5_retention_not_ok',
  g6: `SELECT id AS match_id, league_slug, status, kickoff_at, last_change_at, home_score, away_score, period, clock,
               round(extract(epoch FROM (now() - COALESCE(last_change_at, kickoff_at))) / 60)::int AS minutes_frozen
          FROM crew_stats.live_matches_v
         WHERE (last_change_at < now() - interval '15 minutes'
                OR (last_change_at IS NULL AND kickoff_at < now() - interval '20 minutes'))
           AND NOT (period = '2' AND (clock IN ('0:00', '00:00') OR clock ILIKE 'HT%')
                    AND COALESCE(last_change_at, kickoff_at) > now() - interval '30 minutes')
         ORDER BY minutes_frozen DESC`,
});

/** PURE. One row per rule -> { sev, key, detail }. */
export const FORMAT = Object.freeze({
  G1: (r) => ({
    sev: num(r.minutes_past) > 30 ? 'page' : 'warn',
    key: r.match_id,
    detail: `contest=${r.contest_id} ${tok(r.game_type)} match=${tok(r.slug)} still_scheduled minutes_past=${num(r.minutes_past)}`,
  }),
  G2: (r) => ({
    // dangling ids are warn only; no pickable game pages once the board has been open over 12 h
    sev: num(r.dangling) === 0 && num(r.hours_open) > 12 ? 'page' : 'warn',
    key: r.contest_id,
    detail: `${tok(r.game_type)} ${tok(r.why)} games=${num(r.games)} pickable=${num(r.pickable)} dangling=${num(r.dangling)} hours_open=${num(r.hours_open)}`,
  }),
  G3: (r) => ({
    sev: num(r.minutes_to_kickoff) <= 24 * 60 ? 'page' : 'warn',
    key: r.match_id,
    detail: `${tok(r.league)} ${tok(r.slug)} midnight_et_no_tbd minutes_to_kickoff=${num(r.minutes_to_kickoff)}`,
  }),
  G4: (r) => ({
    sev: num(r.hours_since_last_final) >= 24 ? 'page' : 'warn',
    key: r.contest_id,
    detail: `${tok(r.game_type)} games=${num(r.games)} finals=${num(r.finals)} hours_since_last_final=${num(r.hours_since_last_final)}`,
  }),
  G5: (r) => ({
    // page when the latest run is not ok or older than 50 h; "no run recorded" and a 26-50 h gap are warn
    sev: r.why === 'last run not ok' || num(r.hours_since_start) > 50 ? 'page' : 'warn',
    key: 'data-retention',
    detail: `${tok(r.why)} kind=${tok(r.kind)} hours_since_start=${r.hours_since_start == null ? '-' : num(r.hours_since_start)}`,
  }),
  G6: (r) => ({
    sev: 'live',
    key: r.match_id,
    detail: `${tok(r.league_slug)} frozen_min=${num(r.minutes_frozen)} score=${num(r.home_score)}-${num(r.away_score)} period=${tok(r.period)} clock=${tok(r.clock)}`,
  }),
});

/** PURE. rows: { g1..g6: [row] } -> { lines, summary, code }. */
export function summarize(rows) {
  const lines = [];
  const counts = {};
  for (const n of [1, 2, 3, 4, 5, 6]) {
    const list = rows[`g${n}`] ?? [];
    counts[`g${n}`] = list.length;
    for (const r of list) {
      const f = FORMAT[`G${n}`](r);
      lines.push(`G${n} ${f.sev} ${tok(f.key)} ${f.detail}`);
    }
  }
  const fired = lines.length > 0;
  return { lines, summary: { ...counts, status: fired ? 'regression' : 'ok' }, code: fired ? 1 : 0 };
}

export async function main({ argv, env }) {
  parseArgs(argv, []);
  const url = requireReaderUrl(env);
  const [g1, g2, g3, g4, g5, g6] = await Promise.all(Object.values(SQL).map((s) => query(url, s)));
  return summarize({ g1, g2, g3, g4, g5, g6 });
}
