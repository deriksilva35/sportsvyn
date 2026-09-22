// lib/mlb/playsImport.js - /mlb/v1/plays and /mlb/v1/stats into our tables.
// The shaping is PURE; the writers are the only thing that touches the DB.
//
// THE PARAM IS SINGULAR AND THAT IS NOT A STYLE CHOICE. /mlb/v1/plays takes
// `game_id`, one game at a time - `game_ids[]` returns
// 400 {"param":"game_id","error":"must be a valid integer"}. The NFL's plays
// route takes the plural. So a live poller reading N live games costs N calls
// here where the NFL costs one, which is what the cadence in the poller is
// sized against: 600/min on this key, a fifteen-game slate is fifteen calls.
//
// THE ORDINAL IS `order`, NOT AN INDEX. The provider's own monotonic id for a
// play within a game (394081847, 394082896, ...). Using the array position
// would renumber every play whenever the feed back-fills one, and
// provider_play_id is what idempotence rides on.

const BDL = 'https://api.balldontlie.io';

const num = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const txt = (v) => (v == null || v === '' ? null : String(v));

async function get(path) {
  const key = process.env.BDL_API_KEY;
  if (!key) throw new Error('BDL_API_KEY missing in env');
  const res = await fetch(`${BDL}${path}`, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`BDL ${res.status} on ${path.split('?')[0]}`);
  return res.json();
}

/** Every play of one game, oldest first. Paged; the provider caps per_page at 100. */
export async function fetchMlbPlays(gameId) {
  const out = []; let cursor = null; let calls = 0;
  do {
    const q = `/mlb/v1/plays?game_id=${encodeURIComponent(gameId)}&per_page=100${cursor ? `&cursor=${cursor}` : ''}`;
    const j = await get(q); calls += 1;
    out.push(...(j?.data ?? []));
    cursor = j?.meta?.next_cursor ?? null;
    // A GUARD, NOT A LIMIT. A nine-inning game is ~300 plays and an
    // eighteen-inning one twice that; a cursor that never advances would spin
    // here forever against a 600/min budget.
    if (calls > 20) break;
  } while (cursor);
  return { rows: out, calls };
}

/** One game's player box lines. Plural param here - this route takes game_ids[]. */
export async function fetchMlbStats(gameId) {
  const out = []; let cursor = null; let calls = 0;
  do {
    const q = `/mlb/v1/stats?game_ids[]=${encodeURIComponent(gameId)}&per_page=100${cursor ? `&cursor=${cursor}` : ''}`;
    const j = await get(q); calls += 1;
    out.push(...(j?.data ?? []));
    cursor = j?.meta?.next_cursor ?? null;
    if (calls > 10) break;
  } while (cursor);
  return { rows: out, calls };
}

/**
 * PURE. A /plays row -> the columns `plays` holds, football fields left null.
 *
 * `period` IS THE INNING and that is not a compromise: the column means "which
 * division of the game", and for baseball that is the inning. inning_type
 * carries the half, which football has no equivalent of.
 */
export function shapeMlbPlay(row) {
  if (row?.order == null) return null;
  return {
    providerPlayId: String(row.order),
    playNumber: num(row.order),
    period: num(row.inning),
    inningType: txt(row.inning_type),
    playType: txt(row.type),
    text: txt(row.text),
    homeScore: num(row.home_score),
    awayScore: num(row.away_score),
    scoring: row.scoring_play === true,
    // 0 IS A REAL STATE AND SURVIVES AS 0. Nobody out, no balls, no strikes -
    // the start of an at-bat - and num() only nulls a genuinely absent value.
    outs: num(row.outs),
    balls: num(row.balls),
    strikes: num(row.strikes),
    batterId: row.batter_id == null ? null : String(row.batter_id),
    pitcherId: row.pitcher_id == null ? null : String(row.pitcher_id),
  };
}

/** The newest play that names a half - what the live state reads. */
export function newestPlay(rows = []) {
  let best = null;
  for (const r of rows ?? []) {
    if (r?.order == null) continue;
    if (!best || Number(r.order) > Number(best.order)) best = r;
  }
  return best;
}

/**
 * PURE. A /stats row -> mlb_player_game_stats.
 *
 * THE SEASON RATES ARE DROPPED HERE, not later. avg, obp, slg and era ride on
 * this per-game row and are SEASON-TO-DATE; migration 110 has no column for
 * them, and this is the function that would otherwise be tempted to invent one.
 *
 * `ip` BECOMES OUTS. The provider sends 6.2 meaning six and two thirds - it
 * does not add, average or compare as a number, and 6.2 + 6.2 is not 12.4 in
 * any sense a box score means. Outs do all three.
 */
export function inningsToOuts(ip) {
  if (ip == null || ip === '') return null;
  const n = Number(ip);
  if (!Number.isFinite(n) || n < 0) return null;
  const whole = Math.floor(n);
  // The tenths digit is a count of thirds, and it is only ever 0, 1 or 2.
  const thirds = Math.round((n - whole) * 10);
  if (thirds > 2) return null;   // 6.3 is not a thing; refuse rather than guess
  return whole * 3 + thirds;
}

