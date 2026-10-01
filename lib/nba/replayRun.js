// lib/nba/replayRun.js - drive the real poller over recorded NBA games, on DEV.
//
// THE REAL PATH, NOT A COPY OF IT: services/live-poller/poll.mjs pollOnce
// with the NBA registry's own hooks (nbaDay, fromNba, nbaDetail +
// writeNbaDetail, nbaKickoff), the StatsTracker cadence the live loop uses,
// syncNbaGameStats and syncNbaLastPlay. Only two things are swapped: fetch
// (lib/nba/replay.js serves the recorded game at the replay instant) and the
// push sender (dispatchFn records the event instead of reaching a device).
//
// SENTINEL ROWS. One match per game, slug `sentinel-nba-replay-<bdl id>`, in
// the real 'nba' league (sportOf must answer basketball, so the slug of the
// LEAGUE has to be 'nba' - a sentinel league would be judged as football), with
// the real teams. Its kickoff_at starts at a PLACEHOLDER four hours early, the
// shape of the 20 Oct opener's, so the replay also proves the tip correction.
// Torn down in finally{}; scripts/dev-orphan-sweep.mjs lists `^sentinel-`
// should a killed run leave one.
//
// DEV ONLY. The caller hands in the sql; this refuses a PROD URL.

import { pollOnce, nbaDay, fromNba, nbaDetail, nbaKickoff, writeNbaDetail } from '../../services/live-poller/poll.mjs';
import { StatsTracker } from '../live/statsCadence.js';
import { shortOf, BASKETBALL } from '../live/vocabulary.js';
import { syncNbaGameStats, syncNbaLastPlay } from './statsSync.js';
import { loadReplay, replayFetch, replaySpan } from './replay.js';

export const SENTINEL_PREFIX = 'sentinel-nba-replay-';
const PLACEHOLDER_MS = 4 * 3600_000;

/**
 * @param sql      a DEV neon client
 * @param ids      recorded game ids (lib/nba/fixtures/replay-<id>.json)
 * @param stepSec  the poll cadence; 30 is the live poller's
 * @param until    (nba-card) stop each game at this replay instant instead of
 *                 its final: a function (fixture) -> ms. At the stop the box
 *                 and the plays are synced once more (the poller's cadence may
 *                 have last run five minutes earlier), so a reader sees the
 *                 game as the poller would have left it at that second.
 * @param keep     (nba-card) leave the sentinel rows in place for a caller
 *                 that reads them (the card's DEV test, the shot seed). The
 *                 CALLER then owns the teardown: dropNbaReplay(sql, ids, { idPrefix }).
 * @param idPrefix (nba-card) a digit string put in front of every recorded
 *                 game id - its provider id AND its sentinel slug - so two
 *                 test files replaying the same recording in parallel (the
 *                 suite runs files as separate processes on one DEV) cannot
 *                 match each other's row: the poller finds a match by its
 *                 bdl_game_id, and two rows with one id would both move.
 * @returns per game: { id, slug, transitions, events, statuses, shorts, kickoffMoved, final, stats, unmapped, polls, calls }
 */
