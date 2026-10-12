// lib/daily/lockIn.db.test.mjs - THE DAILY LOCK-IN on DEV, end to end (mon-4), for a
// signed-in run (daily_board_runs) AND a guest run (the guest table): the start hands
// over names only; a team choice commits; a second choice, a pick from an uncommitted
// team, and a change to a placed pick are refused by the server; a normal full run
// still works and is graded from its steps (a client's list is ignored); a run that
// started before the lock-in (steps NULL) keeps the old submit path; two tabs racing
// a choice cannot both win. Board edition 2096-*, its own fixtures, removed after.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureMark } from '../testing/fixtureMark.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
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
if (!process.env.DAILY_GUEST_SECRET) process.env.DAILY_GUEST_SECRET = 'guest-test-secret-not-a-real-one-0123456789';

const { sql } = await import('../db.js');
const G = await import('./guestRuns.js');
const L = await import('./lockIn.js');
const { startRun, submitRun } = await import('./seasonBoardRuns.js');
const { solveBoard } = await import('./assignmentSolver.js');

const MARK = fixtureMark('lockin');
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'FLEX', 'FLEX', 'K'];
const TEAMS = [
  { key: 'L1', abbr: 'L1', card: [{ position: 'QB', name: 'Lock QB', points: 30, meta: '' }, { position: 'RB', name: 'Lock RB0', points: 9, meta: '' }] },
  { key: 'L2', abbr: 'L2', card: [{ position: 'RB', name: 'Lock RB1', points: 25, meta: '' }] },
  { key: 'L3', abbr: 'L3', card: [{ position: 'RB', name: 'Lock RB2', points: 20, meta: '' }] },
  { key: 'L4', abbr: 'L4', card: [{ position: 'WR', name: 'Lock WR1', points: 18, meta: '' }] },
  { key: 'L5', abbr: 'L5', card: [{ position: 'WR', name: 'Lock WR2', points: 17, meta: '' }] },
  { key: 'L6', abbr: 'L6', card: [{ position: 'TE', name: 'Lock TE', points: 15, meta: '' }] },
  { key: 'L7', abbr: 'L7', card: [{ position: 'RB', name: 'Lock RB3', points: 12, meta: '' }] },
  { key: 'L8', abbr: 'L8', card: [{ position: 'PK', name: 'Lock K', points: 10, meta: '' }] },
];
const PICKS = TEAMS.map((t, slotIndex) => ({ slotIndex, teamKey: t.key, playerName: t.card[0].name }));
const EDITION = '2096-06-06';
const OPENS = '2096-06-06T04:00:00Z';
const CLOSES = '2096-06-07T04:00:00Z';
const at = (s) => new Date(new Date(OPENS).getTime() + s * 1000).toISOString();

let boardId = null; const users = []; const devices = [];
async function user(tag) {
  const id = (await sql`INSERT INTO users (email, handle) VALUES (${MARK.email(tag)}, ${MARK.handle(tag)}) RETURNING id`)[0].id;
  users.push(id); return id;
}
const dev = (tag) => { const d = `${MARK.run}-${tag}`; devices.push(d); return d; };

before(async () => {
  for (const b of await sql`SELECT id FROM daily_boards WHERE edition_date = ${EDITION}`) {
    await sql`DELETE FROM daily_board_runs WHERE board_id = ${b.id}`;
    await G.deleteGuestRunsForBoard(sql, b.id);
    await sql`DELETE FROM daily_boards WHERE id = ${b.id}`;
  }
  const opt = solveBoard(TEAMS, SLOTS);
  boardId = (await sql`
    INSERT INTO daily_boards (edition_date, season_year, seed, board, ceiling, best_roster, slots, opens_at, closes_at)
    VALUES (${EDITION}, 2096, 'lockin-seed', ${JSON.stringify(TEAMS)}::jsonb, ${opt.total},
            ${JSON.stringify(opt.bySlot)}::jsonb, ${JSON.stringify(SLOTS)}::jsonb, ${OPENS}::timestamptz, ${CLOSES}::timestamptz)
    RETURNING id`)[0].id;
});

after(async () => {
  if (boardId) {
    await sql`DELETE FROM daily_board_runs WHERE board_id = ${boardId}`;
    await G.deleteGuestRunsForBoard(sql, boardId);
    await sql`DELETE FROM daily_boards WHERE id = ${boardId}`;
  }
  for (const id of users) await sql`DELETE FROM users WHERE id = ${id}`;
});

// Both run kinds, one set of assertions.
const KINDS = {
  'signed-in': async (tag) => {
    const userId = await user(tag);
    const s = await startRun(sql, { boardId, userId, now: OPENS });
    assert.equal(s.ok, true, s.reason);
    return { who: { boardId, userId }, run: s.run, submit: (picks, now) => submitRun(sql, { boardId, userId, picks, elapsedS: 60, now }) };
  },
  guest: async (tag) => {
    const deviceId = dev(tag);
    const s = await G.startGuestRun(sql, { boardId, deviceId, now: OPENS });
    assert.equal(s.ok, true, s.reason);
    return { who: { boardId, runId: s.run.id, deviceId }, run: s.run, submit: (picks, now) => G.submitGuestRun(sql, { runId: s.run.id, boardId, deviceId, picks, now }) };
  },
};