/**
 * "6.2" FROM 20 OUTS - the inverse, and it lives here beside the function it
 * inverts rather than beside its first caller. It is pure arithmetic with no
 * DB and no fetch, which is why the card lines can import it and gameDetail.js
 * (which does open a connection) cannot be where it is defined.
 */
export function outsToInnings(outs) {
  if (outs == null || outs === '') return null;
  const n = Number(outs);
  if (!Number.isFinite(n) || n < 0) return null;
  return `${Math.floor(n / 3)}.${n % 3}`;
}


export function shapeMlbStatLine(row) {
  const playerId = row?.player?.id;
  if (playerId == null) return null;
  const name = String(row.player.full_name
    ?? `${row.player.first_name ?? ''} ${row.player.last_name ?? ''}`).trim();
  if (!name) return null;
  return {
    bdlPlayerId: String(playerId),
    playerName: name,
    position: txt(row.player.position),
    bdlTeamId: row?.team?.id == null ? null : String(row.team.id),
    atBats: num(row.at_bats),
    plateAppearances: num(row.plate_appearances),
    runs: num(row.runs), hits: num(row.hits),
    doubles: num(row.doubles), triples: num(row.triples), homeRuns: num(row.hr),
    rbi: num(row.rbi), walks: num(row.bb), intentionalWalks: num(row.intentional_walks),
    strikeouts: num(row.k), hitByPitch: num(row.hit_by_pitch),
    stolenBases: num(row.stolen_bases), caughtStealing: num(row.caught_stealing),
    totalBases: num(row.total_bases), leftOnBase: num(row.left_on_base),
    sacBunts: num(row.sac_bunts), sacFlies: num(row.sac_flies), gidp: num(row.gidp),
    outsRecorded: inningsToOuts(row.ip) ?? num(row.pitching_outs),
    battersFaced: num(row.batters_faced), pitchesThrown: num(row.pitch_count),
    pitchStrikes: num(row.strikes),
    hitsAllowed: num(row.p_hits), runsAllowed: num(row.p_runs), earnedRuns: num(row.er),
    walksAllowed: num(row.p_bb), strikeoutsPitched: num(row.p_k),
    homeRunsAllowed: num(row.p_hr), wildPitches: num(row.wild_pitches), balks: num(row.balks),
    hbpAllowed: num(row.pitching_hbp),
    inheritedRunners: num(row.inherited_runners), inheritedScored: num(row.inherited_runners_scored),
    wins: num(row.wins), losses: num(row.losses), saves: num(row.saves),
    holds: num(row.holds), blownSaves: num(row.blown_saves), gamesStarted: num(row.games_started),
    putouts: num(row.putouts), assists: num(row.assists), errors: num(row.errors),
    fieldingChances: num(row.fielding_chances),
  };
}

/** The season rates this shaper deliberately does not carry. Named so a test
 *  can assert their absence rather than trusting a comment. */
export const DROPPED_SEASON_RATES = Object.freeze(['avg', 'obp', 'slg', 'era']);

// ------------------------------------------------------------------ writers

/** Upsert one game's plays. Idempotent on (match_id, provider_play_id). */
export async function writeMlbPlays(sql, matchId, rows) {
  let written = 0;
  for (const raw of rows ?? []) {
    const p = shapeMlbPlay(raw);
    if (!p) continue;
    await sql`
      INSERT INTO plays (match_id, provider_play_id, play_number, period, text,
                         play_type, home_score, away_score, scoring,
                         inning_type, outs, balls, strikes, batter_id, pitcher_id,
                         created_at, updated_at)
      VALUES (${matchId}, ${p.providerPlayId}, ${p.playNumber}, ${p.period}, ${p.text},
              ${p.playType}, ${p.homeScore}, ${p.awayScore}, ${p.scoring},
              ${p.inningType}, ${p.outs}, ${p.balls}, ${p.strikes},
              ${p.batterId}, ${p.pitcherId}, now(), now())
      ON CONFLICT (match_id, provider_play_id) DO UPDATE SET
        play_number = EXCLUDED.play_number, period = EXCLUDED.period,
        text = EXCLUDED.text, play_type = EXCLUDED.play_type,
        home_score = EXCLUDED.home_score, away_score = EXCLUDED.away_score,
        scoring = EXCLUDED.scoring, inning_type = EXCLUDED.inning_type,
        outs = EXCLUDED.outs, balls = EXCLUDED.balls, strikes = EXCLUDED.strikes,
        batter_id = EXCLUDED.batter_id, pitcher_id = EXCLUDED.pitcher_id,
        updated_at = now()`;
    written += 1;
  }
  return { written };
}

