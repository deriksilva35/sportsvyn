// lib/results/results.test.mjs - the four readers, each against a settled
// contest, plus the arithmetic the mock's "where you lost it" line rests on.
//
// THE DAILY READS A REAL DEV BOARD (1735 - three submitted runs, ceiling and
// best_roster present), because one exists. The other three have no settled
// contest on DEV at all, so each builds a SENTINEL contest, its entries and -
// for the Draft - its draft and its picks, and deletes them; the teardown
// asserts itself, the pattern lib/push/mlbLiveActivity.test.mjs uses.
//
// NOTHING HERE TOUCHES PROD. The readers are exercised against the same DEV the
// rest of the suite runs on.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(REPO, '.env.local'));

const { sql } = await import('../db.js');
const { dailyResults } = await import('./daily.js');
const { weeklyResults } = await import('./weekly.js');
const { draftResults } = await import('./draft.js');
const { pickemResults } = await import('./pickem.js');
const { lostIt, distribution, header, ordinal } = await import('./shape.js');
const { pairRows } = await import('../games/gradePairing.js');

const DEV_DAILY_BOARD = 1735;
const NS = `sentinel-results-${Date.now()}`;
let users = [];            // [{id, handle}]
let weeklyId; let draftId; let pickemId; let draftRoomId;

/** The scored pool both the Weekly and the Draft read points out of. */
const POOL = [
  { id: 901, pos: 'QB', name: 'Sentinel Allen', team: 'BUF', points: 28.4, resume: 'x' },
  { id: 902, pos: 'RB', name: 'Sentinel Achane', team: 'MIA', points: 27.8, resume: 'x' },
  { id: 903, pos: 'RB', name: 'Sentinel Robinson', team: 'ATL', points: 24.3, resume: 'x' },
  { id: 904, pos: 'WR', name: 'Sentinel Nacua', team: 'LAR', points: 31.6, resume: 'x' },
  { id: 905, pos: 'WR', name: 'Sentinel Jefferson', team: 'MIN', points: 22.9, resume: 'x' },
  { id: 906, pos: 'TE', name: 'Sentinel McBride', team: 'ARI', points: 18.9, resume: 'x' },
  { id: 907, pos: 'RB', name: 'Sentinel Jeanty', team: 'LV', points: 14.2, resume: 'x' },
  { id: 908, pos: 'WR', name: 'Sentinel Beckham', team: 'MIA', points: 9.4, resume: 'x' },
  { id: 909, pos: 'TE', name: 'Sentinel Bowers', team: 'LV', points: 18.0, resume: 'x' },
  { id: 910, pos: 'RB', name: 'Sentinel Walker', team: 'SEA', points: 19.1, resume: 'x' },
];
const byId = new Map(POOL.map((p) => [p.id, p]));
const sum = (ids) => Math.round(ids.reduce((a, id) => a + byId.get(id).points, 0) * 10) / 10;

/** The ceiling: the best six the shared pool allows, in SLOTS order. */
const CEILING_IDS = [901, 902, 903, 904, 905, 906];
const CEILING = {
  score: sum(CEILING_IDS),
  players: CEILING_IDS.map((id, i) => ({
    ...byId.get(id), slot: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'FLEX2'][i],
  })),
};
// MINE: two of the ceiling's six (Allen at QB, Nacua at WR) and four misses.
const MY_WEEKLY = { QB: 901, RB: 907, WR: 904, TE: 909, FLEX: 910, FLEX2: 908 };