for (const [kind, open] of Object.entries(KINDS)) {
  test(`${kind}: the start records empty steps and hands over NAMES ONLY`, async () => {
    const { run } = await open('names');
    assert.deepEqual(run.steps, L.emptySteps());
    const [b] = await sql`SELECT * FROM daily_boards WHERE id = ${boardId}`;
    const v = L.progressView(b, run.steps);
    assert.ok(v.teams.every((t) => t.card.length === 0), 'no card in the start payload');
  });

  test(`${kind}: BACK-OUT BLOCKED - a second team choice for an open slot is refused by the server`, async () => {
    const { who } = await open('backout');
    const c = await L.chooseStep(sql, who, 'L2', { now: at(10) });
    assert.equal(c.ok, true, c.reason);
    assert.equal(c.team.card[0].name, 'Lock RB1', 'the chosen card comes back with the choice');
    const back = await L.chooseStep(sql, who, 'L3', { now: at(11) });
    assert.equal(back.ok, false); assert.equal(back.status, 409); assert.match(back.reason, /pick a player from L2 first/);
  });

  test(`${kind}: a pick from an UNCOMMITTED team is refused - with no team chosen, and from another team`, async () => {
    const { who } = await open('uncommitted');
    assert.match((await L.pickStep(sql, who, 1, 'Lock RB1', { now: at(5) })).reason, /choose a team first/);
    await L.chooseStep(sql, who, 'L2', { now: at(6) });
    const other = await L.pickStep(sql, who, 2, 'Lock RB2', { now: at(7) });
    assert.equal(other.ok, false); assert.match(other.reason, /committed to L2/);
  });

  test(`${kind}: CHANGE BLOCKED - a placed pick is final`, async () => {
    const { who } = await open('change');
    await L.chooseStep(sql, who, 'L2', { now: at(5) });
    assert.equal((await L.pickStep(sql, who, 1, 'Lock RB1', { now: at(6) })).ok, true);
    await L.chooseStep(sql, who, 'L3', { now: at(7) });
    const swap = await L.pickStep(sql, who, 1, 'Lock RB2', { now: at(8) });
    assert.equal(swap.ok, false); assert.match(swap.reason, /that pick is final/);
    assert.match((await L.chooseStep(sql, who, 'L2', { now: at(9) })).reason, /pick a player from L3 first/);
  });

  test(`${kind}: a NORMAL FULL RUN still works - graded from the steps, the client's list ignored`, async () => {
    const { who, submit } = await open('full');
    const sneak = await submit(PICKS, at(20));
    assert.equal(sneak.ok, false); assert.equal(sneak.reason, 'nothing picked', 'a list sent without the steps grades nothing');
    const played = await L.playPicks(sql, who, PICKS, { now: at(30) });
    assert.equal(played.ok, true, played.reason);
    const lie = PICKS.map((p, i) => (i === 0 ? { slotIndex: 0, teamKey: 'L1', playerName: 'Lock RB0' } : p));
    const r = await submit(lie, at(60));
    assert.equal(r.ok, true, r.reason);
    const stored = r.run.picks.find((p) => p.slotIndex === 0);
    assert.equal(stored.playerName, 'Lock QB', 'what was placed is what is graded');
    assert.equal(Number(r.run.score), 147);
  });

  test(`${kind}: two racing choices (two tabs) - exactly one wins`, async () => {
    const { who } = await open('race');
    const [a, b] = await Promise.all([L.chooseStep(sql, who, 'L4', { now: at(5) }), L.chooseStep(sql, who, 'L5', { now: at(5) })]);
    assert.equal([a, b].filter((r) => r.ok).length, 1, JSON.stringify([a.reason, b.reason]));
  });

  test(`${kind}: after the clock, no step is taken`, async () => {
    const { who } = await open('clock');
    assert.equal((await L.chooseStep(sql, who, 'L2', { now: at(186) })).reason, 'time expired');
  });
}

test('A RUN FROM BEFORE THE LOCK-IN (steps NULL) keeps its picks and the submit-all path', async () => {
  const userId = await user('legacy');
  await startRun(sql, { boardId, userId, now: OPENS });
  await sql`UPDATE daily_board_runs SET steps = NULL WHERE board_id = ${boardId} AND user_id = ${userId}`;
  const r = await submitRun(sql, { boardId, userId, picks: PICKS, elapsedS: 60, now: at(60) });
  assert.equal(r.ok, true, r.reason);
  assert.equal(Number(r.run.score), 147);
});
