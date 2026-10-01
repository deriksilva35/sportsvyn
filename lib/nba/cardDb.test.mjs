// lib/nba/cardDb.test.mjs - the NBA card and game page READ FROM DEV, after the
// REAL poller path wrote the rows (nba-card, thu-37).
//
// The OT game (18447720 GSW@HOU 115-113) is driven through pollOnce by the
// replay harness (lib/nba/replayRun.js) twice: stopped at Q4 2:38 with GSW in
// the bonus, then to its final. After each stop the readers the page and the
// board use are run against what the poller left:
//   the plays the poller stored (`plays`, one statement, idempotent)
//   getNbaGame / nbaGameView - card extras, line, last play, plays list, chips
//   nbaInYourGames - a sentinel reader's pick on a sentinel day board
//   scoresV2 - the live card's extras and line on /scores
//
// DEV WRITES, all torn down in after() and the teardown ASSERTED: the replay's
// sentinel match (sentinel-nba-replay-18447720; plays + box cascade), one
// day-board contest marked meta.sentinel, its entry, one sentinel user. If DEV
// has no nba league, before() creates it with the real import's writers, the
// replay test's own costed repair (one BDL call, 30 idempotent upserts).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { neon } from '@neondatabase/serverless';
import { runNbaReplay, dropNbaReplay } from './replayRun.js';
import { REPLAY_GAMES, loadReplay } from './replay.js';
import { fetchNbaTeams, upsertNbaLeague, upsertNbaTeams } from './sync.js';
import { syncNbaColors } from './teamColors.js';
import { syncNbaLastPlay } from './statsSync.js';
import { replayFetch } from './replay.js';
import { getNbaGame, nbaPlays } from './gameDetail.js';
import { nbaGameView } from './gamePageView.js';
import { nbaInYourGames } from './yours.js';
import { dayKey } from './dayPickem.js';
import { scoresV2 } from '../gridiron/scoresV2.js';

const sql = neon(process.env.DATABASE_URL);
if (process.env.PROD_DATABASE_URL && process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) {
  throw new Error('cardDb.test refuses to run against PROD');
}

const ID = REPLAY_GAMES.ot;
const SLUG = `sentinel-nba-replay-${ID}`;
const EMAIL = 'sentinel-nba-card@sportsvyn.test';
const CUT = Date.parse('2026-03-06T02:48:50Z'); // Q4 2:38, GSW 95-93, GSW in the bonus
const DAY = '2026-03-05';
let uid = null;

async function dropBoard() {
  const cs = await sql`SELECT id FROM contests WHERE game_type = 'pickem' AND sport = 'nba' AND meta->>'sentinel' = 'nba-card'`;
  for (const c of cs) {
    await sql`DELETE FROM contest_entries WHERE contest_id = ${c.id}`;
    await sql`DELETE FROM contests WHERE id = ${c.id}`;
  }
}

