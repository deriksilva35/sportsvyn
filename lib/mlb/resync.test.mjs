// lib/mlb/resync.test.mjs - the schedule re-sync through the REAL writer
// against DEV, with BDL answered by a stubbed fetch. Every fixture is dated in
// July 2099 - outside any real schedule - and carries a sentinel BDL id; the
// teardown removes them and asserts it did.
//
//   both orderings      a new doubleheader gets the same slugs whichever way BDL lists it
//   moved game 1        the row already on the day keeps its slug; the moved one takes -g2
//   new makeup id       inserted beside the filed game, never over it
//   live guard          a game BDL calls in progress gets its time, not our state
//   gone / moved out    404 cancels an unplayed row (never a final); moved out is followed by id
//   postseason          an if-necessary game takes its series' round, and a round is never unset
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

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

const { sql } = await import('../db.js');
const { resyncMlbSchedule, resyncDue, firstPitchOfDay, DAILY_HOUR_UTC } = await import('./resync.js');
const { writeMlbMatches } = await import('./schedule.js');

const BASE = 990_000_000 + (process.pid % 100_000) * 100;   // sentinel BDL ids, per process
const id = (n) => BASE + n;
let league; let T;                                           // T.a..T.f: { bdl, abbr }

const row = (n, date, a, h, extra = {}) => ({
  id: id(n), date, season: 2099, season_type: 'regular', postseason: false,
  status_state: 'scheduled', status: 'STATUS_SCHEDULED', period: 0, venue: 'Sentinel Park',
  away_team: { id: Number(a.bdl), abbreviation: a.abbr }, home_team: { id: Number(h.bdl), abbreviation: h.abbr },
  home_team_data: { runs: null, hits: null, errors: null, inning_scores: [] },
  away_team_data: { runs: null, hits: null, errors: null, inning_scores: [] },
  scoring_summary: [], ...extra,
});
const finalOf = (r, away, home) => ({ ...r, status_state: 'final', status: 'STATUS_FINAL', period: 9,
  away_team_data: { runs: away, hits: 8, errors: 0, inning_scores: [away, 0, 0, 0, 0, 0, 0, 0, 0] },
  home_team_data: { runs: home, hits: 6, errors: 1, inning_scores: [home, 0, 0, 0, 0, 0, 0, 0, 0] } });

// BDL, as this test says it is right now
let feed = []; let byIdOnly = new Map();
const fetchImpl = async (url) => {
  const u = String(url);
  const one = /\/mlb\/v1\/games\/(\d+)$/.exec(u);
  if (one) {
    const r = feed.find((x) => String(x.id) === one[1]) ?? byIdOnly.get(one[1]);
    return r ? Response.json({ data: r }) : new Response('Not Found', { status: 404 });
  }
  if (u.includes('/mlb/v1/games?')) return Response.json({ data: feed, meta: {} });
  return new Response('{}', { status: 404 });
};
const resync = (from, to, o = {}) => resyncMlbSchedule(sql, { from, to, fetchImpl, key: 'test', ...o });
const bySlugDay = async (day) => sql`
  SELECT id, slug, status, kickoff_at, home_score, away_score, stage, metadata->'live_state' AS ls,
         external_ids->>'bdl_game_id' AS bdl
    FROM matches WHERE league_id = ${league} AND slug LIKE ${`mlb-${day}-%`} ORDER BY slug`;
const byBdl = async (n) => (await sql`
  SELECT id, slug, status, kickoff_at, home_score, away_score, stage, metadata->'live_state' AS ls
    FROM matches WHERE league_id = ${league} AND external_ids->>'bdl_game_id' = ${String(id(n))}`)[0];

before(async () => {
  [{ id: league }] = await sql`SELECT id FROM leagues WHERE slug = 'mlb'`;
  const t = await sql`
    SELECT abbreviation AS abbr, external_ids->>'bdl_team_id' AS bdl FROM teams
     WHERE league_id = ${league} AND jsonb_exists(external_ids, 'bdl_team_id') ORDER BY id LIMIT 6`;
  T = { a: t[0], b: t[1], c: t[2], d: t[3], e: t[4], f: t[5] };
});

after(async () => {
  await sql`DELETE FROM matches WHERE league_id = ${league}
             AND ((external_ids->>'bdl_game_id')::bigint BETWEEN ${BASE} AND ${BASE + 99} OR slug LIKE 'mlb-2099-%')`;
  const [left] = await sql`SELECT count(*)::int n FROM matches WHERE league_id = ${league} AND slug LIKE 'mlb-2099-%'`;
  assert.equal(left.n, 0, 'the sentinels are gone');
});

const lo = (x) => x.toLowerCase();

