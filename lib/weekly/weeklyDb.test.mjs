// lib/weekly/weeklyDb.test.mjs - the Weekly against the database.
//
// rules.test.mjs proves the verdicts. This proves the QUERIES honour them -
// the half that regresses, because it is one forgotten check away.
//
// 2025 WEEK 1 IS REAL AND COMPLETE, so settle can actually succeed against the
// corpus rather than against a fixture that agrees with itself. The refusal
// case is constructed - one FINAL game with zero stat rows, in a season nobody
// uses - because DEV has no 2026 schedule and a borrowed empty week would have
// tested "no games" instead of the case that matters.

import { test, after, before } from 'node:test';
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
const { saveLineup, getEntry, lockEntries } = await import('./entries.js');
const { settleContest, poolWithScores } = await import('./settle.js');
const { weekGames, weekScores } = await import('./pool.js');
const { perfectLineup } = await import('../daily/reveal.js');
const { SLOTS } = await import('./rules.js');
const { tuesdayBefore, ensureWeek } = await import('./create.js');
const { easternLocalToUtc } = await import('../gridiron/ingest.js');

const EMAIL = 'weeklytest@example.invalid';
const EMAIL2 = 'weeklytest2@example.invalid';
const TEST_EMAILS = [EMAIL, EMAIL2];
let userId = null;
let openId = null;      // a contest still open
let doneId = null;      // 2025 wk1, settleable
let pool = null;

const FUTURE = new Date(Date.now() + 3 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 3 * 86_400_000).toISOString();

// EVERY CONTEST THIS RUN CREATED, and nothing else. See the teardown note.
const created = [];

/**
 * Make a contest for this file's use.
 *
 * IT REFUSES TO ADOPT ONE IT DID NOT CREATE, and that refusal is the whole
 * point of this function. It used to fall back to SELECT on conflict, which
 * meant that if DEV already held a real 2025 week 1 weekly board - the first
 * one seeded during the Weekly's surface build did - `doneId` silently bound
 * to a 1,269-player production board instead of the 400-player fixture, the
 * settle test failed against a board it had never built, and then the teardown
 * DELETED that board because 2025 is in TEST_SEASONS. Half an hour of
 * "why is settle broken" for a board that was fine.
 *
 * Failing loudly costs one clear error message. Adopting costs someone's board.
 */
