// lib/testing/wpSentinel.mjs - A SENTINEL NFL GAME WITH A WIN-PROBABILITY LOG,
// for the biggest-swings test (lib/gridiron/biggestSwings.test.mjs) and the
// sat-1 proof shots. DEV ONLY, and only ever under a `sentinel-` slug, which
// scripts/dev-orphan-sweep.mjs lists if a killed run leaves one behind.
//
// THE PLAYS ARE REAL, THE LOG IS A FIXTURE. The plays are PHI@CHI 2026 week 3
// (lib/gridiron/fixtures/phi-chi-2026-w3.json, BDL's recorded feed) through
// the importer's own normaliser (nflPlaysAndDrives), mapped onto DEV's PHI and
// CHI. The winprob_log rows are computed HERE, by the shipped model
// (modelState + predict, nfl.json), one state row per play that has an offense
// or is a kickoff, stamped at whatever instants the caller says - so a test
// can place them before or after the fri-4 cutoff. They are not what the
// poller logged for that game, and nothing here pretends they are.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nflPlaysAndDrives } from '../gridiron/playsImport.js';
import { modelState } from '../winprob/live.js';
import { predict, priorLogit, spreadForModel, MODEL_VERSION } from '../winprob/predict.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PHI_CHI = JSON.parse(readFileSync(path.join(HERE, '..', 'gridiron', 'fixtures', 'phi-chi-2026-w3.json'), 'utf8'));

/** DEV's PHI (away) and CHI (home) - by abbreviation, never a typed id. */
export async function phiChiTeams(sql) {
  const rows = await sql`
    SELECT t.id, t.abbreviation FROM teams t JOIN leagues l ON l.id = t.league_id
     WHERE l.slug = 'nfl' AND t.abbreviation IN ('PHI', 'CHI') ORDER BY t.id`;
  const by = Object.fromEntries(rows.map((r) => [r.abbreviation, r.id]));
  if (!by.PHI || !by.CHI) throw new Error('DEV has no PHI/CHI NFL teams');
  return { home: by.CHI, away: by.PHI };
}

/**
 * Insert the match and its plays. `cut` keeps the first N plays (a live game).
 * Returns { matchId, plays: [{ id, ...normalised }] } in feed (game) order.
 */
export async function seedPhiChi(sql, { slug, kickoffAt, status = 'final', homeScore = 27, awayScore = 7, liveState = null, spread = 3.5, cut = null }) {
  const { home, away } = await phiChiTeams(sql);
  const tmap = new Map([['24', home], ['18', away]]);
  let { plays } = nflPlaysAndDrives(PHI_CHI.bdl, tmap);
  if (cut != null) plays = plays.slice(0, cut);
  const [lg] = await sql`SELECT id FROM leagues WHERE slug = 'nfl'`;
  const metadata = { market_prior: { spread, n_books: 10, captured_at: kickoffAt }, ...(liveState ? { live_state: liveState } : {}) };
  const [m] = await sql`
    INSERT INTO matches (league_id, slug, status, home_team_id, away_team_id, kickoff_at, home_score, away_score,
                         season_year, season_phase, week, external_ids, metadata)
    VALUES (${lg.id}, ${slug}, ${status}, ${home}, ${away}, ${kickoffAt}, ${homeScore}, ${awayScore},
            2026, 'REG', 5, ${JSON.stringify({ sentinel: slug })}::jsonb, ${JSON.stringify(metadata)}::jsonb)
    RETURNING id`;
  const recs = plays.map((p) => ({
    provider_play_id: `${slug}-${p.providerPlayId}`, drive_id: p.driveId, drive_number: p.driveNumber, play_number: p.playNumber,
    period: p.period, clock: p.clock, down: p.down, distance: p.distance, yards_to_goal: p.yardsToGoal, yards_gained: p.yardsGained,
    offense_team_id: p.offenseTeamId, play_type: p.playType, text: p.text, home_score: p.homeScore, away_score: p.awayScore,
    scoring: p.scoring ?? false,
  }));
  // ONE STATEMENT for the whole feed: 165 single-row inserts over the HTTP
  // driver is 165 round trips.
  const ids = await sql`
    INSERT INTO plays (match_id, provider_play_id, drive_id, drive_number, play_number, period, clock, down, distance,
                       yards_to_goal, yards_gained, offense_team_id, play_type, text, home_score, away_score, scoring)
    SELECT ${m.id}, r.provider_play_id, r.drive_id, r.drive_number, r.play_number, r.period, r.clock, r.down, r.distance,
           r.yards_to_goal, r.yards_gained, r.offense_team_id, r.play_type, r.text, r.home_score, r.away_score, r.scoring
      FROM jsonb_to_recordset(${JSON.stringify(recs)}::jsonb) AS r(
        provider_play_id text, drive_id text, drive_number int, play_number int, period int, clock text, down int,
        distance int, yards_to_goal int, yards_gained int, offense_team_id int, play_type text, text text,
        home_score int, away_score int, scoring boolean)
    RETURNING id, provider_play_id`;
  const idOf = new Map(ids.map((r) => [r.provider_play_id, Number(r.id)]));
  return { matchId: m.id, home, away, plays: plays.map((p) => ({ ...p, id: idOf.get(`${slug}-${p.providerPlayId}`) })) };
}

