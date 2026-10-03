// lib/cfb/finalKick.test.mjs - the CFB final kick (sun-6 item 2): the throttle
// on a fake clock, the once-per-match gate, the run's contract with injected
// deps (no DB, no CFBD), and the wiring into the live poller, read from source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createKickThrottle, newFinals, weekKey, KICK_WINDOW_MS, KICK_MAX_ATTEMPTS } from './finalKick.js';

const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const MIN = 60_000;
const flush = () => new Promise((r) => setImmediate(r));

// A clock and a timer queue the test advances by hand.
function fakeClock(start = 0) {
  let t = start;
  const timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { const h = { at: t + ms, fn, done: false }; timers.push(h); return h; },
    clearTimer: (h) => { h.done = true; },
    async advance(ms) {
      await flush(); // let a run started at the current instant begin at it
      const end = t + ms;
      for (;;) {
        const next = timers.filter((h) => !h.done && h.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        t = next.at; next.done = true; next.fn();
        await flush(); await flush();
      }
      t = end;
      await flush(); await flush();
    },
  };
}

const wk = (week, ids, season = 2026, phase = 'REG') => ({ season, phase, week, matchIds: ids });

function harness({ results = [] } = {}) {
  const clock = fakeClock(1_000_000);
  const runs = [];
  const run = async (batch) => {
    runs.push({ at: clock.now(), batch: batch.map((b) => ({ ...b })) });
    const r = results.shift();
    if (r instanceof Error) throw r;
    return r ?? { requeue: [] };
  };
  const th = createKickThrottle({ run, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  return { clock, runs, th };
}

test('the window is ten minutes and a box gets three tries before the cron owns it', () => {
  assert.equal(KICK_WINDOW_MS, 10 * MIN);
  assert.equal(KICK_MAX_ATTEMPTS, 3);
});

test('LEADING EDGE: the first final runs at once', async () => {
  const { clock, runs, th } = harness();
  th.enqueue([wk(6, [101])]);
  await flush(); await flush();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].at, 1_000_000);
  assert.deepEqual(runs[0].batch.map(weekKey), ['2026|REG|6']);
  assert.equal(th.state().pending.length, 0);
  void clock;
});

test('TRAILING RUN: finals inside the window coalesce into ONE run at the window end', async () => {
  const { clock, runs, th } = harness();
  th.enqueue([wk(6, [101])]);
  await flush(); await flush();
  await clock.advance(2 * MIN);
  th.enqueue([wk(6, [102])]);
  await clock.advance(3 * MIN);
  th.enqueue([wk(6, [103]), wk(1, [900], 2026, 'POST')]);
  assert.equal(runs.length, 1, 'nothing runs inside the window');
  await clock.advance(4 * MIN); // t0 + 9 min
  assert.equal(runs.length, 1);
  await clock.advance(1 * MIN); // t0 + 10 min: the window ends
  assert.equal(runs.length, 2, 'one trailing run, not three');
  assert.equal(runs[1].at - runs[0].at, KICK_WINDOW_MS);
  const b = runs[1].batch;
  assert.deepEqual(b.map(weekKey).sort(), ['2026|POST|1', '2026|REG|6']);
  assert.deepEqual(b.find((x) => x.week === 6).matchIds.sort(), [102, 103]);
});

test('AT MOST ONE RUN PER TEN MINUTES across a whole Saturday of finals', async () => {
  const { clock, runs, th } = harness();
  for (let i = 0; i < 12 * 60; i += 1) { // a final every minute for twelve hours
    th.enqueue([wk(6, [5000 + i])]);
    await clock.advance(MIN);
  }
  await clock.advance(KICK_WINDOW_MS);
  for (let i = 1; i < runs.length; i += 1) {
    assert.ok(runs[i].at - runs[i - 1].at >= KICK_WINDOW_MS, `runs ${i - 1}/${i} closer than the window`);
  }
  assert.ok(runs.length <= 12 * 6 + 1, `${runs.length} runs in twelve hours`);
  const covered = new Set(runs.flatMap((r) => r.batch.flatMap((b) => b.matchIds)));
  assert.equal(covered.size, 12 * 60, 'every final rode some run');
});