before(async () => {
  const [lg] = await sql`SELECT id FROM leagues WHERE slug = 'nfl'`;
  for (let i = 0; i < 4; i += 1) {
    const email = `${NS}-u${i}@example.invalid`;
    const [u] = await sql`
      INSERT INTO users (email, handle, created_at) VALUES (${email}, ${`${NS}-h${i}`}, now()) RETURNING id, handle`;
    users.push(u);
  }
  const mk = async (game, sport, week, perfect, board) => {
    const [c] = await sql`
      INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at,
                            settled, settled_at, perfect)
      VALUES (${game}, ${sport}, 2099, ${week}, ${JSON.stringify(board)}::jsonb,
              now() - interval '9 days', now() - interval '8 days', now() - interval '1 day',
              true, now() - interval '1 day', ${JSON.stringify(perfect)}::jsonb)
      RETURNING id`;
    return c.id;
  };

  // ---- THE WEEKLY: four entries, one of them a DNF, plus the shared pool.
  weeklyId = await mk('weekly', 'nfl', 91, CEILING, POOL);
  const weeklyLineups = [
    MY_WEEKLY,                                                    // users[0] - "you"
    { QB: 901, RB: 902, WR: 904, TE: 906, FLEX: 903, FLEX2: 905 }, // users[1] - the ceiling itself
    { QB: 901, RB: 907, WR: 908, TE: 909, FLEX: 910, FLEX2: 902 }, // users[2]
  ];
  for (let i = 0; i < weeklyLineups.length; i += 1) {
    const score = sum(Object.values(weeklyLineups[i]));
    await sql`
      INSERT INTO contest_entries (contest_id, user_id, lineup, score, base_score, meta, locked_at, created_at, updated_at)
      VALUES (${weeklyId}, ${users[i].id}, ${JSON.stringify(weeklyLineups[i])}::jsonb, ${score}, ${score},
              ${JSON.stringify({ dnf: false, pct: Math.round((score / CEILING.score) * 1000) / 10 })}::jsonb,
              now(), now(), now())`;
  }
  // THE DNF: no score at all, which is what the distribution's leftmost bar is.
  await sql`
    INSERT INTO contest_entries (contest_id, user_id, lineup, score, meta, created_at, updated_at)
    VALUES (${weeklyId}, ${users[3].id}, '{}'::jsonb, NULL, ${JSON.stringify({ dnf: true })}::jsonb, now(), now())`;

  // ---- THE DRAFT: two entries with real drafts and real picks.
  draftId = await mk('draft', 'nfl', 92, null, POOL);
  const mkDraft = async (userId, seat, picks) => {
    const [d] = await sql`
      INSERT INTO drafts (user_id, status, pick_position, pool_teams_count, mode,
                          pool_snapshot_date, pool_scoring_format, started_at, completed_at)
      VALUES (${userId}, 'completed', ${seat}, 12, 'sim',
              current_date, 'ppr', now() - interval '9 days', now() - interval '9 days')
      RETURNING id`;
    for (const p of picks) {
      await sql`
        INSERT INTO draft_picks (draft_id, round, overall_pick, roster_slot, ffc_player_id,
                                 player_name, position, picked_by, adp_at_pick, picked_at)
        VALUES (${d.id}, ${p.round}, ${p.overall}, ${p.slot}, ${`ffc-${NS}-${p.overall}`},
                ${p.name}, ${p.pos}, 'user', ${p.adp}, now() - interval '9 days')`;
    }
    return d.id;
  };
  // users[0] - seat 5, eight picks, six counted.
  const myPicks = [
    { round: 1, overall: 5, slot: 'QB', name: 'Sentinel Allen', pos: 'QB', adp: 18 },
    { round: 2, overall: 20, slot: 'RB', name: 'Sentinel Jeanty', pos: 'RB', adp: 22 },
    { round: 3, overall: 29, slot: 'WR', name: 'Sentinel Nacua', pos: 'WR', adp: 14 },
    { round: 4, overall: 44, slot: 'RB', name: 'Sentinel Walker', pos: 'RB', adp: 40 },
    { round: 5, overall: 53, slot: 'TE', name: 'Sentinel Bowers', pos: 'TE', adp: 60 },
    { round: 6, overall: 68, slot: 'WR', name: 'Sentinel Beckham', pos: 'WR', adp: 61 },
  ];
  draftRoomId = await mkDraft(users[0].id, 5, myPicks);
  const bestDraftId = await mkDraft(users[1].id, 6, [
    { round: 1, overall: 6, slot: 'RB', name: 'Sentinel Achane', pos: 'RB', adp: 9 },
    { round: 2, overall: 19, slot: 'QB', name: 'Sentinel Allen', pos: 'QB', adp: 18 },
    { round: 3, overall: 30, slot: 'WR', name: 'Sentinel Nacua', pos: 'WR', adp: 14 },
    { round: 4, overall: 43, slot: 'WR', name: 'Sentinel Jefferson', pos: 'WR', adp: 9 },
    { round: 5, overall: 54, slot: 'TE', name: 'Sentinel McBride', pos: 'TE', adp: 31 },
    { round: 6, overall: 67, slot: 'RB', name: 'Sentinel Robinson', pos: 'RB', adp: 40 },
  ]);
  const rosterOf = (picks) => picks.map((p) => ({
    id: POOL.find((x) => x.name === p.name).id, name: p.name, pos: p.pos, round: p.round,
  }));
  const mineLineup = { QB: 901, RB: 907, WR: 904, TE: 909, FLEX: 910, FLEX2: 908 };
  const bestLineup = { QB: 901, RB: 902, WR: 904, TE: 906, FLEX: 903, FLEX2: 905 };
  const [me] = await sql`
    INSERT INTO contest_entries (contest_id, user_id, lineup, score, base_score, meta, locked_at, created_at, updated_at)
    VALUES (${draftId}, ${users[0].id}, ${JSON.stringify(mineLineup)}::jsonb, ${sum(Object.values(mineLineup))},
            ${sum(Object.values(mineLineup))},
            ${JSON.stringify({ dnf: false, draftId: draftRoomId, roster: rosterOf(myPicks),
    room: { of: 12, rank: 2, seats: [{ seat: 5, user: true, score: sum(Object.values(mineLineup)) }] } })}::jsonb,
            now(), now(), now()) RETURNING id`;
  const [bestEntry] = await sql`
    INSERT INTO contest_entries (contest_id, user_id, lineup, score, base_score, meta, locked_at, created_at, updated_at)
    VALUES (${draftId}, ${users[1].id}, ${JSON.stringify(bestLineup)}::jsonb, ${sum(Object.values(bestLineup))},
            ${sum(Object.values(bestLineup))},
            ${JSON.stringify({ dnf: false, draftId: bestDraftId, roster: rosterOf([
    { round: 1, overall: 6, name: 'Sentinel Achane', pos: 'RB' },
    { round: 2, overall: 19, name: 'Sentinel Allen', pos: 'QB' },
    { round: 3, overall: 30, name: 'Sentinel Nacua', pos: 'WR' },
    { round: 4, overall: 43, name: 'Sentinel Jefferson', pos: 'WR' },
    { round: 5, overall: 54, name: 'Sentinel McBride', pos: 'TE' },
    { round: 6, overall: 67, name: 'Sentinel Robinson', pos: 'RB' },
  ]) })}::jsonb, now(), now(), now()) RETURNING id`;
  void me;
  // THE DRAFT'S CEILING IS A REAL ENTRY, written the way settle writes it.
  await sql`
    UPDATE contests SET perfect = ${JSON.stringify({
    score: sum(Object.values(bestLineup)), entry_id: bestEntry.id, user_id: users[1].id, seat: 6,
  })}::jsonb WHERE id = ${draftId}`;

  // ---- PICK'EM: four games, one undecided.
  const games = [
    { match_id: 9001, away: 'WAS', home: 'PHI', slug: `${NS}-g1` },
    { match_id: 9002, away: 'MIN', home: 'GB', slug: `${NS}-g2` },
    { match_id: 9003, away: 'PIT', home: 'CLE', slug: `${NS}-g3` },
    { match_id: 9004, away: 'IND', home: 'KC', slug: `${NS}-g4` },
  ];
  pickemId = await mk('pickem', 'nfl', 93, { max: 4, results: { 9001: 'away', 9002: 'home', 9003: 'away' } }, games);
  const cards = [
    { u: 0, picks: { 9001: 'away', 9002: 'home', 9003: 'home', 9004: 'home' }, score: 2 },
    { u: 1, picks: { 9001: 'away', 9002: 'home', 9003: 'away', 9004: 'away' }, score: 3 },
    { u: 2, picks: { 9001: 'home', 9002: 'home', 9003: 'away', 9004: 'home' }, score: 2 },
  ];
  for (const c of cards) {
    await sql`
      INSERT INTO contest_entries (contest_id, user_id, lineup, score, base_score, meta, created_at, updated_at)
      VALUES (${pickemId}, ${users[c.u].id}, ${JSON.stringify(c.picks)}::jsonb, ${c.score}, ${c.score}, '{}'::jsonb, now(), now())`;
  }
});