test('BOTH ORDERINGS: a new doubleheader is filed the same whichever order BDL lists it', async () => {
  const early = row(1, '2099-07-01T17:05:00Z', T.a, T.b); const late = row(2, '2099-07-01T23:05:00Z', T.a, T.b);
  const early2 = row(3, '2099-07-02T17:05:00Z', T.a, T.b); const late2 = row(4, '2099-07-02T23:05:00Z', T.a, T.b);
  await writeMlbMatches(sql, league, [late, early]);
  await writeMlbMatches(sql, league, [early2, late2]);
  const base1 = `mlb-2099-07-01-${lo(T.a.abbr)}-${lo(T.b.abbr)}`; const base2 = `mlb-2099-07-02-${lo(T.a.abbr)}-${lo(T.b.abbr)}`;
  assert.equal((await byBdl(1)).slug, base1); assert.equal((await byBdl(2)).slug, `${base1}-g2`);
  assert.equal((await byBdl(3)).slug, base2); assert.equal((await byBdl(4)).slug, `${base2}-g2`);
  // and re-importing either way round changes nothing
  const again = await writeMlbMatches(sql, league, [early2, late2, late, early]);
  assert.deepEqual(again.changes, []);
});

test('THE MOVED GAME 1: the filed row keeps its slug, the moved one takes -g2 and its new time - both orders', async () => {
  for (const [k, [away, home]] of [[10, [T.c, T.d]], [20, [T.e, T.f]]]) {
    // filed: game 2 on the 3rd, game 1 on the 4th
    const g2 = row(k + 1, '2099-07-03T23:05:00Z', away, home);
    const g1 = row(k + 2, '2099-07-04T23:15:00Z', away, home);
    await writeMlbMatches(sql, league, [g2, g1]);
    const base = `mlb-2099-07-03-${lo(away.abbr)}-${lo(home.abbr)}`;
    assert.equal((await byBdl(k + 2)).slug, `mlb-2099-07-04-${lo(away.abbr)}-${lo(home.abbr)}`);
    // BDL moves game 1 into the 3rd as a doubleheader
    const moved = { ...g1, date: '2099-07-03T20:05:00Z' };
    feed = k === 10 ? [moved, g2] : [g2, moved];
    const r = await resync('2099-07-03', '2099-07-04');
    assert.equal(r.ok, true, JSON.stringify(r.refused));
    assert.equal((await byBdl(k + 1)).slug, base, 'never renamed');
    const m = await byBdl(k + 2);
    assert.equal(m.slug, `${base}-g2`);
    assert.equal(new Date(m.kickoff_at).toISOString(), '2099-07-03T20:05:00.000Z');
    const ch = r.changes.find((c) => c.bdl === String(id(k + 2)));
    assert.equal(ch.slugFrom, `mlb-2099-07-04-${lo(away.abbr)}-${lo(home.abbr)}`);
    assert.equal(ch.kickoffFrom, '2099-07-04T23:15:00.000Z');
  }
});

test('A NEW MAKEUP ID is inserted beside the filed game, with its result', async () => {
  const filed = row(30, '2099-07-05T22:35:00Z', T.b, T.a);
  await writeMlbMatches(sql, league, [filed]);
  feed = [filed, finalOf(row(31, '2099-07-05T17:35:00Z', T.b, T.a), 3, 5)];
  const r = await resync('2099-07-05', '2099-07-05');
  const base = `mlb-2099-07-05-${lo(T.b.abbr)}-${lo(T.a.abbr)}`;
  assert.equal((await byBdl(30)).slug, base);
  const m = await byBdl(31);
  assert.equal(m.slug, `${base}-g2`); assert.equal(m.status, 'final');
  assert.equal(m.away_score, 3); assert.equal(m.home_score, 5);
  assert.equal(r.inserted, 1);
});

test('THE LIVE GUARD: a game BDL calls in progress gets its new time, and keeps OUR state', async () => {
  const g = row(40, '2099-07-06T23:10:00Z', T.c, T.a);
  await writeMlbMatches(sql, league, [g]);
  const rich = { period: 3, half: 'Top', outs: 2, balls: 1, strikes: 2, bases: { first: true, second: false, third: true }, batter: 'Poller Batter', pitcher: 'Poller Pitcher' };
  const [{ id: mid }] = await sql`UPDATE matches SET status = 'live', home_score = 2, away_score = 1,
    metadata = metadata || jsonb_build_object('live_state', ${JSON.stringify(rich)}::jsonb)
    WHERE external_ids->>'bdl_game_id' = ${String(id(40))} RETURNING id`;
  feed = [{ ...g, date: '2099-07-06T21:30:00Z', status_state: 'in_progress', status: 'STATUS_IN_PROGRESS', period: 3,
    home_team_data: { runs: 0, hits: 0, errors: 0, inning_scores: [0] }, away_team_data: { runs: 0, hits: 0, errors: 0, inning_scores: [0] } }];
  await resync('2099-07-06', '2099-07-06');
  const [m] = await sql`SELECT status, kickoff_at, home_score, away_score, metadata->'live_state' AS ls FROM matches WHERE id = ${mid}`;
  assert.equal(new Date(m.kickoff_at).toISOString(), '2099-07-06T21:30:00.000Z', 'the time is the schedule\'s');
  assert.equal(m.status, 'live'); assert.equal(m.home_score, 2); assert.equal(m.away_score, 1);
  assert.deepEqual(m.ls, rich, 'the runners and the count are the poller\'s');
});