test('a final after a quiet spell runs at once - the window is start to start, not a fixed grid', async () => {
  const { clock, runs, th } = harness();
  th.enqueue([wk(6, [1])]);
  await flush(); await flush();
  await clock.advance(37 * MIN);
  th.enqueue([wk(6, [2])]);
  await flush(); await flush();
  assert.equal(runs.length, 2);
  assert.equal(runs[1].at - runs[0].at, 37 * MIN);
});

test('a final arriving WHILE a run is out waits for that run, then rides the trailing one', async () => {
  const clock = fakeClock(0);
  const runs = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const run = async (batch) => { runs.push({ at: clock.now(), batch }); if (runs.length === 1) await gate; return { requeue: [] }; };
  const th = createKickThrottle({ run, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  th.enqueue([wk(6, [1])]);
  await flush();
  await clock.advance(12 * MIN); // the first run is slow - past the window
  th.enqueue([wk(6, [2])]);
  await flush();
  assert.equal(runs.length, 1, 'never two runs at once');
  release(); await flush(); await flush(); await flush();
  assert.equal(runs.length, 2, 'the window had passed, so the queued final runs as soon as the first ends');
  assert.deepEqual(runs[1].batch[0].matchIds, [2]);
});

test('RETRY: a box CFBD has not published goes round on the next window, up to three runs', async () => {
  const notYet = { requeue: [wk(6, [101])] };
  const { clock, runs, th } = harness({ results: [notYet, notYet, notYet, notYet] });
  th.enqueue([wk(6, [101, 102])]);
  await flush(); await flush();
  assert.equal(runs.length, 1);
  await clock.advance(KICK_WINDOW_MS);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs[1].batch[0].matchIds, [101], 'only the unlanded game goes round');
  await clock.advance(KICK_WINDOW_MS);
  assert.equal(runs.length, 3);
  await clock.advance(5 * KICK_WINDOW_MS);
  assert.equal(runs.length, 3, 'three runs, then the hourly cron owns it');
  assert.equal(th.state().pending.length, 0);
});

test('a run that THROWS never reaches the caller, and its batch goes round again', async () => {
  const { clock, runs, th } = harness({ results: [new Error('CFBD 503')] });
  assert.doesNotThrow(() => th.enqueue([wk(6, [7])]));
  await flush(); await flush(); await flush();
  assert.equal(runs.length, 1);
  await clock.advance(KICK_WINDOW_MS);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs[1].batch[0].matchIds, [7]);
});

test('enqueue ignores junk and never throws', () => {
  const { th, runs } = harness();
  assert.doesNotThrow(() => th.enqueue(null));
  assert.doesNotThrow(() => th.enqueue([null, { week: 6 }, { season: 2026 }]));
  assert.equal(runs.length, 0);
});

// ------------------------------------------------------- the transition

test('TRANSITION: live -> final is a final once; an already-final row on later ticks is not', async () => {
  const { turnedFinal } = await import('../../services/live-poller/poll.mjs');
  assert.equal(turnedFinal('live', 'final'), true);
  assert.equal(turnedFinal('scheduled', 'final'), true, 'a game first seen at its final still counts');
  assert.equal(turnedFinal('final', 'final'), false, 'every tick after the flip is not a flip');
  assert.equal(turnedFinal('live', 'live'), false);
  assert.equal(turnedFinal('final', 'live'), false);

  // Ticks of one game through the poll's predicate and the kick's gate.
  const seen = new Set();
  const ticks = ['scheduled', 'live', 'live', 'final', 'final', 'final', 'live', 'final', 'final'];
  let prev = null; const kicked = [];
  for (const s of ticks) {
    const finalIds = prev != null && turnedFinal(prev, s) ? [42] : [];
    kicked.push(...newFinals(finalIds, seen));
    prev = s;
  }
  assert.deepEqual(kicked, [42], 'one kick for the game, even across a final -> live -> final flap');
});

