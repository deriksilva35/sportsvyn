// lib/weekly/replay.test.mjs - THE SETTLEMENT REPLAY HARNESS.
//
// Ruled 17 Aug as the gate on The Draft's build: both settlement paths run
// end to end against a synthetic week built from REAL 2025 Week 1 data, with
// fixture entries for both games, before a second game depends on the shared
// job.
//
// WHY A REPLAY AND NOT MORE UNIT TESTS. The unit tests prove each verdict in
// isolation. What they cannot prove is that the whole chain - board, entries,
// stats, scoring, perfect lineup, tiers, standings - produces a coherent
// RESULT, or that the refusal path leaves the world exactly as it found it.
// The only honest way to know is to run it and read the numbers.
//
// 2025 WEEK 1 IS REAL. Every stat line, every score and the perfect lineup all
// come from games that were actually played. A fixture week would agree with
// itself no matter what the code did.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const { sql } = await import('../db.js');
const { settleContest, settleDue, poolWithScores } = await import('./settle.js');
const { weekScores } = await import('./pool.js');
const { tierFor } = await import('../daily/reveal.js');
const { seasonStandings } = await import('../daily/standings.js');

// A season nobody uses, so the harness can never collide with real contests.
const SEASON = 2091;
const WEEK = 1;

// A SPORT NOBODY USES, AND THIS ONE IS NOT BELT-AND-BRACES - it is the fix for
// a real flake. settleDue() filters on (game_type, sport, NOT settled,
// locks_at < now) and DELIBERATELY NOT on season: it is meant to sweep every
// due contest. So a sentinel SEASON isolates our rows from production data but
// not from another test file - weeklyDb.test.mjs also creates due weekly
// contests, on 2097/2099, also sport 'nfl'. Run in parallel by node --test,
// each file's settleDue swept up the other's contests and both files failed
// intermittently while passing alone.
//
// sport is the one scoping dimension settleDue honours, and it is used NOWHERE
// else in the settle path, so claiming our own value isolates this file
// completely - and incidentally covers the sport filter, which nothing did.
const SPORT = 'nfl-replay-fixture';
const EMAILS = ['replay-a@example.invalid', 'replay-b@example.invalid', 'replay-c@example.invalid'];
const PAST = new Date(Date.now() - 86_400_000).toISOString();

let users = [];
let pool = [];
let fixtureMatches = [];
let weeklyId = null;
let draftId = null;

/** Clone 2025 week 1 into SEASON/WEEK so the harness owns its own games. */
// `week` is a parameter for the same reason mkContest's is: this file now needs
// a SECOND scoreable week, because the abandonment case cannot share a contest
// key with the end-to-end one and a contest without games settles as "no games"
// rather than exercising anything.
async function buildSyntheticWeek({ withStatsFor = null, week = WEEK } = {}) {
  const src = await sql`
    SELECT m.id, m.league_id, m.home_team_id, m.away_team_id, m.kickoff_at,
           m.home_score, m.away_score
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug='nfl' AND m.season_year=2025 AND m.season_phase='REG' AND m.week=1
     ORDER BY m.id`;

  const made = [];
  for (const [i, g] of src.entries()) {
    const r = await sql`
      INSERT INTO matches (league_id, season_year, season_phase, week, kickoff_at, status,
                           home_team_id, away_team_id, home_score, away_score, slug)
      VALUES (${g.league_id}, ${SEASON}, 'REG', ${week}, ${g.kickoff_at}, 'final',
              ${g.home_team_id}, ${g.away_team_id}, ${g.home_score}, ${g.away_score},
              ${`replay-${SEASON}-${week}-${i}`})
      RETURNING id`;
    made.push({ id: r[0].id, srcId: g.id });
  }

  // Copy the real stat lines across. `withStatsFor` lets a test withhold one
  // game's numbers - which is the whole point of the negative control.
  const allow = withStatsFor ?? made.map((m) => m.srcId);
  for (const m of made) {
    if (!allow.includes(m.srcId)) continue;
    await sql`
      INSERT INTO nfl_player_game_stats
        (match_id, nfl_player_id, team_id, pass_cmp, pass_att, pass_yds, pass_td, pass_int,
         rush_att, rush_yds, rush_td, tgt, rec, rec_yds, rec_td, fumbles_lost, fgm, fga, fg_long, xp)
      SELECT ${m.id}, s.nfl_player_id, s.team_id, s.pass_cmp, s.pass_att, s.pass_yds, s.pass_td,
             s.pass_int, s.rush_att, s.rush_yds, s.rush_td, s.tgt, s.rec, s.rec_yds, s.rec_td,
             s.fumbles_lost, s.fgm, s.fga, s.fg_long, s.xp
        FROM nfl_player_game_stats s WHERE s.match_id = ${m.srcId}`;
  }
  return made;
}

