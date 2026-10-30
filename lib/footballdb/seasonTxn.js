// lib/footballdb/seasonTxn.js — one footballdb season = one database transaction.
//
// WHY: on PROD on 30 Oct a 2000-2001 run died on a CHECK constraint after
// resolveAndPersistIdentity had minted 40 nfl_players rows and 35 season_totals
// rows had been inserted, one HTTP round trip each, no transaction. The
// leftovers were deleted by hand. Neon's HTTP driver cannot hold a transaction
// open across statements (the player INSERT's RETURNING id feeds later
// inserts), so --apply goes over a pg Client and wraps each season in
// BEGIN ... COMMIT, ROLLBACK on any error.

/**
 * Tagged-template adapter over a pg-style client: sql`... ${x} ...` -> rows.
 * Same shape as lib/db.js's sql, so identity.js and loadCandidateIndex take it
 * unchanged.
 */
export function txSql(client) {
  return async (strings, ...values) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    const res = await client.query(text, values);
    return res.rows;
  };
}

/**
 * Run work(sql) inside BEGIN/COMMIT on `client`. Any throw (from work or from
 * COMMIT) issues ROLLBACK and rethrows the original error; nothing the work
 * wrote survives. Returns work's result.
 */
export async function inSeasonTransaction(client, work) {
  await client.query('BEGIN');
  try {
    const result = await work(txSql(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone: the server aborts the txn */ }
    throw err;
  }
}

/**
 * The season_totals upsert, one row. Takes any tagged-template sql.
 */
export async function upsertSeasonTotal(sql, w) {
  await sql`
    INSERT INTO nfl_player_season_totals
      (nfl_player_id, season_year, team_key, position, games,
       pass_cmp, pass_att, pass_yds, pass_td, pass_int,
       rush_att, rush_yds, rush_td, rush_long, rec, rec_yds, rec_td, rec_long,
       fgm, fga, fg_long, xp, sacks, def_int, def_td, matched_by, raw_name)
    VALUES
      (${w.nflPlayerId}, ${w.season_year}, ${w.team_key}, ${w.position}, ${w.games},
       ${w.pass_cmp}, ${w.pass_att}, ${w.pass_yds}, ${w.pass_td}, ${w.pass_int},
       ${w.rush_att}, ${w.rush_yds}, ${w.rush_td}, ${w.rush_long},
       ${w.rec}, ${w.rec_yds}, ${w.rec_td}, ${w.rec_long},
       ${w.fgm}, ${w.fga}, ${w.fg_long}, ${w.xp}, ${w.sacks}, ${w.def_int}, ${w.def_td},
       ${w.matched_by}, ${w.raw_name})
    ON CONFLICT (nfl_player_id, season_year, team_key) DO UPDATE SET
      position = EXCLUDED.position, games = EXCLUDED.games,
      pass_cmp = EXCLUDED.pass_cmp, pass_att = EXCLUDED.pass_att, pass_yds = EXCLUDED.pass_yds,
      pass_td = EXCLUDED.pass_td, pass_int = EXCLUDED.pass_int,
      rush_att = EXCLUDED.rush_att, rush_yds = EXCLUDED.rush_yds, rush_td = EXCLUDED.rush_td,
      rush_long = EXCLUDED.rush_long,
      rec = EXCLUDED.rec, rec_yds = EXCLUDED.rec_yds, rec_td = EXCLUDED.rec_td,
      rec_long = EXCLUDED.rec_long,
      fgm = EXCLUDED.fgm, fga = EXCLUDED.fga, fg_long = EXCLUDED.fg_long, xp = EXCLUDED.xp,
      sacks = EXCLUDED.sacks, def_int = EXCLUDED.def_int, def_td = EXCLUDED.def_td,
      matched_by = EXCLUDED.matched_by, raw_name = EXCLUDED.raw_name`;
}