/** A day board holding the replay match, and the sentinel reader's pick on it (GSW, the away side). */
async function seedBoard() {
  await dropBoard();
  const [m] = await sql`SELECT id, kickoff_at, home_team_id, away_team_id FROM matches WHERE slug = ${SLUG}`;
  const clash = await sql`SELECT id FROM contests WHERE game_type = 'pickem' AND sport = 'nba' AND season_year = 2025 AND week = ${dayKey(DAY)}`;
  assert.equal(clash.length, 0, 'a real day board already holds this key on DEV - refusing to touch it');
  const board = [{ match_id: m.id, slug: SLUG, kickoff_at: new Date(m.kickoff_at).toISOString(), home_team_id: m.home_team_id, away_team_id: m.away_team_id, home: 'Rockets', away: 'Warriors' }];
  const [c] = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at, meta)
    VALUES ('pickem', 'nba', 2025, ${dayKey(DAY)}, ${JSON.stringify(board)}::jsonb, '2026-03-05T11:00:00Z', ${m.kickoff_at}, ${m.kickoff_at},
            ${JSON.stringify({ day_board: true, day_et: DAY, sentinel: 'nba-card' })}::jsonb)
    RETURNING id`;
  await sql`INSERT INTO contest_entries (contest_id, user_id, lineup) VALUES (${c.id}, ${uid}, ${JSON.stringify({ [m.id]: 'away' })}::jsonb)`;
  return m.id;
}

before(async () => {
  const [l] = await sql`SELECT id FROM leagues WHERE slug = 'nba'`;
  const n = l ? (await sql`SELECT count(*)::int AS n FROM teams WHERE league_id = ${l.id}`)[0].n : 0;
  if (n !== 30) {
    const id = await upsertNbaLeague(sql);
    await upsertNbaTeams(sql, id, await fetchNbaTeams());
    await syncNbaColors(sql, id);
  }
  await sql`DELETE FROM users WHERE email = ${EMAIL}`;
  [{ id: uid }] = await sql`INSERT INTO users (email, handle) VALUES (${EMAIL}, 'sentinelnbacard') RETURNING id`;
});

after(async () => {
  await dropBoard();
  const left = await dropNbaReplay(sql, [ID]);
  await sql`DELETE FROM contest_entries WHERE user_id = ${uid}`;
  await sql`DELETE FROM users WHERE email = ${EMAIL}`;
  const [u] = await sql`SELECT count(*)::int AS n FROM users WHERE email = ${EMAIL}`;
  const [c] = await sql`SELECT count(*)::int AS n FROM contests WHERE meta->>'sentinel' = 'nba-card'`;
  assert.deepEqual({ matches: left, users: u.n, contests: c.n }, { matches: 0, users: 0, contests: 0 }, 'teardown');
});

test('LIVE, Q4 2:38: the poller stored the plays; the page and the board read the bonus, the line, the last play, the list', async () => {
  const [r] = await runNbaReplay(sql, [ID], { stepSec: 60, keep: true, until: () => CUT });
  assert.equal(r.final.status, 'live');
  const matchId = await seedBoard();

  // THE PLAYS: the poller's /plays call wrote every play up to the cut.
  const fx = loadReplay(ID);
  const upTo = fx.plays.filter((p) => Date.parse(p.wallclock) <= CUT);
  const [{ n, teams }] = await sql`SELECT count(*)::int AS n, count(offense_team_id)::int AS teams FROM plays WHERE match_id = ${matchId}`;
  assert.equal(n, upTo.length, 'one row per play up to the cut');
  assert.equal(teams, upTo.filter((p) => p.team?.abbreviation).length, 'every team play resolved to its team');
  // IDEMPOTENT: the same call again writes nothing (only the last play's detail is re-checked).
  const again = await syncNbaLastPlay(matchId, { sql, fetchImpl: replayFetch([fx], () => CUT), key: 'replay' });
  assert.equal(again.plays, 0, 'a re-read rewrites no play');

  const game = await getNbaGame(SLUG);
  assert.equal(game.status, 'live');
  assert.deepEqual(game.detail.bonus, { home: false, away: true });
  const view = await nbaGameView({ game, viewerId: uid, now: new Date('2026-03-06T02:49:00Z') });
  assert.deepEqual(view.modules, ['card', 'yours', 'chips']);
  assert.deepEqual(view.x.nba.bonus, { home: false, away: true });
  assert.ok(view.x.nba.timeouts && Number.isInteger(view.x.nba.timeouts.home));
  assert.deepEqual(view.x.line.columns, ['1', '2', '3', '4']);
  assert.equal(view.x.lastPlay, 'Brandin Podziemski makes free throw 2 of 2');
  assert.match(view.x.nba.perf, /^\S+ \d+ pts · \S+ \d+$/);
  assert.equal(view.plays.latest[0].text, 'Brandin Podziemski makes free throw 2 of 2');
  assert.equal(view.plays.latest[0].score, '95-93');
  assert.equal(view.plays.total, upTo.filter((p) => p.type !== 'Substitution').length, 'All plays · N counts no substitutions');
  assert.deepEqual(view.chips.map((c) => c.label), ['Plays', 'Box', 'Leaders'], 'no Market: no NBA line exists');
  assert.equal(view.winprob, null);
  assert.deepEqual(view.yours.rows.map((y) => [y.line, y.value]), [['You have GSW', 'leading by 2']]);

  // THE BOARD: the live game rides /scores' Live group with the same extras.
  const v = await scoresV2({ sport: 'nba', now: new Date() });
  const x = v.extras.get(matchId);
  assert.ok(x, 'a live game is on the board whatever its date');
  assert.deepEqual(x.nba.bonus, { home: false, away: true });
  assert.equal(x.nba.perf, view.x.nba.perf);
  assert.equal(v.nbaPickem, null, 'no NBA board today on DEV: no strip');
});

test('FINAL, OT: Final · OT period, leaders, team stats, the box; In your games settled', async () => {
  const [r] = await runNbaReplay(sql, [ID], { stepSec: 120, keep: true });
  assert.equal(r.final.status, 'final');
  await seedBoard();
  const game = await getNbaGame(SLUG);
  const view = await nbaGameView({ game, viewerId: uid });
  assert.equal(view.x.nba.finalPeriod, 5);
  assert.deepEqual(view.x.line.columns, ['1', '2', '3', '4', 'OT']);
  assert.equal(view.x.nba.bonus, null, 'no bonus on a final');
  assert.match(view.x.nba.perf, /^\S+ \d+ pts/);
  assert.deepEqual(view.modules, ['card', 'yours', 'leaders', 'teamstats', 'fullbox']);
  assert.deepEqual(view.leaders.map((l) => l.cat), ['PTS', 'REB', 'AST']);
  const ids = [game.home.id, game.away.id];
  for (const id of ids) assert.match(String(view.teamBox[id]['FG%']), /^\.\d{3}$/);
  assert.equal(view.yours.rows[0].value, 'Won · 1 of 1 tonight', 'GSW won 115-113');
  const plays = await nbaPlays(game.id, { all: true });
  assert.equal(plays.latest.at(-1).playNumber, 1);
  const boxOpen = await nbaGameView({ game, viewerId: null, boxOpen: true });
  assert.deepEqual(boxOpen.modules, ['card', 'leaders', 'teamstats', 'box']);
  assert.equal(boxOpen.yours.rows.length, 0, 'signed out: no rows');
});