test('GONE OR MOVED OUT: 404 cancels an unplayed row and never a final; a game moved out of the window is followed by id', async () => {
  const sched = row(50, '2099-07-07T19:05:00Z', T.d, T.e);
  const fin = finalOf(row(51, '2099-07-07T17:05:00Z', T.e, T.f), 1, 2);
  const out = row(52, '2099-07-07T23:05:00Z', T.f, T.a);
  await writeMlbMatches(sql, league, [sched, fin, out]);
  feed = [];
  byIdOnly = new Map([[String(id(52)), { ...out, date: '2099-07-20T23:05:00Z' }]]);
  const r = await resync('2099-07-07', '2099-07-07');
  assert.equal((await byBdl(50)).status, 'cancelled');
  assert.equal((await byBdl(51)).status, 'final', 'a played game is never cancelled');
  const m = await byBdl(52);
  assert.equal(new Date(m.kickoff_at).toISOString(), '2099-07-20T23:05:00.000Z');
  assert.equal(m.slug, `mlb-2099-07-20-${lo(T.f.abbr)}-${lo(T.a.abbr)}`, 'moved to another day: filed under it');
  assert.deepEqual(r.cancelled.map((c) => c.bdl), [String(id(50))]);
  byIdOnly = new Map();
});

test('POSTSEASON: an if-necessary game takes its series\' round; a round is never unset by the re-sync', async () => {
  const post = (n, date) => row(n, date, T.a, T.c, { season_type: 'postseason', postseason: true });
  const g1 = post(60, '2099-07-08T23:05:00Z');
  await writeMlbMatches(sql, league, [g1], new Map([[String(id(60)), 'division']]));
  const g5 = post(61, '2099-07-09T23:05:00Z');             // BDL adds game 5
  feed = [g1, g5];
  const r = await resync('2099-07-08', '2099-07-09');
  assert.equal((await byBdl(60)).stage, 'division');
  assert.equal((await byBdl(61)).stage, 'division', 'the series\' round');
  assert.ok(r.stagedFromSeries >= 1);
  // a postseason game of a series nobody has placed stays unstaged
  feed = [post(62, '2099-07-09T19:05:00Z')].map((x) => ({ ...x, away_team: { id: Number(T.b.bdl), abbreviation: T.b.abbr } }));
  await resync('2099-07-09', '2099-07-09');
  assert.equal((await byBdl(62)).stage, null);
});

test('resyncDue: daily, once before first pitch, every two hours in the postseason', () => {
  const at = (h, m = 50) => new Date(Date.UTC(2099, 6, 1, h, m));
  assert.deepEqual(resyncDue(at(DAILY_HOUR_UTC)), { run: true, why: 'daily' });
  assert.equal(resyncDue(at(3)).run, false);
  const fp = new Date(Date.UTC(2099, 6, 1, 17, 5));
  const ticks = Array.from({ length: 24 }, (_, h) => at(h)).filter((t) => resyncDue(t, { firstPitch: fp }).why === 'pre-first-pitch');
  assert.deepEqual(ticks.map((t) => t.getUTCHours()), [14], 'exactly one hourly tick, 2h15m before 17:05');
  const post = Array.from({ length: 24 }, (_, h) => at(h)).filter((t) => resyncDue(t, { postseason: true }).run);
  assert.equal(post.length, 12);
});

test('firstPitchOfDay is the American day\'s earliest, not the next game', () => {
  const now = new Date('2099-07-01T15:00:00Z');                 // 11am in New York
  const ks = ['2099-07-01T17:05:00Z', '2099-07-01T23:05:00Z', '2099-07-02T01:40:00Z', '2099-07-02T17:05:00Z'];
  assert.equal(firstPitchOfDay(ks, now).toISOString(), '2099-07-01T17:05:00.000Z');
  // after the first pitch the day's first pitch is still the same one - no second pre-game run
  assert.equal(firstPitchOfDay(ks, new Date('2099-07-01T20:00:00Z')).toISOString(), '2099-07-01T17:05:00.000Z');
});

test('the cron is scheduled hourly at :50 and the route runs the re-sync under a lock', () => {
  const v = JSON.parse(readFileSync(path.join(REPO, 'vercel.json'), 'utf8'));
  const c = v.crons.find((x) => x.path === '/api/cron/mlb-schedule');
  assert.equal(c?.schedule, '50 * * * *');
  const route = readFileSync(path.join(REPO, 'app/api/cron/mlb-schedule/route.js'), 'utf8');
  assert.match(route, /cronAuthorized\(request\)/);
  assert.match(route, /withAdvisoryLock\(SOURCE/);
  assert.match(route, /resyncMlbSchedule\(sql/);
});