export async function runNbaReplay(sql, ids, { stepSec = 30, log = () => {}, until = null, keep = false, idPrefix = '' } = {}) {
  if (process.env.PROD_DATABASE_URL && process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) {
    throw new Error('runNbaReplay refuses: DATABASE_URL is PROD');
  }
  const [league] = await sql`SELECT id FROM leagues WHERE slug = 'nba'`;
  if (!league) throw new Error('no nba league on this database - run scripts/nba-league-import.mjs --apply (DEV)');
  const fixtures = ids.map((id) => {
    const fx = loadReplay(id);
    return idPrefix ? { ...fx, game: { ...fx.game, id: Number(`${idPrefix}${fx.game.id}`) } } : fx;
  });
  const created = [];
  try {
    for (const fx of fixtures) {
      const g = fx.game;
      const teams = await sql`
        SELECT id, external_ids->>'bdl_team_id' AS pid FROM teams
         WHERE league_id = ${league.id} AND external_ids->>'bdl_team_id' = ANY(${[String(g.home_team.id), String(g.visitor_team.id)]})`;
      const tid = new Map(teams.map((t) => [t.pid, t.id]));
      const placeholder = new Date(Date.parse(g.datetime) - PLACEHOLDER_MS).toISOString();
      const slug = `${SENTINEL_PREFIX}${g.id}`;
      await sql`DELETE FROM matches WHERE slug = ${slug}`;
      const [m] = await sql`
        INSERT INTO matches (league_id, slug, home_team_id, away_team_id, kickoff_at, status,
                             season_year, season_phase, metadata, external_ids, created_at, updated_at)
        VALUES (${league.id}, ${slug}, ${tid.get(String(g.home_team.id))}, ${tid.get(String(g.visitor_team.id))},
                ${placeholder}, 'scheduled', ${g.season}, 'REG', '{}'::jsonb,
                ${JSON.stringify({ bdl_game_id: String(g.id) })}::jsonb, now(), now())
        RETURNING id`;
      created.push(m.id);
    }

    const run = async (fx, matchId) => {
      const { tipAt, endAt } = replaySpan(fx);
      let t = Date.parse(fx.game.datetime) - 20 * 60_000;
      const cut = until ? Number(until(fx)) : null;
      const stop = cut ?? endAt + 5 * 60_000;
      // A CUT IS POLLED EXACTLY: the start is moved back so the last step lands
      // on it, and the row's score is the feed's at that second - the same
      // second the box and the plays are synced to below.
      if (cut != null) t = cut - Math.ceil((cut - t) / (stepSec * 1000)) * stepSec * 1000;
      const fetchImpl = replayFetch([fx], () => t);
      const stats = new StatsTracker();
      const events = []; const statuses = []; const shorts = []; const unmapped = new Set();
      let polls = 0; let livePolls = 0; let calls = 0; let kickoffMoved = null; const tenths = new Set();
      const dispatchFn = async (_sql, { event, state }) => { events.push({ event, period: state?.period ?? null, clock: state?.clock ?? null, home: state?.homeScore, away: state?.awayScore, at: new Date(t).toISOString() }); return { sent: 0, skipped: 0, failed: 0 }; };
      for (; t <= stop; t += stepSec * 1000) {
        const now = new Date(t);
        const r = await pollOnce(sql, {
          league: 'nba', providerKey: 'bdl_game_id',
          fetcher: () => nbaDay(now, { fetchImpl, key: 'replay' })(),
          normalise: fromNba, detail: nbaDetail, writeDetail: writeNbaDetail, kickoffOf: nbaKickoff,
          futureMinutes: 30, now, dispatchFn, log: () => {},
        });
        polls += 1; calls += r.calls;
        for (const u of r.unmapped) unmapped.add(u);
        if (r.kickoffs && kickoffMoved == null) kickoffMoved = now.toISOString();
        const [row] = await sql`SELECT status, home_score, away_score, kickoff_at, metadata->'live_state' AS ls FROM matches WHERE id = ${matchId}`;
        if (statuses.at(-1) !== row.status) statuses.push(row.status);
        const s = row.status === 'live' ? shortOf(row.ls, BASKETBALL) : null;
        if (s && shorts.at(-1) !== s) shorts.push(s);
        if (row.status === 'live') livePolls += 1;
        if (row.status === 'live' && /^\d{1,2}\.\d$/.test(String(row.ls?.clock ?? ''))) tenths.add(`${row.ls.period}/${row.ls.clock}`);
        // THE LIVE LOOP'S BOX CADENCE (services/live-poller/index.mjs): every
        // tenth live poll per live game, and once at the final.
        for (const d of stats.due({ polls: livePolls, matches: [{ id: matchId, status: row.status }] })) {
          const b = await syncNbaGameStats(d.id, { sql, fetchImpl, key: 'replay' });
          const lp = await syncNbaLastPlay(d.id, { sql, fetchImpl, key: 'replay' });
          calls += b.calls + lp.calls;
        }
        if (row.status === 'final' && t > endAt) break;
      }
      if (cut != null) {
        const tc = t;
        t = cut;
        const b = await syncNbaGameStats(matchId, { sql, fetchImpl, key: 'replay' });
        const lp = await syncNbaLastPlay(matchId, { sql, fetchImpl, key: 'replay' });
        calls += b.calls + lp.calls;
        t = tc;
      }
      const [fin] = await sql`
        SELECT status, home_score, away_score, kickoff_at, metadata FROM matches WHERE id = ${matchId}`;
      const box = await sql`
        SELECT s.team_id, sum(s.pts)::int AS pts, count(*)::int AS n, count(*) FILTER (WHERE s.dnp)::int AS dnp
          FROM nba_player_game_stats s WHERE s.match_id = ${matchId} GROUP BY s.team_id`;
      const [mt] = await sql`SELECT home_team_id, away_team_id FROM matches WHERE id = ${matchId}`;
      const ptsOf = (tid) => box.find((b) => b.team_id === tid)?.pts ?? null;
      return {
        id: String(fx.game.id), matchId,
        label: `${fx.game.visitor_team.abbreviation}@${fx.game.home_team.abbreviation} ${fx.game.visitor_team_score}-${fx.game.home_team_score}${fx.game.period > 4 ? ' OT' : ''}`,
        tipAt: new Date(tipAt).toISOString(), recordedFinal: { home: fx.game.home_team_score, away: fx.game.visitor_team_score },
        polls, livePolls, calls, statuses, shorts, events, tenths: [...tenths], unmapped: [...unmapped], kickoffMoved,
        kickoffAt: new Date(fin.kickoff_at).toISOString(), scheduledTip: new Date(fx.game.datetime).toISOString(),
        final: { status: fin.status, home: fin.home_score, away: fin.away_score,
          finalSeenAt: fin.metadata?.detail?.final_seen_at ?? null,
          lineScore: fin.metadata?.detail?.line_score ?? null,
          lastPlay: fin.metadata?.detail?.last_play ?? null,
          liveState: fin.metadata?.live_state ?? null },
        stats: { rows: box.reduce((a, b) => a + b.n, 0), dnp: box.reduce((a, b) => a + b.dnp, 0),
          homePts: ptsOf(mt.home_team_id), awayPts: ptsOf(mt.away_team_id), recordedRows: fx.stats.length },
      };
    };
    // THE GAMES RUN SIDE BY SIDE: each is on a different day, so no poll of one
    // can see another's row (the candidate window is kickoff -8h..+30m).
    return await Promise.all(fixtures.map((fx, i) => run(fx, created[i])));
  } finally {
    if (created.length && !keep) await sql`DELETE FROM matches WHERE id = ANY(${created})`;
  }
}

/** The teardown a `keep` caller owns: every sentinel replay match for these ids. Returns the count left (0). */
export async function dropNbaReplay(sql, ids, { idPrefix = '' } = {}) {
  const slugs = ids.map((id) => `${SENTINEL_PREFIX}${idPrefix}${id}`);
  await sql`DELETE FROM matches WHERE slug = ANY(${slugs})`;
  const [r] = await sql`SELECT count(*)::int AS n FROM matches WHERE slug = ANY(${slugs})`;
  return r.n;
}
