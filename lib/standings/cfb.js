// lib/standings/cfb.js — CFBD /records -> team_records.
//
// ALL CLASSIFICATIONS, NOT JUST FBS. This is the records half of the FCS
// tier-(a) ruling. /records?year= returns all 684 D-I-and-below teams in ONE
// call, and — the reason it matters — it carries a team's COMPLETE record,
// including games we do not hold in `matches`. North Dakota State's 1-0 comes
// from CFBD whether or not we ingested the game; deriving W-L from our own
// matches table structurally cannot do that, because we skip 2,068
// D-II/D-III games a season and 651 FCS-vs-FCS ones.
//
// ONE CALL, EVERY TEAM. No pagination, no per-team fetch.

import { sql } from '../db.js';

const BASE = 'https://apinext.collegefootballdata.com';

/** The provider's split blocks -> our column trios. Anything else is counted. */
export const SPLIT_MAP = Object.freeze({
  total: ['wins', 'losses', 'ties'],
  conferenceGames: ['conf_wins', 'conf_losses', 'conf_ties'],
  homeGames: ['home_wins', 'home_losses', 'home_ties'],
  awayGames: ['away_wins', 'away_losses', 'away_ties'],
  neutralSiteGames: ['neutral_wins', 'neutral_losses', 'neutral_ties'],
});

/**
 * SEASON TYPE FROM THE PAYLOAD'S OWN SPLIT, not from a calendar.
 *
 * CFBD hands us regularSeason and postseason blocks alongside `total`, so
 * unlike the NFL arm there is nothing to infer — we store the REGULAR record
 * because that is what "the record" means on a team page, and the postseason
 * block is available for a later row if anyone wants it.
 */
export function toRecordRow(r, { teamId, leagueId, unmapped } = {}) {
  const out = {
    league_id: leagueId, team_id: teamId, season: r.year,
    season_type: 'regular',
    conference: r.conference || null,
    division: r.division || null,
    classification: r.classification || null,
    data_provider: 'cfbd',
  };
  for (const [block, [w, l, t]] of Object.entries(SPLIT_MAP)) {
    const b = r[block];
    // A BLOCK THE PROVIDER OMITS IS NULL, NOT ZERO. Zero means "played none
    // and won none", which is a different claim from "not reported".
    out[w] = b ? (b.wins ?? null) : null;
    out[l] = b ? (b.losses ?? null) : null;
    out[t] = b ? (b.ties ?? null) : null;
  }
  // total is NOT NULL in the schema; a row with no total block is unusable.
  if (out.wins == null || out.losses == null) return null;
  out.ties ??= 0;
  // Blocks we do not map, counted rather than silently dropped.
  for (const k of Object.keys(r)) {
    if (['year', 'teamId', 'team', 'classification', 'conference', 'division',
      'expectedWins', 'regularSeason', 'postseason'].includes(k)) continue;
    if (!SPLIT_MAP[k]) unmapped?.push(k);
  }
  return out;
}

/** cfbd team id -> our team id. */
async function teamMap(leagueId) {
  const rows = await sql`
    SELECT id, external_ids->>'cfbd_team_id' AS pid FROM teams
     WHERE league_id = ${leagueId} AND external_ids ? 'cfbd_team_id'`;
  return new Map(rows.map((r) => [r.pid, r.id]));
}