/** Upsert one game's box lines. Idempotent on (match_id, bdl_player_id). */
export async function writeMlbStats(sql, matchId, rows, teamIdByBdl = new Map()) {
  let written = 0; const unresolvedTeams = new Set();
  for (const raw of rows ?? []) {
    const s = shapeMlbStatLine(raw);
    if (!s) continue;
    const teamId = s.bdlTeamId == null ? null : (teamIdByBdl.get(s.bdlTeamId) ?? null);
    if (s.bdlTeamId != null && teamId == null) unresolvedTeams.add(s.bdlTeamId);
    await sql`
      INSERT INTO mlb_player_game_stats (
        match_id, team_id, bdl_player_id, player_name, position,
        at_bats, plate_appearances, runs, hits, doubles, triples, home_runs, rbi,
        walks, intentional_walks, strikeouts, hit_by_pitch, stolen_bases,
        caught_stealing, total_bases, left_on_base, sac_bunts, sac_flies, gidp,
        outs_recorded, batters_faced, pitches_thrown, pitch_strikes, hits_allowed,
        runs_allowed, earned_runs, walks_allowed, strikeouts_pitched,
        home_runs_allowed, wild_pitches, balks, hbp_allowed, inherited_runners,
        inherited_scored, wins, losses, saves, holds, blown_saves, games_started,
        putouts, assists, errors, fielding_chances, created_at, updated_at)
      VALUES (
        ${matchId}, ${teamId}, ${s.bdlPlayerId}, ${s.playerName}, ${s.position},
        ${s.atBats}, ${s.plateAppearances}, ${s.runs}, ${s.hits}, ${s.doubles},
        ${s.triples}, ${s.homeRuns}, ${s.rbi}, ${s.walks}, ${s.intentionalWalks},
        ${s.strikeouts}, ${s.hitByPitch}, ${s.stolenBases}, ${s.caughtStealing},
        ${s.totalBases}, ${s.leftOnBase}, ${s.sacBunts}, ${s.sacFlies}, ${s.gidp},
        ${s.outsRecorded}, ${s.battersFaced}, ${s.pitchesThrown}, ${s.pitchStrikes},
        ${s.hitsAllowed}, ${s.runsAllowed}, ${s.earnedRuns}, ${s.walksAllowed},
        ${s.strikeoutsPitched}, ${s.homeRunsAllowed}, ${s.wildPitches}, ${s.balks},
        ${s.hbpAllowed}, ${s.inheritedRunners}, ${s.inheritedScored}, ${s.wins},
        ${s.losses}, ${s.saves}, ${s.holds}, ${s.blownSaves}, ${s.gamesStarted},
        ${s.putouts}, ${s.assists}, ${s.errors}, ${s.fieldingChances}, now(), now())
      ON CONFLICT (match_id, bdl_player_id) DO UPDATE SET
        team_id = COALESCE(EXCLUDED.team_id, mlb_player_game_stats.team_id),
        player_name = EXCLUDED.player_name, position = EXCLUDED.position,
        at_bats = EXCLUDED.at_bats, plate_appearances = EXCLUDED.plate_appearances,
        runs = EXCLUDED.runs, hits = EXCLUDED.hits, doubles = EXCLUDED.doubles,
        triples = EXCLUDED.triples, home_runs = EXCLUDED.home_runs, rbi = EXCLUDED.rbi,
        walks = EXCLUDED.walks, intentional_walks = EXCLUDED.intentional_walks,
        strikeouts = EXCLUDED.strikeouts, hit_by_pitch = EXCLUDED.hit_by_pitch,
        stolen_bases = EXCLUDED.stolen_bases, caught_stealing = EXCLUDED.caught_stealing,
        total_bases = EXCLUDED.total_bases, left_on_base = EXCLUDED.left_on_base,
        sac_bunts = EXCLUDED.sac_bunts, sac_flies = EXCLUDED.sac_flies, gidp = EXCLUDED.gidp,
        outs_recorded = EXCLUDED.outs_recorded, batters_faced = EXCLUDED.batters_faced,
        pitches_thrown = EXCLUDED.pitches_thrown, pitch_strikes = EXCLUDED.pitch_strikes,
        hits_allowed = EXCLUDED.hits_allowed, runs_allowed = EXCLUDED.runs_allowed,
        earned_runs = EXCLUDED.earned_runs, walks_allowed = EXCLUDED.walks_allowed,
        strikeouts_pitched = EXCLUDED.strikeouts_pitched,
        home_runs_allowed = EXCLUDED.home_runs_allowed, wild_pitches = EXCLUDED.wild_pitches,
        balks = EXCLUDED.balks, hbp_allowed = EXCLUDED.hbp_allowed,
        inherited_runners = EXCLUDED.inherited_runners,
        inherited_scored = EXCLUDED.inherited_scored, wins = EXCLUDED.wins,
        losses = EXCLUDED.losses, saves = EXCLUDED.saves, holds = EXCLUDED.holds,
        blown_saves = EXCLUDED.blown_saves, games_started = EXCLUDED.games_started,
        putouts = EXCLUDED.putouts, assists = EXCLUDED.assists, errors = EXCLUDED.errors,
        fielding_chances = EXCLUDED.fielding_chances, updated_at = now()`;
    written += 1;
  }
  return { written, unresolvedTeams: [...unresolvedTeams] };
}