// `week` is a parameter because the unique index is (game_type, sport, season,
// week) and this file now creates more than one contest of the same type - the
// abandonment case needs its own, or it collides with the end-to-end one.
// `sport` defaults to the sentinel, but is a PARAMETER because one test reads
// its contest back through draftState(), and currentDraftContest() hardcodes
// sport='nfl' - a sentinel sport there makes the contest invisible to the very
// function under test. Only the contests that settleDue sweeps need isolating.
async function mkContest(gameType, board, week = WEEK, sport = SPORT) {
  const r = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at)
    VALUES (${gameType}, ${sport}, ${SEASON}, ${week}, ${JSON.stringify(board)}::jsonb, ${PAST}, ${PAST})
    RETURNING id`;
  return r[0].id;
}

async function wipe() {
  await sql`DELETE FROM contest_entries WHERE contest_id IN (
    SELECT id FROM contests WHERE season_year = ${SEASON})`;
  await sql`DELETE FROM contests WHERE season_year = ${SEASON}`;
  await sql`DELETE FROM nfl_player_game_stats WHERE match_id IN (
    SELECT id FROM matches WHERE season_year = ${SEASON})`;
  await sql`DELETE FROM matches WHERE season_year = ${SEASON}`;
}

before(async () => {
  await wipe();
  for (const e of EMAILS) {
    const r = await sql`INSERT INTO users (email) VALUES (${e})
      ON CONFLICT DO NOTHING RETURNING id`;
    users.push(r[0]?.id ?? (await sql`SELECT id FROM users WHERE email=${e}`)[0].id);
  }
  // A real pool: every rostered skill player, ids that resolve to stats.
  pool = (await sql`
    SELECT np.id, np.full_name AS name, np.position AS pos
      FROM nfl_players np JOIN teams t ON t.id = np.team_id
     WHERE np.position = ANY(ARRAY['QB','RB','WR','TE']) AND np.is_team_defense IS NOT TRUE`)
    .map((r) => ({ id: r.id, name: r.name, pos: r.pos }));
});

after(async () => {
  await wipe();
  await sql`DELETE FROM users WHERE email = ANY(${EMAILS})`;
});

const lineupFrom = (scored, offset = 0) => {
  const byPos = (p) => scored.filter((x) => x.pos === p).sort((a, b) => b.points - a.points);
  const qb = byPos('QB')[offset]; const rbs = byPos('RB').slice(offset, offset + 2);
  const wrs = byPos('WR').slice(offset, offset + 2); const te = byPos('TE')[offset];
  return { QB: qb.id, RB: rbs[0].id, WR: wrs[0].id, TE: te.id, FLEX: rbs[1].id, FLEX2: wrs[1].id };
};

// ---------------------------------------------------------------------------
// THE FULL REPLAY
// ---------------------------------------------------------------------------

test('REPLAY: both games settle end to end on a real week, and the numbers cohere', async () => {
  fixtureMatches = await buildSyntheticWeek();
  const scored = poolWithScores(pool, await weekScores(SEASON, WEEK));
  assert.ok(scored.some((p) => p.points > 20), 'the synthetic week carries real scores');

  weeklyId = await mkContest('weekly', pool);
  draftId = await mkContest('draft', pool);
  assert.notEqual(weeklyId, draftId, 'two game types coexist for one week');

  // Three entries per game: a strong lineup, a weaker one, and a DNF.
  for (const [i, uid] of users.entries()) {
    for (const cid of [weeklyId, draftId]) {
      const lu = i === 2 ? (() => { const l = lineupFrom(scored, 0); delete l.FLEX2; return l; })()
        : lineupFrom(scored, i * 3);
      await sql`INSERT INTO contest_entries (contest_id, user_id, lineup)
        VALUES (${cid}, ${uid}, ${JSON.stringify(lu)}::jsonb)`;
    }
  }

  const w = await settleContest(weeklyId);
  const d = await settleContest(draftId);

  for (const [label, r] of [['weekly', w], ['draft', d]]) {
    assert.equal(r.settled, true, `${label}: ${JSON.stringify(r)}`);
    assert.equal(r.entries, 2, `${label}: two scored entries`);
    assert.equal(r.dnf, 1, `${label}: one DNF`);
    assert.ok(r.perfect > 0, `${label}: a perfect lineup`);
  }
  // TWO DIFFERENT YARDSTICKS, ON PURPOSE (relay D1's ceiling ruling). The
  // Weekly's ceiling is a THEORETICAL best-six from the whole shared pool;
  // the Draft's is whoever's REAL roster scored highest, and a real
  // best-ball six drawn from one eight-player roster can never beat the
  // unconstrained optimum over the entire pool - so d.perfect <= w.perfect
  // always, never equal by coincidence of "same week, same pool" the way
  // the old shared perfectLineup() computation made them.
  assert.ok(Number(d.perfect) <= Number(w.perfect), 'a real best-ball six cannot beat the theoretical optimum');

  // THE DRAFT'S CEILING NAMES A REAL ENTRY - entry_id/user_id/seat, not a
  // picks list (there is no shared pool to build one from).
  const [draftContestRow] = await sql`SELECT perfect FROM contests WHERE id = ${draftId}`;
  const draftCeiling = draftContestRow.perfect;
  assert.ok(draftCeiling.entry_id != null, 'draft ceiling names the winning entry');
  assert.ok(draftCeiling.user_id != null, 'draft ceiling names the winning user');
  const [topDraftEntry] = await sql`
    SELECT id, user_id, score FROM contest_entries
     WHERE contest_id = ${draftId} AND score IS NOT NULL
     ORDER BY score DESC, user_id ASC LIMIT 1`;
  assert.equal(draftCeiling.entry_id, topDraftEntry.id, 'the ceiling really is the top-scoring real entry');
  assert.equal(draftCeiling.user_id, topDraftEntry.user_id);
  assert.equal(Number(draftCeiling.score), Number(topDraftEntry.score));

  // PCT IS STORED PER ENTRY, frozen against the ceiling written in this same
  // settle - not recomputed later against a ceiling that could drift.
  const draftEntryMetas = await sql`SELECT score, meta FROM contest_entries WHERE contest_id = ${draftId} AND score IS NOT NULL`;
  for (const e of draftEntryMetas) {
    const expectedPct = Math.round((Number(e.score) / Number(draftCeiling.score)) * 1000) / 10;
    assert.equal(Number(e.meta.pct), expectedPct, 'entry.meta.pct = score / ceiling.score, exactly');
  }

  // SCORES COHERE: strongest lineup beats the weaker one, both under perfect.
  const rows = await sql`
    SELECT user_id, score, meta FROM contest_entries WHERE contest_id=${weeklyId} ORDER BY user_id`;
  const scores = rows.filter((r) => r.score != null).map((r) => Number(r.score));
  assert.ok(scores[0] > scores[1], 'the better lineup scores higher');
  for (const s of scores) assert.ok(s <= w.perfect, `no entry may beat the perfect lineup (${s} vs ${w.perfect})`);

  // TIERS resolve off the same yardstick both games use.
  const t = tierFor(scores[0], w.perfect);
  assert.ok(t?.label, 'a tier resolves');
  assert.ok(t.pct > 0 && t.pct <= 100);

  // STANDINGS take the settled rows without knowing which game made them.
  const table = seasonStandings(rows.filter((r) => r.score != null).map((r) => ({
    userId: r.user_id, tier: tierFor(r.score, w.perfect)?.label, score: Number(r.score), perfect: w.perfect,
  })), 1);
  assert.equal(table.length, 2);
  assert.ok(table[0].points >= table[1].points, 'ranked by tier points');
  assert.equal(table[0].rank, 1);
});

test('REPLAY: the second pass is IDEMPOTENT - nothing recomputes', async () => {
  const before2 = await sql`SELECT user_id, score FROM contest_entries
     WHERE contest_id=${weeklyId} ORDER BY user_id`;
  const again = await settleContest(weeklyId);
  assert.equal(again.settled, false);
  assert.equal(again.alreadySettled, true);
  const after2 = await sql`SELECT user_id, score FROM contest_entries
     WHERE contest_id=${weeklyId} ORDER BY user_id`;
  assert.deepEqual(after2, before2, 'scores are byte-identical after a second pass');
});

// ---------------------------------------------------------------------------
// NEGATIVE CONTROL 1 - a withheld game
// ---------------------------------------------------------------------------

test('REPLAY: one game\'s stats withheld -> REFUSES, names the gap, changes nothing', async () => {
  await wipe();
  const src = await sql`
    SELECT m.id FROM matches m JOIN leagues l ON l.id=m.league_id
     WHERE l.slug='nfl' AND m.season_year=2025 AND m.season_phase='REG' AND m.week=1
     ORDER BY m.id`;
  const withheld = src[0].id;
  await buildSyntheticWeek({ withStatsFor: src.slice(1).map((x) => x.id) });

  const cid = await mkContest('weekly', pool);
  await sql`INSERT INTO contest_entries (contest_id, user_id, lineup)
    VALUES (${cid}, ${users[0]}, '{}'::jsonb)`;

  const r = await settleContest(cid);
  assert.equal(r.settled, false, 'must not settle on a hole');
  assert.equal(r.reason, 'stat lines missing');
  assert.equal(r.missing.length, 1, 'exactly the one game');
  assert.ok(r.missing[0].label, 'and it is NAMED');
  assert.equal(r.missing[0].why, 'final, no stat lines');

  const c = (await sql`SELECT settled, perfect FROM contests WHERE id=${cid}`)[0];
  assert.equal(c.settled, false, 'the contest is untouched');
  assert.equal(c.perfect, null, 'no perfect lineup was written');
  const e = (await sql`SELECT score FROM contest_entries WHERE contest_id=${cid}`)[0];
  assert.equal(e.score, null, 'and no entry was scored');
  return withheld;
});

// ---------------------------------------------------------------------------
// NEGATIVE CONTROL 2 - partial, then complete
// ---------------------------------------------------------------------------

test('REPLAY: partial-then-complete settles ONCE, correctly, on the second pass', async () => {
  await wipe();
  const src = await sql`
    SELECT m.id FROM matches m JOIN leagues l ON l.id=m.league_id
     WHERE l.slug='nfl' AND m.season_year=2025 AND m.season_phase='REG' AND m.week=1
     ORDER BY m.id`;
  const late = src[0].id;
  const made = await buildSyntheticWeek({ withStatsFor: src.slice(1).map((x) => x.id) });

  const cid = await mkContest('weekly', pool);
  const lineup = lineupFrom(poolWithScores(pool, await weekScores(SEASON, WEEK)), 0);
  await sql`INSERT INTO contest_entries (contest_id, user_id, lineup)
    VALUES (${cid}, ${users[0]}, ${JSON.stringify(lineup)}::jsonb)`;

  // PASS 1: the late game's numbers have not landed.
  const p1 = await settleContest(cid);
  assert.equal(p1.settled, false);
  assert.equal(p1.reason, 'stat lines missing');

  // The late feed arrives.
  const target = made.find((m) => m.srcId === late);
  await sql`
    INSERT INTO nfl_player_game_stats
      (match_id, nfl_player_id, team_id, pass_cmp, pass_att, pass_yds, pass_td, pass_int,
       rush_att, rush_yds, rush_td, tgt, rec, rec_yds, rec_td, fumbles_lost, fgm, fga, fg_long, xp)
    SELECT ${target.id}, s.nfl_player_id, s.team_id, s.pass_cmp, s.pass_att, s.pass_yds, s.pass_td,
           s.pass_int, s.rush_att, s.rush_yds, s.rush_td, s.tgt, s.rec, s.rec_yds, s.rec_td,
           s.fumbles_lost, s.fgm, s.fga, s.fg_long, s.xp
      FROM nfl_player_game_stats s WHERE s.match_id = ${late}`;

  // PASS 2: complete.
  const p2 = await settleContest(cid);
  assert.equal(p2.settled, true, JSON.stringify(p2));
  assert.equal(p2.entries, 1);

  // THE PERFECT LINEUP MUST INCLUDE THE LATE GAME. If pass 1 had settled, the
  // yardstick would be permanently short by whatever that game produced - the
  // exact silent error the gate exists to stop.
  const full = poolWithScores(pool, await weekScores(SEASON, WEEK));
  const bestPossible = Math.max(...full.map((p) => p.points));
  assert.ok(p2.perfect >= bestPossible, 'the perfect lineup saw the whole week');

  // PASS 3: idempotent.
  const p3 = await settleContest(cid);
  assert.equal(p3.settled, false);
  assert.equal(p3.alreadySettled, true);
});

// ---------------------------------------------------------------------------
// THE STAGGER
// ---------------------------------------------------------------------------

test('REPLAY: settleDue is scoped by game_type and shares no state between games', async () => {
  await wipe();
  await buildSyntheticWeek();
  const wId = await mkContest('weekly', pool);
  const dId = await mkContest('draft', pool);
  const scored = poolWithScores(pool, await weekScores(SEASON, WEEK));
  for (const cid of [wId, dId]) {
    await sql`INSERT INTO contest_entries (contest_id, user_id, lineup)
      VALUES (${cid}, ${users[0]}, ${JSON.stringify(lineupFrom(scored, 0))}::jsonb)`;
  }

  const w = await settleDue('weekly', { sport: SPORT });
  assert.equal(w.settled, 1);
  assert.equal(w.results.every((r) => r.contestId !== dId), true, 'the weekly run never touched the draft');
  const draftStill = (await sql`SELECT settled FROM contests WHERE id=${dId}`)[0];
  assert.equal(draftStill.settled, false, 'the draft is still unsettled an hour before its own run');

  const d = await settleDue('draft', { sport: SPORT });
  assert.equal(d.settled, 1);
  const bothDone = await sql`SELECT settled FROM contests WHERE id = ANY(${[wId, dId]})`;
  assert.equal(bothDone.every((r) => r.settled), true);
});

test('REPLAY: one contest failing does not stop the others in the same run', async () => {
  await wipe();
  await buildSyntheticWeek();
  const good = await mkContest('weekly', pool);
  // A contest for a week with no games at all: settleDue must report it and
  // carry on rather than throwing the whole run away.
  const bad = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at)
    VALUES ('weekly',${SPORT},${SEASON}, 99, ${JSON.stringify(pool)}::jsonb, ${PAST}, ${PAST})
    RETURNING id`;
  const r = await settleDue('weekly', { sport: SPORT });
  assert.equal(r.considered, 2);
  assert.equal(r.settled, 1, 'the good one settled');
  const badResult = r.results.find((x) => x.contestId === bad[0].id);
  assert.equal(badResult.settled, false);
  assert.equal(badResult.reason, 'no games');
});