after(async () => {
  const ids = users.map((u) => u.id);
  await sql`DELETE FROM contest_entries WHERE contest_id = ANY(${[weeklyId, draftId, pickemId].filter(Boolean)})`;
  await sql`DELETE FROM draft_picks WHERE draft_id IN (SELECT id FROM drafts WHERE user_id = ANY(${ids}))`;
  await sql`DELETE FROM drafts WHERE user_id = ANY(${ids})`;
  await sql`DELETE FROM contests WHERE id = ANY(${[weeklyId, draftId, pickemId].filter(Boolean)})`;
  await sql`DELETE FROM users WHERE id = ANY(${ids})`;
  const [left] = await sql`
    SELECT (SELECT count(*)::int FROM contests WHERE id = ANY(${[weeklyId, draftId, pickemId].filter(Boolean)})) AS contests,
           (SELECT count(*)::int FROM users WHERE id = ANY(${ids})) AS users,
           (SELECT count(*)::int FROM drafts WHERE user_id = ANY(${ids})) AS drafts`;
  assert.equal(left.contests, 0, 'sentinel contests left behind');
  assert.equal(left.users, 0, 'sentinel users left behind');
  assert.equal(left.drafts, 0, 'sentinel drafts left behind');
});

// ---------------------------------------------------------------- the readers