test('newFinals: unseen ids only, numeric, nulls dropped', () => {
  const seen = new Set([3]);
  assert.deepEqual(newFinals([1, '2', null, 3, 1], seen), [1, 2]);
  assert.deepEqual(newFinals([1, 2], seen), []);
  assert.deepEqual(newFinals(undefined, seen), []);
});

// ------------------------------------------------------- the run

const { runKickedImport, cfbFinalWeeks, LOCK_SOURCE, KICK_SOURCE } = await import('./finalKickRun.js');

function fakeSql(heldIds = []) {
  const calls = [];
  const fn = async (strings, ...vals) => { calls.push({ q: strings.join('?'), vals }); return heldIds.map((id) => ({ match_id: id })); };
  fn.calls = calls;
  return fn;
}
const passLock = async (source, f) => ({ locked: false, result: await f(), source });
const passRecord = async (sql, { source, kind, run }) => {
  try { return { ok: true, summary: await run(), source, kind }; }
  catch (e) { return { ok: false, error: String(e.message), source, kind }; }
};
const baseDeps = (over = {}) => ({
  log: () => {}, lock: passLock, record: passRecord, decide: async () => {},
  roster: async () => new Map(), matchesFor: async () => new Map(),
  importWeek: async () => ({ requests: 1, inserted: 40, updated: 0 }),
  ...over,
});

test('the lock is the CRON\'s, and the ledger and the alarm are the kick\'s own', () => {
  const route = src('app/api/cron/cfb-player-stats/route.js');
  const m = route.match(/export const SOURCE = '([^']+)';/);
  assert.ok(m, 'the cron declares its SOURCE');
  assert.equal(LOCK_SOURCE, m[1], 'the kick must lock on the cron\'s source or the two can overlap');
  assert.equal(KICK_SOURCE, 'cfb-player-stats-kick');
  assert.notEqual(KICK_SOURCE, LOCK_SOURCE, 'a shared alert source lets one path silence the other for six hours');
});

test('run: one import per kicked week, under the cron lock, recorded under the kick source', async () => {
  const locks = []; const records = []; const imports = [];
  const sql = fakeSql([101, 102]);
  const res = await runKickedImport([wk(6, [101]), wk(1, [102], 2026, 'POST')], { sql, ...baseDeps({
    lock: async (s, f) => { locks.push(s); return passLock(s, f); },
    record: async (q, o) => { records.push([o.source, o.kind]); return passRecord(q, o); },
    importWeek: async (season, week, o) => { imports.push([season, week, o.seasonPhase]); return { requests: 1, inserted: 3, updated: 0 }; },
  }) });
  assert.deepEqual(locks, ['cfb-player-stats']);
  assert.deepEqual(records, [['cfb-player-stats-kick', 'import']]);
  assert.deepEqual(imports, [[2026, 6, 'REG'], [2026, 1, 'POST']]);
  assert.deepEqual(res.requeue, [], 'both boxes landed');
});

test('run: a kicked game still without rows goes back for another try', async () => {
  const res = await runKickedImport([wk(6, [101, 102])], { sql: fakeSql([102]), ...baseDeps() });
  assert.deepEqual(res.requeue, [wk(6, [101])]);
});

test('run: locked out by the cron -> skipped-locked row, whole batch requeued, no import', async () => {
  const decided = []; let imported = 0;
  const batch = [wk(6, [101])];
  const res = await runKickedImport(batch, { sql: fakeSql(), ...baseDeps({
    lock: async () => ({ locked: true }),
    decide: async (_, o) => { decided.push([o.source, o.kind]); },
    importWeek: async () => { imported += 1; return {}; },
  }) });
  assert.equal(imported, 0);
  assert.deepEqual(decided, [['cfb-player-stats-kick', 'skipped-locked']]);
  assert.deepEqual(res.requeue, batch);
});

test('run: a failed import reaches maybeAlert under the kick source and is requeued', async () => {
  const alerts = [];
  const batch = [wk(6, [101])];
  const res = await runKickedImport(batch, { sql: fakeSql(), ...baseDeps({
    importWeek: async () => { throw new Error('CFBD 500 on /games/players'); },
    alert: async (_, o) => { alerts.push(o); },
  }) });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].source, 'cfb-player-stats-kick');
  assert.match(alerts[0].body, /CFBD 500/);
  assert.deepEqual(res.requeue, batch);
});