// ---------------------------------------------------------------------------
// THE DRAFT'S OWN PATH: roster -> best ball -> score
// ---------------------------------------------------------------------------
// The test above seeds draft entries with a LINEUP, which exercises the
// fallback. This exercises what ranked play actually produces: an entry whose
// meta carries a ROSTER and no lineup at all, which settlement must convert.

test('REPLAY: a ranked DRAFT entry settles from its roster, best six counted', async () => {
  const scored = poolWithScores(pool, await weekScores(SEASON, WEEK));
  const uid = users[0];
  const cid = await mkContest('draft', pool);

  // A roster of nine: enough to field a legal six with three left on the bench.
  const pick = (pos, n) => scored.filter((p) => p.pos === pos).sort((a, b) => b.points - a.points).slice(0, n);
  const roster = [
    ...pick('QB', 1), ...pick('RB', 3), ...pick('WR', 3), ...pick('TE', 2),
  ].map((p, i) => ({ id: p.id, name: p.name, pos: p.pos, round: i + 1 }));

  await sql`INSERT INTO contest_entries (contest_id, user_id, lineup, meta)
    VALUES (${cid}, ${uid}, '{}'::jsonb, ${JSON.stringify({ roster })}::jsonb)`;

  const r = await settleContest(cid);
  assert.equal(r.settled, true, JSON.stringify(r));
  assert.equal(r.entries, 1, 'the roster entry scored rather than DNF-ing');

  const row = (await sql`SELECT score, lineup, meta FROM contest_entries
    WHERE contest_id=${cid} AND user_id=${uid}`)[0];
  assert.ok(Number(row.score) > 0, 'a real score');

  // THE LINEUP WAS WRITTEN BACK, so the reveal can show which six started and a
  // replay of this settle produces the same six.
  assert.equal(Object.keys(row.lineup).length, 6, 'best ball filled all six slots');
  const started = new Set(Object.values(row.lineup).map(String));
  assert.equal(started.size, 6, 'no player fills two slots');
  for (const id of started) {
    assert.ok(roster.some((p) => String(p.id) === id), 'every starter came from the roster');
  }

  // BEST BALL MEANS BEST, and the comparison has to respect ELIGIBILITY. The
  // first version of this asserted that no benched player outscored the worst
  // flex-eligible STARTER, and it failed on a 24.4 running back benched behind
  // a 15.6 tight end - correctly, because that back could never have taken the
  // mandatory TE slot. The only slots a benched RB/WR/TE could have taken are
  // the two FLEX ones, so those are what it must be measured against.
  //
  // Global optimality is proved by brute force in lib/draft/bestball.test.mjs;
  // this is the sanity check that the DB path runs the same rule.
  const byId = new Map(scored.map((p) => [String(p.id), p]));
  const bench = roster.filter((p) => !started.has(String(p.id)));
  const flexFloor = Math.min(
    byId.get(String(row.lineup.FLEX)).points,
    byId.get(String(row.lineup.FLEX2)).points,
  );
  for (const b of bench) {
    if (!['RB', 'WR', 'TE'].includes(b.pos)) continue;
    assert.ok(byId.get(String(b.id)).points <= flexFloor,
      `benched ${b.name} (${byId.get(String(b.id)).points}) beat a FLEX starter (${flexFloor})`);
  }
  assert.ok(Number(row.score) <= r.perfect, 'no entry may beat the perfect lineup');
});