test('THE DAILY reads a real DEV board, and the two columns pair', async () => {
  const runs = await sql`
    SELECT user_id, score, pct FROM daily_board_runs
     WHERE board_id = ${DEV_DAILY_BOARD} AND picks IS NOT NULL ORDER BY score DESC`;
  assert.ok(runs.length >= 2, 'DEV board 1735 still has submitted runs');
  const v = await dailyResults(DEV_DAILY_BOARD, runs[0].user_id);
  assert.equal(v.game, 'daily');
  assert.equal(v.ceilingWord, 'perfect');
  // THE CEILING IS THE EDITION'S STORED ONE, and the top run matched it.
  const [board] = await sql`SELECT ceiling FROM daily_boards WHERE id = ${DEV_DAILY_BOARD}`;
  assert.equal(v.header.ceiling, Math.round(Number(board.ceiling) * 10) / 10);
  // PCT IS A PERCENTAGE HERE. The column stores a FRACTION (1 for perfect) and
  // passing it through raw put "1%" in the header of a perfect board.
  assert.equal(v.header.pctOfCeiling, 100);
  assert.equal(v.mine.length, v.ceiling.length, 'the two columns are the same length');
  assert.equal(v.mine.length, v.slotCount);
  assert.equal(v.field.played, runs.length);
  // RANK IS A NUMBER, not the driver's bigint string.
  assert.equal(typeof v.field.rows[0].rank, 'number');
  // TWELVE BUCKETS AND NO DNF BAR: todayLeaderboard only returns submitted runs,
  // so an abandoned attempt is absent from the field rather than a DNF in it.
  assert.equal(v.field.distribution.bars.length, 12);
  assert.equal(v.field.dnf, 0);
  assert.equal(v.field.axis.length, 5);
  assert.match(v.field.axis[3], /^you · /);
});

test('THE WEEKLY pairs you against the STORED theoretical ceiling', async () => {
  const v = await weeklyResults(weeklyId, users[0].id);
  assert.equal(v.game, 'weekly');
  assert.equal(v.ceilingWord, 'optimal');
  assert.equal(v.header.ceiling, CEILING.score);
  assert.equal(v.header.score, sum(Object.values(MY_WEEKLY)));
  // TWO MATCHED SLOTS - Allen and Nacua are on both sides.
  assert.equal(v.matched, 2);
  assert.equal(v.mine.filter((p) => p.hit).length, 2);
  assert.equal(v.ceiling.filter((p) => p.hit).length, 2);
  assert.equal(v.mine.length, 6);
  // THE FIELD: three scored, one DNF, and the DNF gets its own leftmost bar.
  assert.equal(v.field.played, 3);
  assert.equal(v.field.dnf, 1);
  assert.equal(v.field.distribution.bars.length, 13, '12 buckets plus the DNF bar');
  assert.equal(v.field.distribution.bars[0].dnf, true);
  assert.equal(v.field.axis[0], 'DNF');
  // THE MEDIAN IS OVER SCORED ENTRIES ONLY - three scores, so the middle one.
  const scores = [sum(Object.values(MY_WEEKLY)), CEILING.score,
    sum([901, 907, 908, 909, 910, 902])].sort((a, b) => a - b);
  assert.equal(v.field.median, scores[1]);
  // THE CEILING'S ENTRY IS FIRST AND IS NOT THE READER.
  assert.equal(v.field.rows[0].score, CEILING.score);
  assert.equal(v.field.rows[0].you, false);
});

