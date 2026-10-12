// lib/mockNba/adp.js - the mock draft's ADP column (sun-7 addendum). PURE + DB.
//
// An OUTSIDE ranking list (rank, name, team, positions - nothing else is kept:
// no stats, no projected points) becomes the "ADP" column. It is matched to our
// pool by name (normalised: accents, punctuation and Jr/Sr/II/III/IV dropped),
// with the team breaking a tie between two players of one name. Where the list's
// team and the roster feed's differ (a recent trade, a stale list), OUR team
// stands and the difference is reported. Players not on the list have no ADP and
// sort after every ranked player. The list's position eligibility (PG,SG / C,PF)
// is used for roster slots (lib/mockNba/roster.js eligible).
//
// MOCK_ADP_SOURCE=on|off is the kill switch (adpEnabled): off hides the column,
// sorts by SVP and has the bots draft by SVP.

import { sql as defaultSql } from '../db.js';

export const adpEnabled = (env = process.env) => String(env.MOCK_ADP_SOURCE ?? 'on').trim().toLowerCase() !== 'off';

// The list's team codes -> the roster feed's.
const TEAM_MAP = { SA: 'SAS', GS: 'GSW', NY: 'NYK', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS', UTA: 'UTA', PHO: 'PHX' };
export const feedTeam = (code) => (code == null || code === 'FA' ? null : TEAM_MAP[code] ?? code);

// The list's short names -> the roster feed's full ones (normalised form).
const ALIAS = {
  'alex sarr': 'alexandre sarr', 'nic claxton': 'nicolas claxton', 'ace bailey': 'airious bailey',
  'bub carrington': 'carlton carrington', 'bones hyland': 'nahshon hyland', 'kj martin': 'kenyon martin',
  'yang hansen': 'hansen yang',
};

export function normName(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[.'’`]/g, '').replace(/-/g, ' ').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/\s+/g, ' ').trim();
}
const keyName = (s) => { const n = normName(s); return ALIAS[n] ?? n; };

const POSITIONS = new Set(['PG', 'SG', 'SF', 'PF', 'C']);

/** TSV text (rank \t name \t team \t positions) -> [{ rank, name, team, positions }]. */
export function parseAdpList(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    const [rank, name, team, pos] = line.split('\t').map((x) => (x ?? '').trim());
    if (!/^\d+$/.test(rank) || !name) continue;
    const positions = String(pos ?? '').split(/[,\s]+/).map((x) => x.toUpperCase()).filter((x) => POSITIONS.has(x));
    out.push({ rank: Number(rank), name, team: team || null, positions });
  }
  return out;
}

/**
 * Match the list to pool rows. -> { matched: [{ player_id, adp_rank, positions, name, list_team, team }],
 *   unmatched: [{ rank, name, team }], staleTeams: [{ rank, name, listTeam, ourTeam }] }.
 */
export function matchAdp(list, pool) {
  const byName = new Map();
  for (const p of pool ?? []) {
    const k = keyName(p.name);
    byName.set(k, [...(byName.get(k) ?? []), p]);
  }
  const matched = []; const unmatched = []; const staleTeams = []; const used = new Set();
  for (const e of list) {
    const cands = (byName.get(keyName(e.name)) ?? []).filter((p) => !used.has(p.id));
    const want = feedTeam(e.team);
    const p = cands.length === 1 ? cands[0] : cands.find((c) => c.team === want) ?? null;
    if (!p) { unmatched.push({ rank: e.rank, name: e.name, team: e.team }); continue; }
    used.add(p.id);
    if (want && p.team && want !== p.team) staleTeams.push({ rank: e.rank, name: e.name, listTeam: e.team, ourTeam: p.team });
    matched.push({ player_id: p.id, adp_rank: e.rank, positions: e.positions, name: p.name, list_team: e.team, team: p.team });
  }
  return { matched, unmatched, staleTeams };
}

/** Replace the stored ADP with `matched` (one transaction). */
export async function storeAdp(matched, sourceDate, { sql = defaultSql } = {}) {
  await sql.transaction([
    sql`DELETE FROM mock_nba_adp`,
    ...matched.map((m) => sql`
      INSERT INTO mock_nba_adp (player_id, adp_rank, positions, source_date)
      VALUES (${m.player_id}, ${m.adp_rank}, ${m.positions}, ${sourceDate})`),
  ]);
  return matched.length;
}

/** Map(player_id -> { adp, positions }). */
export async function readAdp({ sql = defaultSql } = {}) {
  const rows = await sql`SELECT player_id, adp_rank, positions FROM mock_nba_adp`;
  return new Map(rows.map((r) => [Number(r.player_id), { adp: Number(r.adp_rank), positions: r.positions ?? [] }]));
}

/**
 * Pool rows + the ADP map -> rows with `adp` and `positions` (list eligibility),
 * or - with the source off - rows with neither (SVP and the feed's positions only).
 */
export function withAdp(rows, adpMap, { on = true } = {}) {
  return (rows ?? []).map((r) => {
    const a = on ? adpMap?.get(Number(r.id)) : null;
    const { adp: _a, positions: _p, ...rest } = r;
    return a ? { ...rest, adp: a.adp, positions: a.positions?.length ? a.positions : undefined } : rest;
  });
}