// ---------------------------------------------------------------------------
// ABANDONMENT AUTO-COMPLETES
// ---------------------------------------------------------------------------
// RULED: an abandoned ranked room has its remaining picks filled by the
// engine's best-available under canRoster, then bridges and settles on its
// merits. START IS CONSUMED protects the entry's reality, not its punishment -
// picks made count, picks unmade fill mechanically, and abandonment stays
// strictly dominated by playing because BPA is never better than an engaged
// player's pick.

test('REPLAY: a 5-pick abandonment auto-completes, bridges 8/8 and scores', async () => {
  const { DRAFT_CONFIG, DRAFT_ROUNDS } = await import('../draft/contest.js');
  const { autoCompleteDraftFor, getPoolAt } = await import('../fantasy/drafts.js');
  const { bridgeContestRosters, claimEntry } = await import('../draft/entry.js');

  const uid = users[0];
  // Its own week, with its own games: the contest key is unique per
  // (game_type, season, week) and a week with no games settles as "no games".
  await buildSyntheticWeek({ week: WEEK + 1 });
  const cid = await mkContest('draft', pool, WEEK + 1);

  // THE FFC SNAPSHOT, BY NAME (083). The pool table also holds Fantrax league
  // snapshots now, dated the day they import - newer than FFC's. An unscoped
  // max(snapshot_date) picked that date, and a draft frozen at it with
  // pool_source 'ffc' read an empty pool: "the prefix must be legal" failed at
  // pick 1 the morning after the first import. The room is FFC-fed; say so.
  // A ranked room in the Weekly Six shape, abandoned after five user picks.
  const cfg = (await sql`
    INSERT INTO draft_configs (user_id, name, teams_count, scoring_format, roster_slots,
                               pick_timer_seconds, is_preset, source)
    VALUES (${uid}, 'replay ranked', ${DRAFT_CONFIG.teamsCount}, ${DRAFT_CONFIG.scoringFormat},
            ${JSON.stringify(DRAFT_CONFIG.rosterSlots)}::jsonb, ${DRAFT_CONFIG.clockSeconds},
            false, 'manual') RETURNING id`)[0];
  const snap = (await sql`SELECT max(snapshot_date) d FROM sim_player_pool WHERE source = 'ffc'`)[0].d;
  const draft = (await sql`
    INSERT INTO drafts (user_id, config_id, status, pick_position, is_auto,
                        pool_snapshot_date, pool_scoring_format, pool_teams_count, started_at, mode)
    VALUES (${uid}, ${cfg.id}, 'in_progress', 1, false, ${snap},
            ${DRAFT_CONFIG.scoringFormat}, ${DRAFT_CONFIG.teamsCount}, now(), 'sim')
    RETURNING id`)[0];
  await claimEntry(cid, uid, draft.id);

  // Seat 1 picks first every odd round, so overall picks 1 and 24 are the
  // user's. Five user picks means the room got as far as the engine seats
  // between them - seed the whole prefix the way the room would have.
  const poolRows = await getPoolAt(DRAFT_CONFIG.scoringFormat, DRAFT_CONFIG.teamsCount, snap);
  const engine = await import('../fantasy/engine.js');
  const st = engine.createDraftState(
    { teams_count: DRAFT_CONFIG.teamsCount, roster_slots: DRAFT_CONFIG.rosterSlots },
    poolRows, 1,
  );
  const seeded = [];
  const rng = engine.makeRng(draft.id * 7919 + 1);
  let userMade = 0;
  while (userMade < 5) {
    const seat = st.order[st.overallPick - 1];
    const rec = engine.aiPick(st, seat, rng);
    assert.ok(rec, 'the prefix must be legal');
    if (seat === 0) userMade += 1;
    seeded.push(rec);
  }
  for (const r of seeded) {
    await sql`INSERT INTO draft_picks (draft_id, round, overall_pick, roster_slot, ffc_player_id,
      player_name, position, picked_by, adp_at_pick)
      VALUES (${draft.id}, ${r.round}, ${r.overallPick}, ${r.rosterSlot}, ${r.ffcPlayerId},
              ${r.playerName}, ${r.position}, ${st.order[r.overallPick - 1] === 0 ? 'user' : 'ai'},
              ${r.adpAtPick})`;
  }
  const before = (await sql`SELECT count(*)::int n FROM draft_picks
    WHERE draft_id = ${draft.id} AND picked_by = 'user'`)[0].n;
  assert.equal(before, 5, 'the fixture is a five-pick abandonment');

  // ---- the ruling ---------------------------------------------------------
  const done = await autoCompleteDraftFor(draft.id);
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(done.completed, true);
  assert.equal((await sql`SELECT status FROM drafts WHERE id=${draft.id}`)[0].status, 'completed');

  const after = (await sql`SELECT count(*)::int n FROM draft_picks
    WHERE draft_id = ${draft.id} AND picked_by = 'user'`)[0].n;
  assert.equal(after, DRAFT_ROUNDS, `expected ${DRAFT_ROUNDS} user picks, got ${after}`);
  assert.ok(after > before, 'the abandoned seat gained picks');

  // IDEMPOTENT: settle re-runs this, and a second call must not double-pick.
  await autoCompleteDraftFor(draft.id);
  assert.equal((await sql`SELECT count(*)::int n FROM draft_picks
    WHERE draft_id = ${draft.id} AND picked_by = 'user'`)[0].n, DRAFT_ROUNDS);

  const br = await bridgeContestRosters(cid);
  assert.equal(br.bridged, 1, JSON.stringify(br));
  const e = (await sql`SELECT meta FROM contest_entries WHERE contest_id=${cid} AND user_id=${uid}`)[0];
  assert.equal(e.meta.roster.length, DRAFT_ROUNDS, 'bridged 8/8');
  assert.equal(e.meta.unbridged, 0, 'every pick resolved to an nfl player');
  assert.equal(e.meta.legal, true, 'and the roster can field six');

  // ---- and it settles on its merits --------------------------------------
  const r = await settleContest(cid);
  assert.equal(r.settled, true, JSON.stringify(r));
  assert.equal(r.entries, 1, 'an auto-completed entry SCORES rather than DNF-ing');
  assert.equal(r.dnf, 0);
  const row = (await sql`SELECT score, lineup FROM contest_entries
    WHERE contest_id=${cid} AND user_id=${uid}`)[0];
  assert.ok(Number(row.score) > 0, `expected a real score, got ${row.score}`);
  assert.equal(Object.keys(row.lineup).length, 6, 'best ball filled all six slots');

  await sql`DELETE FROM draft_picks WHERE draft_id = ${draft.id}`;
  await sql`DELETE FROM drafts WHERE id = ${draft.id}`;
  await sql`DELETE FROM draft_configs WHERE id = ${cfg.id}`;
});