test('THE DRAFT carries two ranks, and every pick knows where it happened', async () => {
  const v = await draftResults(draftId, users[0].id);
  assert.equal(v.game, 'draft');
  assert.equal(v.ceilingWord, 'best draft');
  // TWO RANKS, BOTH TRUE: the room's is stored per entry at settle, the field's
  // is ranked here.
  assert.equal(v.header.roomRank, 2);
  assert.equal(v.header.roomOf, 12);
  assert.equal(v.header.rank, 2, 'second of the two sentinel entries');
  assert.equal(v.header.of, 2);
  assert.equal(v.seat, 5);
  // THE CEILING IS A REAL ENTRY, named, with its seat.
  assert.equal(v.best.seat, 6);
  assert.equal(v.header.ceiling, v.best.score);
  // EVERY PICK: at · ADP · taken Nth · value, from stored columns only.
  const allen = v.myPicks.find((p) => p.name === 'Sentinel Allen');
  assert.equal(allen.at, '1.05', 'overall 5 in round 1 of a 12-team room');
  assert.equal(allen.adp, 18);
  assert.equal(allen.takenLabel, 'taken 5th');
  assert.equal(allen.gap, 13, 'ADP 18 minus pick 5');
  assert.equal(allen.gapLabel, '+13 value');
  assert.equal(allen.reach, false);
  const nacua = v.myPicks.find((p) => p.name === 'Sentinel Nacua');
  assert.equal(nacua.at, '3.05');
  assert.equal(nacua.gap, -15, 'ADP 14 taken 29th is a reach');
  assert.equal(nacua.gapLabel, '-15 reach');
  assert.equal(nacua.reach, true);
  // THE BEST DRAFT'S OWN PICKS COME BACK TOO, in its own room's numbering.
  assert.equal(v.bestPicks.find((p) => p.name === 'Sentinel Achane').at, '1.06');
  // AND POINTS RIDE FROM THE FROZEN BOARD, not from the pick row.
  assert.equal(allen.points, 28.4);
});

test("PICK'EM is a scoreboard, and an undecided game is a third state", async () => {
  const v = await pickemResults(pickemId, users[0].id);
  assert.equal(v.game, 'pickem');
  assert.equal(v.record, '2-1', 'two right, one wrong, one not yet played');
  assert.equal(v.bestRecord, '3-0');
  assert.equal(v.tied, 1);
  assert.equal(v.scoreboard.games.length, 4);
  const mine = v.scoreboard.rows.find((r) => r.you);
  assert.deepEqual(mine.squares.map((s) => s.state), ['win', 'win', 'loss', 'pending']);
  // THE DASHED SQUARE IS NOT A LOSS: the fourth game has no result stored.
  assert.equal(v.scoreboard.games[3].winner, null);
  // DENSE RANK: two entries on 2 correct share a rank.
  const ranks = v.scoreboard.rows.map((r) => r.rank);
  assert.deepEqual(ranks, [1, 2, 2]);
  // AND THERE IS NO mine/ceiling PAIR AT ALL - the mock replaces it with the grid.
  assert.equal(v.mine, undefined);
  assert.equal(v.ceiling, undefined);
});

test('a reader refuses an unsettled or missing contest rather than saying zero', async () => {
  assert.equal(await weeklyResults(999999999, users[0].id), null);
  assert.equal(await draftResults(999999999, users[0].id), null);
  assert.equal(await dailyResults(999999999, users[0].id), null);
  // THE WEEKLY AND THE DRAFT REFUSE AN UNSETTLED ONE TOO. A results screen for a
  // contest still being played would read as "you scored nothing".
  await sql`UPDATE contests SET settled = false WHERE id = ${weeklyId}`;
  assert.equal(await weeklyResults(weeklyId, users[0].id), null);
  await sql`UPDATE contests SET settled = true WHERE id = ${weeklyId}`;
});

// ------------------------------------------------- the arithmetic, pinned

