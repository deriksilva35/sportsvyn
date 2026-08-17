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
const EMAILS = ['replay-a@example.invalid', 'replay-b@example.invalid', 'replay-c@example.invalid'];
const PAST = new Date(Date.now() - 86_400_000).toISOString();

let users = [];
let pool = [];
let fixtureMatches = [];
let weeklyId = null;
let draftId = null;

/** Clone 2025 week 1 into SEASON/WEEK so the harness owns its own games. */
async function buildSyntheticWeek({ withStatsFor = null } = {}) {
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
      VALUES (${g.league_id}, ${SEASON}, 'REG', ${WEEK}, ${g.kickoff_at}, 'final',
              ${g.home_team_id}, ${g.away_team_id}, ${g.home_score}, ${g.away_score},
              ${`replay-${SEASON}-${WEEK}-${i}`})
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

async function mkContest(gameType, board) {
  const r = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at)
    VALUES (${gameType}, 'nfl', ${SEASON}, ${WEEK}, ${JSON.stringify(board)}::jsonb, ${PAST}, ${PAST})
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
  assert.equal(w.perfect, d.perfect, 'same week, same pool -> the same yardstick for both games');

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

  const w = await settleDue('weekly');
  assert.equal(w.settled, 1);
  assert.equal(w.results.every((r) => r.contestId !== dId), true, 'the weekly run never touched the draft');
  const draftStill = (await sql`SELECT settled FROM contests WHERE id=${dId}`)[0];
  assert.equal(draftStill.settled, false, 'the draft is still unsettled an hour before its own run');

  const d = await settleDue('draft');
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
    VALUES ('weekly','nfl',${SEASON}, 99, ${JSON.stringify(pool)}::jsonb, ${PAST}, ${PAST})
    RETURNING id`;
  const r = await settleDue('weekly');
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
  const cid = await mkContest('draft', pool);
  const uid = users[0];

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