test('REPLAY: an abandoned room reads as 8/8 AFTER LOCK and BEFORE settle', async () => {
  // THE RULING: completion happens at lock, not at settle. A player who walked
  // away on Wednesday should not spend five days looking at a half-finished
  // roster that was always going to be completed. The race window is closed
  // before this can fire - no pick can be made after locks_at - which is
  // exactly why it cannot run any earlier.
  const { DRAFT_CONFIG, DRAFT_ROUNDS } = await import('../draft/contest.js');
  const { getPoolAt } = await import('../fantasy/drafts.js');
  const { claimEntry, draftState, getDraftEntry } = await import('../draft/entry.js');
  const engine = await import('../fantasy/engine.js');

  const uid = users[1];
  const week = WEEK + 2;
  await buildSyntheticWeek({ week });
  // Real sport: this room is read back through draftState(), which finds its
  // contest via currentDraftContest(sport='nfl'). It is a DRAFT contest, and
  // the cross-file collision this file was isolated from is on WEEKLY sweeps,
  // so leaving this one on 'nfl' costs no isolation.
  const cid = await mkContest('draft', pool, week, 'nfl');

  const cfg = (await sql`
    INSERT INTO draft_configs (user_id, name, teams_count, scoring_format, roster_slots,
                               pick_timer_seconds, is_preset, source)
    VALUES (${uid}, 'replay lock', ${DRAFT_CONFIG.teamsCount}, ${DRAFT_CONFIG.scoringFormat},
            ${JSON.stringify(DRAFT_CONFIG.rosterSlots)}::jsonb, ${DRAFT_CONFIG.clockSeconds},
            false, 'manual') RETURNING id`)[0];
  const snap = (await sql`SELECT max(snapshot_date) d FROM sim_player_pool WHERE source = 'ffc'`)[0].d;
  const draft = (await sql`
    INSERT INTO drafts (user_id, config_id, status, pick_position, is_auto,
                        pool_snapshot_date, pool_scoring_format, pool_teams_count, started_at, mode)
    VALUES (${uid}, ${cfg.id}, 'in_progress', 1, false, ${snap},
            ${DRAFT_CONFIG.scoringFormat}, ${DRAFT_CONFIG.teamsCount}, now(), 'sim')
    RETURNING id`)[0];
  await claimEntry(cid, uid, draft.id);

  // Two user picks in, then abandoned.
  const poolRows = await getPoolAt(DRAFT_CONFIG.scoringFormat, DRAFT_CONFIG.teamsCount, snap);
  const st = engine.createDraftState(
    { teams_count: DRAFT_CONFIG.teamsCount, roster_slots: DRAFT_CONFIG.rosterSlots }, poolRows, 1);
  const rng = engine.makeRng(draft.id * 7919 + 1);
  let userMade = 0;
  while (userMade < 2) {
    const seat = st.order[st.overallPick - 1];
    const rec = engine.aiPick(st, seat, rng);
    if (seat === 0) userMade += 1;
    await sql`INSERT INTO draft_picks (draft_id, round, overall_pick, roster_slot, ffc_player_id,
      player_name, position, picked_by, adp_at_pick)
      VALUES (${draft.id}, ${rec.round}, ${rec.overallPick}, ${rec.rosterSlot}, ${rec.ffcPlayerId},
              ${rec.playerName}, ${rec.position}, ${seat === 0 ? 'user' : 'ai'}, ${rec.adpAtPick})`;
  }
  assert.equal((await getDraftEntry(cid, uid)).meta.roster ?? null, null, 'no roster before lock');

  // ---- THE READ, after locks_at and before any settle ---------------------
  // mkContest sets locks_at in the PAST, so this contest is already locked.
  const st1 = await draftState(uid);
  assert.equal(st1.contest.settled, false, 'nothing has been settled yet');

  const entry = await getDraftEntry(cid, uid);
  assert.ok(Array.isArray(entry.meta.roster), 'the read must have completed the room');
  assert.equal(entry.meta.roster.length, DRAFT_ROUNDS, 'reads as 8/8 after lock');
  assert.equal(entry.meta.legal, true, 'and it can field six');
  assert.equal(entry.meta.autoFilled, DRAFT_ROUNDS - 2, 'six of the eight were mechanical');
  assert.equal((await sql`SELECT status FROM drafts WHERE id=${draft.id}`)[0].status, 'completed');

  // IDEMPOTENT: a second read must not pick again.
  await draftState(uid);
  assert.equal((await getDraftEntry(cid, uid)).meta.roster.length, DRAFT_ROUNDS);

  // ---- and settle still scores it, with nothing left to do ----------------
  const r = await settleContest(cid);
  assert.equal(r.settled, true, JSON.stringify(r));
  assert.equal(r.entries, 1, 'scored, not DNF');
  assert.equal(r.dnf, 0);

  await sql`DELETE FROM draft_picks WHERE draft_id = ${draft.id}`;
  await sql`DELETE FROM drafts WHERE id = ${draft.id}`;
  await sql`DELETE FROM draft_configs WHERE id = ${cfg.id}`;
});