/**
 * PURE-ish. The model's state rows for the seeded plays, in game order: one
 * per play with an offense or a kickoff, the score never going down (a stale
 * 0-0 stoppage row does not reset it - lib/gridiron/gamePageArcade.js
 * scoreChanges' rule). Returns [{ play_seq, p_home, inputs }].
 */
export function modelRows(plays, { home, spread = 3.5 }) {
  const logit = priorLogit('nfl', spreadForModel('nfl', spread));
  let h = 0, a = 0;
  const out = [];
  for (const p of plays) {
    if (p.homeScore != null && p.awayScore != null && p.homeScore >= h && p.awayScore >= a) { h = p.homeScore; a = p.awayScore; }
    const isKick = String(p.playType ?? '').toLowerCase() === 'kickoff';
    if (p.offenseTeamId == null && !isKick) continue;
    const state = modelState({
      period: p.period, clock: p.clock, homeScore: h, awayScore: a, homeTeamId: home, season: 2026, sport: 'nfl',
      homeAbbr: 'CHI', awayAbbr: 'PHI',
      play: { play_type: p.playType, text: p.text, down: p.down, distance: p.distance, yards_to_goal: p.yardsToGoal, offense_team_id: p.offenseTeamId },
    });
    if (!state) continue;
    const pr = predict('nfl', state, logit);
    if (pr == null || !Number.isFinite(pr)) continue;
    out.push({ play_seq: p.id, p_home: pr, inputs: { ...state, prior_logit: logit, spread, home_score: h, away_score: a } });
  }
  return out;
}

/**
 * Write rows into winprob_log, the i-th at startMs + i * stepMs. `extra` rows
 * (hold / release / final) are written as given, each with its own ts.
 */
export async function writeLog(sql, matchId, rows, { startMs, stepMs = 40_000 }) {
  const recs = rows.map((r, i) => ({
    ts: r.ts ?? new Date(startMs + i * stepMs).toISOString(), play_seq: r.play_seq ?? null, p_home: r.p_home,
    inputs: r.inputs, model_version: MODEL_VERSION.nfl, sport: 'nfl',
  }));
  await sql`
    INSERT INTO winprob_log (match_id, ts, play_seq, p_home, inputs, model_version, sport)
    SELECT ${matchId}, r.ts, r.play_seq, r.p_home, r.inputs, r.model_version, r.sport
      FROM jsonb_to_recordset(${JSON.stringify(recs)}::jsonb) AS r(ts timestamptz, play_seq bigint, p_home float8, inputs jsonb, model_version text, sport text)`;
  return recs.length;
}

/** Remove every row a seed wrote, by match id. */
export async function teardown(sql, matchIds) {
  if (!matchIds.length) return;
  await sql`DELETE FROM winprob_log WHERE match_id = ANY(${matchIds})`;
  await sql`DELETE FROM plays WHERE match_id = ANY(${matchIds})`;
  await sql`DELETE FROM matches WHERE id = ANY(${matchIds})`;
}