test('WHERE YOU LOST IT is pairRows\' misses, biggest gap first, top three', () => {
  const yours = [
    { label: 'QB', id: 1, name: 'A Match', points: 28.4 },
    { label: 'RB', id: 2, name: 'Jahmyr Gibbs', points: 14.2 },
    { label: 'RB2', id: 3, name: 'Ken Walker', points: 19.1 },
    { label: 'WR', id: 4, name: 'Odell Beckham', points: 9.4 },
    { label: 'TE', id: 5, name: 'Brock Bowers', points: 18.0 },
  ];
  const best = [
    { label: 'QB', id: 1, name: 'A Match', points: 28.4 },
    { label: 'RB', id: 6, name: 'Derrick Henry', points: 27.8 },
    { label: 'RB2', id: 7, name: 'Bijan Robinson', points: 24.3 },
    { label: 'WR', id: 8, name: 'Justin Jefferson', points: 22.9 },
    { label: 'TE', id: 9, name: 'Trey McBride', points: 18.9 },
  ];
  const rows = pairRows(yours, best);
  const lost = lostIt(rows);
  assert.equal(lost.length, 3, 'top three, not all four');
  // BIGGEST GAP FIRST, AND THE PAIRING IS RANK-FOR-RANK ON EACH SIDE - which is
  // pairRows' documented rule and not "the closest number". Your leftovers
  // descend 19.1, 18.0, 14.2, 9.4; the ceiling's descend 27.8, 24.3, 22.9, 18.9;
  // so Walker-Henry is -8.7, Bowers-Robinson -6.3, Gibbs-Jefferson -8.7 and
  // Beckham-McBride -9.5. The three biggest are -9.5 and the two -8.7s.
  assert.deepEqual(lost.map((l) => l.delta), [-9.5, -8.7, -8.7]);
  assert.equal(lost[0].phrase, 'Beckham over McBride');
  // AND A SLOT YOU WON IS NEVER IN IT. pairRows marks those 'ahead'.
  const won = pairRows(
    [{ label: 'QB', id: 1, name: 'Big Score', points: 40 }],
    [{ label: 'QB', id: 2, name: 'Small Score', points: 10 }],
  );
  assert.equal(won[0].verdict, 'ahead');
  assert.deepEqual(lostIt(won), []);
});

test('the distribution buckets, marks and medians exactly as ruled', () => {
  // TWELVE BUCKETS over low..ceiling, the reader's bucket marked `me`, every
  // bucket above it `top`, and a DNF bar on the LEFT only when there are DNFs.
  const d = distribution([10, 20, 30, 40, 50], { mine: 30, ceiling: 60, dnf: 0 });
  assert.equal(d.bars.length, 12);
  assert.equal(d.bars.filter((b) => b.me).length, 1);
  assert.equal(d.median, 30);
  assert.equal(d.low, 10);
  assert.equal(d.high, 60, 'the range ends at the CEILING, not at the best score');
  const meAt = d.bars.findIndex((b) => b.me);
  assert.ok(d.bars.slice(meAt + 1).every((b) => b.top), 'everything above me is marked top');
  assert.ok(d.bars.slice(0, meAt).every((b) => !b.top));

  const withDnf = distribution([10, 20, 30], { mine: 20, ceiling: 40, dnf: 4 });
  assert.equal(withDnf.bars.length, 13);
  assert.equal(withDnf.bars[0].dnf, true);
  assert.equal(withDnf.bars[0].n, 4);
  // THE MEDIAN IGNORES THE DNFs. Four absent entries are not four low scores,
  // and letting them drag it down would describe a field nobody played in.
  assert.equal(withDnf.median, 20);
  assert.equal(withDnf.played, 3);

  // A FIELD WHERE EVERYBODY SCORED THE SAME is one bucket, not a divide by zero.
  const flat = distribution([7, 7, 7], { mine: 7, ceiling: 7 });
  assert.equal(flat.bars.length, 12);
  assert.equal(flat.bars[0].n, 3);
  assert.equal(flat.median, 7);
  // An empty field is empty, and says so rather than dividing by nothing.
  assert.deepEqual(distribution([], {}).bars, []);
  assert.equal(distribution([], {}).median, null);
});

test('the header refuses to divide by a ceiling of zero, and ordinals hold', () => {
  assert.equal(header({ score: 10, ceiling: 0 }).pctOfCeiling, null);
  assert.equal(header({ score: 10, ceiling: null }).pctOfCeiling, null);
  assert.equal(header({ score: 1712, ceiling: 1868 }).pctOfCeiling, 91.6);
  assert.equal(header({ rank: 41, of: 1204 }).topPct, 3.4);
  assert.equal(header({ rank: null, of: 1204 }).topPct, null);
  assert.equal(ordinal(1), '1st');
  assert.equal(ordinal(2), '2nd');
  assert.equal(ordinal(3), '3rd');
  assert.equal(ordinal(11), '11th');
  assert.equal(ordinal(12), '12th');
  assert.equal(ordinal(13), '13th');
  assert.equal(ordinal(21), '21st');
  assert.equal(ordinal(41), '41st');
  assert.equal(ordinal(0), null);
});