export function cfbdRecordsFetcher({ base = BASE } = {}) {
  return async (season) => {
    const key = process.env.CFBD_API_KEY;
    if (!key) throw new Error('CFBD_API_KEY missing in env');
    const res = await fetch(`${base}/records?year=${season}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`CFBD ${res.status} on /records?year=${season}`);
    return res.json();
  };
}

export async function syncCfbRecords(leagueId, season, { fetchRecords, dryRun = false } = {}) {
  const summary = {
    provider: 'cfbd', season, requests: 1,
    rows: 0, matched: 0, noTeam: 0, written: 0,
    byClassification: {}, unmapped: [], dryRun,
  };
  const raw = await (fetchRecords ?? cfbdRecordsFetcher())(season);
  summary.rows = raw.length;
  const tmap = await teamMap(leagueId);

  const batch = [];
  for (const r of raw) {
    const teamId = tmap.get(String(r.teamId));
    // A TEAM WE DO NOT HOLD IS COUNTED, NOT INVENTED. Unlike a box-score
    // player, a standings row for a team with no row here has nowhere to
    // attach and nothing a stub would usefully carry.
    if (teamId == null) { summary.noTeam += 1; continue; }
    const row = toRecordRow(r, { teamId, leagueId, unmapped: summary.unmapped });
    if (!row) { summary.noTeam += 1; continue; }
    summary.matched += 1;
    const c = row.classification ?? '(none)';
    summary.byClassification[c] = (summary.byClassification[c] ?? 0) + 1;
    batch.push(row);
  }
  summary.unmapped = [...new Set(summary.unmapped)];
  if (!dryRun) summary.written = await upsertRecords(batch);
  return summary;
}

/**
 * Shared by both record importers - one upsert shape, one conflict target.
 *
 * THE WIRE IS EMITTED HERE, NOT POLLED. team_records is rewritten in place with
 * no history, so a flip leaves no trace to diff afterwards. This function is
 * the one place that holds the BEFORE and the AFTER at the same moment, so it
 * is the only honest place to say a record changed. lib/wire/records.js is a
 * pure shaper for exactly that reason - it reads nothing.
 *
 * THE EMIT NEVER FAILS THE SYNC. A wire row is decoration on top of a write
 * that matters; if the wire is broken the standings must still land.
 */
export async function upsertRecords(rows, { emitWire = true } = {}) {
  let n = 0;
  const changes = [];
  // One read of what is already there, before anything is overwritten.
  const prior = new Map();
  if (emitWire && rows.length) {
    try {
      const keys = rows.map((r) => r.team_id);
      const was = await sql`
        SELECT tr.team_id, tr.wins, tr.losses, tr.ties, tr.league_id, tr.season,
               t.abbreviation, t.name, l.slug AS league_slug
          FROM team_records tr
          JOIN teams t ON t.id = tr.team_id
          JOIN leagues l ON l.id = tr.league_id
         WHERE tr.team_id = ANY(${keys}) AND tr.season = ${rows[0].season}
           AND tr.season_type = ${rows[0].season_type}`;
      for (const w of was) prior.set(w.team_id, w);
    } catch { /* no prior read, no flips - the sync still runs */ }
  }
  for (const r of rows) {
    await sql`
      INSERT INTO team_records (
        league_id, team_id, season, season_type,
        wins, losses, ties,
        conf_wins, conf_losses, conf_ties,
        home_wins, home_losses, home_ties,
        away_wins, away_losses, away_ties,
        neutral_wins, neutral_losses, neutral_ties,
        div_wins, div_losses, div_ties,
        points_for, points_against, streak, playoff_seed,
        conference, division, classification,
        data_provider, data_provider_synced_at)
      VALUES (
        ${r.league_id}, ${r.team_id}, ${r.season}, ${r.season_type},
        ${r.wins}, ${r.losses}, ${r.ties},
        ${r.conf_wins ?? null}, ${r.conf_losses ?? null}, ${r.conf_ties ?? null},
        ${r.home_wins ?? null}, ${r.home_losses ?? null}, ${r.home_ties ?? null},
        ${r.away_wins ?? null}, ${r.away_losses ?? null}, ${r.away_ties ?? null},
        ${r.neutral_wins ?? null}, ${r.neutral_losses ?? null}, ${r.neutral_ties ?? null},
        ${r.div_wins ?? null}, ${r.div_losses ?? null}, ${r.div_ties ?? null},
        ${r.points_for ?? null}, ${r.points_against ?? null},
        ${r.streak ?? null}, ${r.playoff_seed ?? null},
        ${r.conference ?? null}, ${r.division ?? null}, ${r.classification ?? null},
        ${r.data_provider}, now())
      ON CONFLICT (league_id, team_id, season, season_type) DO UPDATE SET
        wins = EXCLUDED.wins, losses = EXCLUDED.losses, ties = EXCLUDED.ties,
        conf_wins = EXCLUDED.conf_wins, conf_losses = EXCLUDED.conf_losses, conf_ties = EXCLUDED.conf_ties,
        home_wins = EXCLUDED.home_wins, home_losses = EXCLUDED.home_losses, home_ties = EXCLUDED.home_ties,
        away_wins = EXCLUDED.away_wins, away_losses = EXCLUDED.away_losses, away_ties = EXCLUDED.away_ties,
        neutral_wins = EXCLUDED.neutral_wins, neutral_losses = EXCLUDED.neutral_losses, neutral_ties = EXCLUDED.neutral_ties,
        div_wins = EXCLUDED.div_wins, div_losses = EXCLUDED.div_losses, div_ties = EXCLUDED.div_ties,
        points_for = EXCLUDED.points_for, points_against = EXCLUDED.points_against,
        streak = EXCLUDED.streak, playoff_seed = EXCLUDED.playoff_seed,
        conference = EXCLUDED.conference, division = EXCLUDED.division,
        classification = EXCLUDED.classification,
        data_provider_synced_at = now(), updated_at = now()`;
    n += 1;
    const b = prior.get(r.team_id);
    if (emitWire && b) {
      changes.push({
        team: { id: r.team_id, abbreviation: b.abbreviation, name: b.name },
        before: { wins: b.wins, losses: b.losses, ties: b.ties },
        after: { wins: r.wins, losses: r.losses, ties: r.ties },
        leagueId: r.league_id,
        leagueSlug: b.league_slug,
        season: r.season,
      });
    }
  }
  if (emitWire && changes.length) {
    try {
      const { recordFlipRows } = await import('../wire/records.js');
      const { emit } = await import('../wire/emit.js');
      await emit(recordFlipRows(changes));
    } catch { /* the wire must never take the standings down */ }
  }
  return n;
}