// ---------------------------------------------------------------------------
// THE ROOM: bot roster scoring at settle (relay 2b item 1)
// ---------------------------------------------------------------------------
// A ranked room is one draft PER ENTRY (lib/draft/entry.js: "one ranked draft
// per user per week"), so this seeds one 12-seat, 96-pick room by hand -
// deterministic rosters, not the random engine - so the ranking is known in
// advance rather than discovered after the fact: seat 5 (a bot) gets the
// best eight players in the pool, the user's own seat (pick_position 9) gets
// the clear next tier down, and the remaining nine seats all share one weak,
// tied-for-last roster. That is enough to pin an exact rank without needing
// the room's OTHER nine seats to resolve in any particular order among
// themselves.

test('REPLAY: the room scores all twelve seats, stores meta.room, and the settled push names the room rank', async () => {
  const { DRAFT_CONFIG } = await import('../draft/contest.js');
  const { claimEntry } = await import('../draft/entry.js');
  const { renderCopy } = await import('../push/copy.js');
  const { ordinal } = await import('../standings/view.js');

  const uid = users[0];
  const week = WEEK + 3;
  await buildSyntheticWeek({ week });
  const cid = await mkContest('draft', pool, week);
  const scored = poolWithScores(pool, await weekScores(SEASON, week));

  const teamsCount = DRAFT_CONFIG.teamsCount; // 12
  const USER_SEAT = 9;
  const BEST_SEAT = 5;

  const byPos = (p) => scored.filter((x) => x.pos === p).sort((a, b) => b.points - a.points);
  const QB = byPos('QB'); const RB = byPos('RB'); const WR = byPos('WR'); const TE = byPos('TE');
  assert.ok(QB.length >= 2 && RB.length >= 6 && WR.length >= 6 && TE.length >= 2, 'the real week carries enough depth for this fixture');

  const rosterFor = (seat) => {
    if (seat === BEST_SEAT) return [QB[0], ...RB.slice(0, 3), ...WR.slice(0, 3), TE[0]];
    if (seat === USER_SEAT) return [QB[1], ...RB.slice(3, 6), ...WR.slice(3, 6), TE[1]];
    // Every other seat shares one deliberately weak, tied roster - the worst
    // players in each list, however deep the real pool runs.
    return [QB.at(-1), RB.at(-1), RB.at(-2), RB.at(-3), WR.at(-1), WR.at(-2), WR.at(-3), TE.at(-1)];
  };

  const cfg = (await sql`
    INSERT INTO draft_configs (user_id, name, teams_count, scoring_format, roster_slots,
                               pick_timer_seconds, is_preset, source)
    VALUES (${uid}, 'replay room', ${teamsCount}, ${DRAFT_CONFIG.scoringFormat},
            ${JSON.stringify(DRAFT_CONFIG.rosterSlots)}::jsonb, ${DRAFT_CONFIG.clockSeconds},
            false, 'manual') RETURNING id`)[0];
  const snap = (await sql`SELECT max(snapshot_date) d FROM sim_player_pool WHERE source = 'ffc'`)[0].d;
  const draft = (await sql`
    INSERT INTO drafts (user_id, config_id, status, pick_position, is_auto,
                        pool_snapshot_date, pool_scoring_format, pool_teams_count, started_at, mode)
    VALUES (${uid}, ${cfg.id}, 'completed', ${USER_SEAT}, false, ${snap},
            ${DRAFT_CONFIG.scoringFormat}, ${teamsCount}, now(), 'sim')
    RETURNING id`)[0];
  await claimEntry(cid, uid, draft.id);

  // snakePick(seat, round, teamsCount), forward - matches lib/draft/view.js
  // exactly, so seatForPick's inverse recovers the same seat back out.
  const snakePick = (seat, round, n) => (round % 2 === 1
    ? (round - 1) * n + seat
    : (round - 1) * n + (n - seat + 1));

  // FIXTURE-PREFIXED ffc_player_id, NOT THE BARE nfl_players.id. Real FFC
  // provider ids are small integers-as-text too - a bare match could tie a
  // real snapshot row on today's date and let DISTINCT ON pick either one.
  // The prefix can never collide with a real provider id.
  const fakeFfc = (p) => `replay-room-${p.id}`;

  for (let seat = 1; seat <= teamsCount; seat++) {
    const roster = rosterFor(seat);
    for (let round = 1; round <= roster.length; round++) {
      const p = roster[round - 1];
      const overall = snakePick(seat, round, teamsCount);
      await sql`INSERT INTO draft_picks (draft_id, round, overall_pick, roster_slot, ffc_player_id,
        player_name, position, picked_by, adp_at_pick)
        VALUES (${draft.id}, ${round}, ${overall}, ${p.pos}, ${fakeFfc(p)},
                ${p.name}, ${p.pos}, ${seat === USER_SEAT ? 'user' : 'ai'}, ${overall})`;
    }
  }

  // sim_player_pool bridges ffc_player_id -> nfl_players.id everywhere else
  // in this codebase; this fixture's fake ffc id resolves straight back to
  // the real nfl_players.id it was made from - one row per player, valid
  // for as long as this test's own draft_id exists.
  const fixturePlayers = new Map();
  for (const p of [...rosterFor(BEST_SEAT), ...rosterFor(USER_SEAT), ...rosterFor(1)]) {
    fixturePlayers.set(fakeFfc(p), p);
  }
  for (const [ffcId, p] of fixturePlayers) {
    await sql`INSERT INTO sim_player_pool
        (ffc_player_id, matched_player_id, name, position, scoring_format, teams_count, adp, source, snapshot_date)
      VALUES (${ffcId}, ${p.id}, ${p.name}, ${p.pos}, ${DRAFT_CONFIG.scoringFormat}, ${teamsCount}, 0,
              'replay-room-fixture', now())
      ON CONFLICT DO NOTHING`;
  }

  const r = await settleContest(cid);
  assert.equal(r.settled, true, JSON.stringify(r));

  // STORED perfect AND pct (item 8a's own ask), not just the room: the
  // Draft's ceiling is the best REAL scored entry, and this fixture's ONE
  // entry is trivially that entry, so the ceiling score, this entry's
  // score and 100% must all agree exactly.
  const [contestRow] = await sql`SELECT perfect FROM contests WHERE id = ${cid}`;
  assert.equal(Number(contestRow.perfect.score), r.perfect);

  const entry = (await sql`SELECT score, meta FROM contest_entries WHERE contest_id = ${cid} AND user_id = ${uid}`)[0];
  assert.equal(Number(entry.meta.pct), 100, 'the only real entry IS the ceiling');
  const room = entry.meta.room;
  assert.ok(room, 'meta.room was stored');
  assert.equal(room.of, teamsCount);
  assert.equal(room.seats.length, teamsCount);
  assert.equal(room.seats.filter((s) => s.user).length, 1, 'exactly one seat marked user');
  assert.equal(room.seats.find((s) => s.user).seat, USER_SEAT);
  assert.equal(room.rank, 2, 'the best seat is a bot; the user is the clear next tier down');
  assert.ok(room.seats[0].score > room.seats[1].score, 'ranked strictly by score');

  // THE USER'S OWN SEAT SCORE MATCHES THE ENTRY'S OWN STORED SCORE - both
  // come from the identical bestBall+scoreLineup path over the same roster,
  // so a real settle and the room's own read of that settle cannot disagree.
  const userSeat = room.seats.find((s) => s.user);
  assert.equal(Number(userSeat.score), Number(entry.score));

  // THE PUSH NAMES THE ROOM RANK - item 1's own acceptance line, rendered
  // through the real template with this real, DB-stored room.
  const copy = renderCopy(`draft-settled:${cid}`, {
    week, pts: Number(entry.score), rank: 1, field: 1,
    room_rank: `${ordinal(room.rank)} of ${room.of}`,
  });
  assert.equal(copy.body, `Week ${week} is graded. 2nd of 12 in your room, 1 of 1.`);

  await sql`DELETE FROM sim_player_pool WHERE source = 'replay-room-fixture'`;
  await sql`DELETE FROM draft_picks WHERE draft_id = ${draft.id}`;
  await sql`DELETE FROM drafts WHERE id = ${draft.id}`;
  await sql`DELETE FROM draft_configs WHERE id = ${cfg.id}`;
});