async function mkContest({ season, week, locksAt, board }) {
  const r = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at)
    VALUES ('weekly','nfl',${season},${week},${JSON.stringify(board)}::jsonb,
            ${PAST}, ${locksAt})
    ON CONFLICT DO NOTHING RETURNING id`;
  if (r.length) { created.push(r[0].id); return r[0].id; }
  throw new Error(
    `a weekly contest for ${season} week ${week} already exists in this database. `
    + 'This suite will not adopt it - it would be settled and then deleted. '
    + 'Remove it first if it is disposable, or point the suite at another week.',
  );
}

before(async () => {
  const u = await sql`INSERT INTO users (email) VALUES (${EMAIL})
    ON CONFLICT DO NOTHING RETURNING id`;
  userId = u[0]?.id ?? (await sql`SELECT id FROM users WHERE email=${EMAIL}`)[0].id;

  // A small, deterministic pool - enough to fill six slots twice over.
  const rows = await sql`
    SELECT np.id, np.full_name AS name, np.position AS pos
      FROM nfl_players np WHERE np.position = ANY(ARRAY['QB','RB','WR','TE'])
     ORDER BY np.id LIMIT 400`;
  pool = rows.map((r) => ({ id: r.id, name: r.name, pos: r.pos }));

  openId = await mkContest({ season: 2099, week: 1, locksAt: FUTURE, board: pool });
  doneId = await mkContest({ season: 2025, week: 1, locksAt: PAST, board: pool });
});

// TEARDOWN DELETES BY ID, NOT BY SEASON.
//
// It used to sweep `season_year = ANY([2025, 2097, 2098, 2099])`, which covered
// every season this file can create - and also every 2025 weekly board it did
// NOT create. 2025 is a real season with a real schedule; the moment a real
// 2025 board existed in DEV, running the suite destroyed it. The synthetic
// seasons are safe to sweep by season because nothing else can own them, but
// there is no reason to: `created` is exact, and an exact list cannot reach
// into somebody else's row the way a namespace sweep can.
//
// This is the same lesson as the email scope below, one table over. A teardown
// that owns a namespace it did not create will eventually delete something
// that mattered.
after(async () => {
  if (created.length) {
    await sql`DELETE FROM contest_entries WHERE contest_id = ANY(${created})`;
    await sql`DELETE FROM contests WHERE id = ANY(${created})`;
  }
  await sql`DELETE FROM matches WHERE season_year = ANY(ARRAY[2097, 2098, 2099])`;
  // SCOPED TO THIS FILE'S OWN EMAILS. A LIKE '%@example.invalid' sweep here
  // deleted lib/fantasy/drafts.test.mjs's simtest-* users mid-run - node --test
  // runs files in parallel, so a teardown that owns a whole namespace it did
  // not create will reach into another suite and fail it.
  await sql`DELETE FROM users WHERE email = ANY(${TEST_EMAILS})`;
});

const six = (p) => {
  const pick = (pos, n = 1) => p.filter((x) => x.pos === pos).slice(0, n);
  const [qb] = pick('QB'); const [rb, rb2] = pick('RB', 2);
  const [wr, wr2] = pick('WR', 2); const [te] = pick('TE');
  return { QB: qb.id, RB: rb.id, WR: wr.id, TE: te.id, FLEX: rb2.id, FLEX2: wr2.id };
};

// ---------------------------------------------------------------------------
// THE LOCK LAW, at the database
// ---------------------------------------------------------------------------

test('a save before lock succeeds and stores the lineup', async () => {
  const r = await saveLineup(openId, userId, six(pool));
  assert.equal(r.ok, true);
  assert.equal(r.filled, 6);
  const e = await getEntry(openId, userId);
  assert.equal(Object.keys(e.lineup).length, 6);
  assert.equal(e.locked_at, null, 'saving is not locking');
});

test('EDIT OVERWRITES, and keeps no history', async () => {
  const first = await getEntry(openId, userId);
  const swapped = { ...first.lineup, QB: pool.filter((p) => p.pos === 'QB')[1].id };
  await saveLineup(openId, userId, swapped);
  const after2 = await getEntry(openId, userId);
  assert.equal(after2.lineup.QB, swapped.QB, 'the new pick is stored');
  assert.notEqual(after2.lineup.QB, first.lineup.QB);
  const rows = await sql`SELECT count(*)::int n FROM contest_entries
     WHERE contest_id=${openId} AND user_id=${userId}`;
  assert.equal(rows[0].n, 1, 'one row, overwritten - not a second row');
});

test('LOCK LAW: a save one millisecond after lock is REFUSED by the server', async () => {
  const c = (await sql`SELECT locks_at FROM contests WHERE id=${openId}`)[0];
  const justAfter = new Date(new Date(c.locks_at).getTime() + 1);
  const r = await saveLineup(openId, userId, six(pool), { now: justAfter });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'locked');
});

test('LOCK LAW: the refusal comes from the CONTEST ROW, not the caller', async () => {
  // A save against an already-locked contest is refused even with a "now" that
  // is generous, because locks_at is read from the row.
  const r = await saveLineup(doneId, userId, six(pool), { now: new Date() });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'locked');
});

test('a partial lineup saves - it is a draft until first kickoff', async () => {
  const r = await saveLineup(openId, userId, { QB: pool.find((p) => p.pos === 'QB').id });
  assert.equal(r.ok, true);
  assert.equal(r.filled, 1);
  await saveLineup(openId, userId, six(pool));   // restore for later tests
});

test('locked_at is stamped at LOCK, not at save, and is set-once', async () => {
  await saveLineup(doneId, userId, six(pool), { now: new Date(Date.parse(PAST) - 1000) })
    .catch(() => {});
  await sql`INSERT INTO contest_entries (contest_id, user_id, lineup)
    VALUES (${doneId}, ${userId}, ${JSON.stringify(six(pool))}::jsonb)
    ON CONFLICT (contest_id, user_id) DO UPDATE SET lineup = EXCLUDED.lineup`;
  const a = await lockEntries(doneId);
  assert.ok(a.locked >= 1);
  const b = await lockEntries(doneId);
  assert.equal(b.locked, 0, 'a second run finds nothing');
});

// ---------------------------------------------------------------------------
// THE PRE-LOCK LEAK
// ---------------------------------------------------------------------------

test('PRE-LOCK: nothing exposes another player\'s lineup, or any aggregate of them', async () => {
  // Every read a surface has before lock is getEntry(contest, user) - scoped to
  // one user by its arguments. There is no count, no most-rostered, no
  // anything that touches rows belonging to somebody else.
  const mine = await getEntry(openId, userId);
  assert.ok(mine, 'my own entry is readable');

  const src = readFileSync(path.join(__dirname, 'entries.js'), 'utf8');
  // A reader that aggregates over a contest would have to group or count.
  assert.equal(/count\(|group by/i.test(src), false,
    'entries.js must not contain an aggregate - that is how a field-wide leak ships');
  // And every SELECT against contest_entries is user-scoped.
  for (const m of src.matchAll(/FROM contest_entries[\s\S]{0,160}/gi)) {
    assert.match(m[0], /user_id/i, `unscoped read of contest_entries: ${m[0].slice(0, 80)}`);
  }
});

// ---------------------------------------------------------------------------
// SETTLE
// ---------------------------------------------------------------------------

test('SETTLE REFUSES a final game with NO STAT LINES, and names it - negative control', async () => {
  // Constructed rather than borrowed from a fixture: one FINAL game with zero
  // stat rows is exactly what a late BDL looks like on a Tuesday morning, and
  // it is the case that would settle wrong and never be noticed.
  const lg = (await sql`SELECT id FROM leagues WHERE slug='nfl'`)[0].id;
  const tms = await sql`SELECT id FROM teams WHERE league_id=${lg} ORDER BY id LIMIT 2`;
  const m = await sql`
    INSERT INTO matches (league_id, season_year, season_phase, week, kickoff_at, status,
                         home_team_id, away_team_id, home_score, away_score, slug)
    VALUES (${lg}, 2097, 'REG', 1, ${PAST}, 'final', ${tms[0].id}, ${tms[1].id}, 21, 17,
            'weekly-settle-gate-fixture-2097')
    RETURNING id`;
  const id = await mkContest({ season: 2097, week: 1, locksAt: PAST, board: pool });

  const r = await settleContest(id);
  assert.equal(r.settled, false, 'must not settle on a hole');
  assert.equal(r.reason, 'stat lines missing');
  assert.equal(r.missing.length, 1);
  assert.equal(r.missing[0].why, 'final, no stat lines');
  assert.ok(r.missing[0].label, 'and it names the game');

  const still = (await sql`SELECT settled FROM contests WHERE id=${id}`)[0];
  assert.equal(still.settled, false, 'the contest is untouched');

  await sql`DELETE FROM contests WHERE id = ${id}`;
  await sql`DELETE FROM matches WHERE id = ${m[0].id}`;
});

test('SETTLE succeeds on a complete week and scores every entry', async () => {
  const r = await settleContest(doneId);
  assert.equal(r.settled, true, JSON.stringify(r));
  assert.ok(r.perfect > 0, 'a perfect lineup was computed');
  const e = await getEntry(doneId, userId);
  assert.ok(Number(e.score) >= 0, 'the entry has a score');
  assert.equal(e.meta.dnf, false);
});

test('SETTLE is set-once - a second tick finds nothing to do', async () => {
  const r = await settleContest(doneId);
  assert.equal(r.settled, false);
  assert.equal(r.alreadySettled, true);
});

test('PERFECT LINEUP over a FULL-WEEK pool is computable and bounded', async () => {
  const board = (await sql`
    SELECT np.id, np.full_name AS name, np.position AS pos
      FROM nfl_players np JOIN teams t ON t.id = np.team_id
     WHERE np.position = ANY(ARRAY['QB','RB','WR','TE'])`)
    .map((r) => ({ id: r.id, name: r.name, pos: r.pos }));
  const scored = poolWithScores(board, await weekScores(2025, 1));
  const t0 = Date.now();
  const best = perfectLineup(scored);
  const ms = Date.now() - t0;
  assert.ok(board.length > 1000, `pool is full-week sized: ${board.length}`);
  assert.ok(best && best.total > 0, 'a perfect lineup exists');
  assert.equal(best.picks.length, 6);
  assert.equal(best.picks.filter((p) => p.dropped).length, 1);
  assert.ok(ms < 5000, `bounded: took ${ms}ms over ${board.length} players`);
});

test('an INCOMPLETE lineup settles as a DNF, not a partial score', async () => {
  // Five of six is not a lineup. Scoring it would rank someone who forgot a
  // slot above someone who filled all six badly, which inverts the measure.
  // A SECOND user on the already-settled week, unsettled and re-run.
  const u2 = await sql`INSERT INTO users (email) VALUES (${EMAIL2})
    ON CONFLICT DO NOTHING RETURNING id`;
  const uid2 = u2[0]?.id ?? (await sql`SELECT id FROM users WHERE email=${EMAIL2}`)[0].id;

  const partial = six(pool); delete partial.FLEX2;
  await sql`INSERT INTO contest_entries (contest_id, user_id, lineup)
    VALUES (${doneId}, ${uid2}, ${JSON.stringify(partial)}::jsonb)
    ON CONFLICT (contest_id, user_id) DO UPDATE SET lineup = EXCLUDED.lineup`;
  await sql`UPDATE contests SET settled = false WHERE id = ${doneId}`;

  const r = await settleContest(doneId);
  assert.equal(r.settled, true);
  const e = await sql`SELECT score, meta FROM contest_entries
     WHERE contest_id=${doneId} AND user_id=${uid2}`;
  assert.equal(e[0].score, null, 'no score for five slots');
  assert.equal(e[0].meta.dnf, true);
  assert.equal(e[0].meta.filled, 5);
  assert.ok(r.dnf >= 1);

  await sql`DELETE FROM contest_entries WHERE user_id = ${uid2}`;
  await sql`DELETE FROM users WHERE id = ${uid2}`;
});

// ---------------------------------------------------------------------------
// WHEN A BOARD OPENS
// ---------------------------------------------------------------------------
// This was `kickoff - 2 days`, which for 2026 Week 1 opened the board at 8:20pm
// on a MONDAY - fourteen hours before the "Boards open Tuesday morning" line
// that the pitch, the rules, the homepage module and the pre-board state all
// carry. Subtracting a fixed interval from a kickoff that moves between
// Wednesday, Thursday and Sunday cannot land on a weekday; only naming it can.

// ASSERT ON PARTS, NOT ON A FORMATTED STRING. The first version of this matched
// a regex against toLocaleString output and failed on a missing comma - the test
// was checking the ICU locale's punctuation, not the time it was written for.
const etParts = (iso) => Object.fromEntries(
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: 'numeric',
    minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
);

test('a board opens 9am ET TUESDAY, whatever weekday the kickoff falls on', async () => {
  for (const ko of [
    '2026-09-10T00:20:00Z',   // 2026 W1 - a WEDNESDAY opener
    '2026-09-18T00:15:00Z',   // a Thursday opener, the common case
    '2026-09-20T17:00:00Z',   // a Sunday-only week
    '2026-12-04T01:15:00Z',   // after the November DST change
  ]) {
    const opens = await easternLocalToUtc(tuesdayBefore(ko));
    const p = etParts(opens);
    assert.equal(p.weekday, 'Tue', `kickoff ${ko} opened on ${p.weekday}, not Tuesday`);
    assert.equal(`${p.hour}:${p.minute}`, '09:00',
      `kickoff ${ko} opened at ${p.hour}:${p.minute} ET, not 09:00`);
    assert.ok(new Date(opens) < new Date(ko), 'a board cannot open after its own lock');
  }
});

test('DST IS RESOLVED BY POSTGRES, not by a hand-rolled offset', async () => {
  // A fixed -4h would put the December board at 10am ET. easternLocalToUtc is
  // the single sanctioned conversion in this codebase for exactly this reason.
  const summer = await easternLocalToUtc(tuesdayBefore('2026-09-18T00:15:00Z'));
  const winter = await easternLocalToUtc(tuesdayBefore('2026-12-04T01:15:00Z'));
  assert.equal(summer.slice(11, 16), '13:00', 'EDT is UTC-4');
  assert.equal(winter.slice(11, 16), '14:00', 'EST is UTC-5');
});

test('A TUESDAY KICKOFF OPENS THE SAME MORNING, not a week early', () => {
  // "On or before", not "the previous Tuesday". The NFL has played Tuesday
  // games - weather reschedules, and twice in 2020 - so this is not academic.
  const naive = tuesdayBefore('2026-09-15T23:00:00Z');   // Tue 7pm ET
  assert.equal(naive.slice(0, 10), '2026-09-15');
});