test('run: NEVER throws, even when the lock itself blows up', async () => {
  const batch = [wk(6, [101])];
  const res = await runKickedImport(batch, { sql: fakeSql(), ...baseDeps({
    lock: async () => { throw new Error('ws down'); },
  }) });
  assert.deepEqual(res.requeue, batch);
});

test('cfbFinalWeeks groups the kicked finals by CFBD (season, phase, week)', async () => {
  const sql = async () => [
    { id: 1, season_year: 2026, season_phase: 'REG', week: 6 },
    { id: 2, season_year: 2026, season_phase: 'REG', week: 6 },
    { id: 3, season_year: 2026, season_phase: 'POST', week: 1 },
  ];
  const out = await cfbFinalWeeks(sql, [1, 2, 3, 99]);
  assert.deepEqual(out, [wk(6, [1, 2]), wk(1, [3], 2026, 'POST')]);
  assert.deepEqual(await cfbFinalWeeks(sql, []), []);
});

test('cfbFinalWeeks reads matches.week (CFBD\'s week), cfb only', () => {
  const run = src('lib/cfb/finalKickRun.js');
  assert.match(run, /SELECT m\.id, m\.season_year, m\.season_phase, m\.week\s+FROM matches m JOIN leagues lg ON lg\.id = m\.league_id AND lg\.slug = 'cfb'/);
  assert.doesNotMatch(run, /contests|iso_week/);
});

// ------------------------------------------------------- the wiring

test('WIRING: the poller kicks the CFB import from its final path, contained and not awaited', () => {
  const index = src('services/live-poller/index.mjs');
  const poll = src('services/live-poller/poll.mjs');
  assert.match(poll, /export const turnedFinal = \(before, after\) => after === 'final' && before !== 'final';/);
  assert.match(poll, /if \(turnedFinal\(m\.status, after\.status\)\) \{ out\.finals \+= 1; out\.finalIds\.push\(m\.id\); \}/);
  assert.match(index, /import \{ createKickThrottle, newFinals \} from '\.\.\/\.\.\/lib\/cfb\/finalKick\.js';/);
  assert.match(index, /import \{ cfbFinalWeeks, runKickedImport \} from '\.\.\/\.\.\/lib\/cfb\/finalKickRun\.js';/);
  assert.match(index, /const cfbKick = createKickThrottle\(\{ run: \(batch\) => runKickedImport\(batch, \{ sql, log \}\), log \}\);/);
  assert.match(index, /if \(lg\.slug === 'cfb' && r\.finalIds\?\.length\) \{\s*const ids = newFinals\(r\.finalIds, cfbKicked\);\s*try \{\s*if \(ids\.length\) cfbKick\.enqueue\(await cfbFinalWeeks\(sql, ids\)\);\s*\} catch/);
  // enqueue is synchronous: the import is never on the poll loop's await chain.
  assert.doesNotMatch(index, /await cfbKick\./);
  assert.doesNotMatch(index, /await runKickedImport/);
  // The poller's lib/db.js must be PROD, the same database as its own client
  // and the cron's lock: the unit runs with the prod preload.
  const unit = src('services/live-poller/systemd/sportsvyn-live-poller.service');
  assert.match(unit, /--import \.\/services\/_preload\/prod-db\.mjs services\/live-poller\/index\.mjs/);
});

test('the hourly cron stays the backstop and its header says so', () => {
  const V = JSON.parse(src('vercel.json'));
  assert.equal(V.crons.find((c) => c.path === '/api/cron/cfb-player-stats').schedule, '0 * * * *');
  const route = src('app/api/cron/cfb-player-stats/route.js');
  const header = route.slice(0, route.indexOf('*/'));
  assert.doesNotMatch(header, /WEEKLY, NOT ALWAYS-ON/);
  assert.match(header, /HOURLY \(vercel\.json "0 \* \* \* \*"\)/);
});
