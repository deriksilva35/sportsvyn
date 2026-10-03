// lib/soccer/eplLive.test.mjs - the EPL live poller (thu-24): the pure reading
// of a fixture, the stuck rule, and a REPLAY on DEV of a finished matchweek-5
// match (Everton 1-0 Ipswich, 20 Sep, fixture 1557410) recorded read-only from
// the Ultra key: scheduled -> 1H -> HT -> 2H with a red -> FT -> player stats
// -> the +24h re-sync with a corrected value. The route's fetcher is injected;
// the database is DEV, through rows this file creates and removes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sql } from '../db.js';
import {
  goalsOf, redsOf, liveFromFixture, changed, stuckVerdict, diffStats, fullTimeOf, eventsSig,
  runEplLive, eplWindowOpen, RESETTLE_HOOKS, STUCK_QUIET_MIN, WINDOW_AFTER_MIN, LIVE_LEAGUES,
} from './eplLive.js';
import { importEplPlayerStats } from './playerStatsImport.js';

const REC = JSON.parse(readFileSync(new URL('./testdata/epl-mw5-1557410.json', import.meta.url), 'utf8'));
const [FUL_MU, NEW_HUL] = JSON.parse(readFileSync(new URL('./testdata/epl-mw5-events.json', import.meta.url), 'utf8'));
const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// PURE
// ---------------------------------------------------------------------------

test('GOALS: scorer, minute, side; an own goal counts for the side the provider names; a missed penalty is no goal', () => {
  assert.deepEqual(goalsOf(REC), [{ minute: 11, extra: null, side: 'home', player: 'T. Barry', assist: 'J. Tarkowski', kind: 'goal' }]);
  const og = goalsOf(FUL_MU);
  assert.equal(og.length, 2);
  assert.deepEqual(og[0], { minute: 63, extra: null, side: 'home', player: 'Lisandro Martínez', assist: null, kind: 'own' },
    'Martinez (Man United) put it in his own net: it counts for Fulham, the home side');
  const nh = goalsOf(NEW_HUL);
  assert.equal(nh.length, 3, "Wissa's 45+2 missed penalty is not a goal");
  assert.ok(!nh.some((g) => g.minute === 45));
  const pen = goalsOf({ teams: REC.teams, events: [{ time: { elapsed: 30, extra: null }, team: { id: 45 }, player: { name: 'X' }, assist: {}, type: 'Goal', detail: 'Penalty' }] });
  assert.equal(pen[0].kind, 'penalty');
  const so = goalsOf({ teams: REC.teams, events: [{ time: { elapsed: 120 }, team: { id: 45 }, player: { name: 'X' }, type: 'Goal', detail: 'Penalty', comments: 'Penalty Shootout' }] });
  assert.equal(so.length, 0, 'a shootout kick is not a goal in the match');
});

test('REDS: a second yellow and its Red Card are ONE sending-off', () => {
  assert.deepEqual(redsOf(REC), [{ minute: 67, extra: null, side: 'away', player: 'Abdul Fatawu Issahaku' }]);
  assert.deepEqual(redsOf(FUL_MU), []);
});

test('the fixture -> status, score, the flat live_state, halftime', () => {
  const ft = liveFromFixture(REC);
  assert.equal(ft.status, 'final'); assert.equal(ft.homeScore, 1); assert.equal(ft.awayScore, 0);
  assert.equal(ft.liveState, null, 'no clock outlives the match');
  assert.deepEqual(ft.halftime, { home: 1, away: 0 });
  const live = liveFromFixture({ ...REC, fixture: { ...REC.fixture, status: { short: '2H', elapsed: 67, extra: null } } });
  assert.deepEqual(live.liveState, { elapsed: 67, extra: null, period: '2H' });
  const ht = liveFromFixture({ ...REC, fixture: { ...REC.fixture, status: { short: 'HT', elapsed: 45, extra: null } } });
  assert.equal(ht.status, 'live'); assert.equal(ht.liveState.period, 'HT');
});

test('THE STUCK RULE: provider final, or absent from a GOOD response and quiet 30 min - never time since kickoff', () => {
  const now = new Date('2030-03-02T22:00:00Z');
  const row = (wroteMinAgo, extra = {}) => ({ status: 'live', kickoff_at: '2030-03-02T12:00:00Z', // ten hours ago
    metadata: { epl_live: { wroteAt: new Date(now - wroteMinAgo * 60000).toISOString() } }, ...extra });
  assert.equal(stuckVerdict({ row: row(600), fixture: { fixture: {} }, responseOk: true, now }), null,
    'ten hours after kickoff and quiet for ten: still live while the provider answers for it');
  assert.equal(stuckVerdict({ row: row(STUCK_QUIET_MIN - 1), fixture: null, responseOk: true, now }), null);
  assert.equal(stuckVerdict({ row: row(STUCK_QUIET_MIN), fixture: null, responseOk: true, now }), 'final');
  assert.equal(stuckVerdict({ row: row(600), fixture: null, responseOk: false, now }), null, 'a failed response proves nothing');
  assert.equal(stuckVerdict({ row: row(600, { status: 'scheduled' }), fixture: null, responseOk: true, now }), null);
  const code = src('lib/soccer/eplLive.js');
  const fn = code.slice(code.indexOf('export function stuckVerdict'), code.indexOf('/** When the whistle went'));
  assert.doesNotMatch(fn.replace(/\/\/.*$/gm, ''), /kickoff/, 'the stuck rule never reads kickoff_at');
});

test('changed(): a write only when a reader would see something move', () => {
  const next = liveFromFixture(REC);
  const row = { status: 'final', home_score: 1, away_score: 0, metadata: { live_state: null, epl_live: { sig: next.sig, halftime: { home: 1, away: 0 } } } };
  assert.equal(changed(row, next), false);
  assert.equal(changed({ ...row, home_score: 0 }, next), true);
  assert.equal(changed({ ...row, metadata: { ...row.metadata, epl_live: { ...row.metadata.epl_live, sig: 'x' } } }, next), true);
  assert.equal(changed({ ...row, metadata: [] }, next), true, 'a non-object metadata is treated as empty, not merged into');
});

test('diffStats names every changed value, new row and lost row', () => {
  const b = [{ player_id: 1, goals: 0, assists: 1, match_rating: '7.1' }, { player_id: 2, goals: 1 }];
  const a = [{ player_id: 1, goals: 1, assists: 1, match_rating: 7.1 }, { player_id: 3, goals: 0 }];
  assert.deepEqual(diffStats(b, a), ['1 goals 0->1', '3 new row', '2 row gone']);
});

test('full time: seen by the poller, else kickoff + 115 min', () => {
  assert.equal(fullTimeOf({ kickoff_at: '2030-03-02T15:00:00Z', metadata: { epl_live: { fullTimeAt: '2030-03-02T16:52:00Z' } } }).toISOString(), '2030-03-02T16:52:00.000Z');
  assert.equal(fullTimeOf({ kickoff_at: '2030-03-02T15:00:00Z', metadata: null }).toISOString(), '2030-03-02T16:55:00.000Z');
});

test('NAMED LEAGUES ONLY, BY CONSTRUCTION: every read names its leagues; nothing imports the old sweep', () => {
  const code = src('lib/soccer/eplLive.js');
  const reads = [...code.matchAll(/FROM matches m JOIN leagues l ON l\.id = m\.league_id\s+WHERE l\.slug = 'epl'/g)];
  assert.equal(reads.length, 2, 'full-time pending, re-sync due: EPL only');
  // The window (ucl, fri-3): the EPL and the Champions League, by name.
  assert.equal([...code.matchAll(/WHERE l\.slug = ANY\(\$\{leagues\}::text\[\]\)/g)].length, 1);
  assert.match(code, /export async function windowRows\(sql, now = new Date\(\), leagues = LIVE_LEAGUES\)/, 'the default is the named pair');
  assert.doesNotMatch(src('app/api/cron/epl-live/route.js'), /leagues:/, 'the route never narrows or widens it');
  assert.deepEqual(LIVE_LEAGUES, ['epl', 'ucl']);
  assert.doesNotMatch(code, /stuckLiveSweep|sweepStuckLive|getMatchesToPoll|liveMatches/);
  const route = src('app/api/cron/epl-live/route.js');
  assert.match(route, /if \(!\(await eplWindowOpen\(sql\)\)\) return Response\.json\(\{ decision: 'outside-window' \}\)/);
  assert.ok(route.indexOf('eplWindowOpen(sql)') < route.indexOf('recordRun(sql'), 'the window check comes before any ledger row');
  const v = JSON.parse(src('vercel.json'));
  assert.equal(v.crons.find((c) => c.path === '/api/cron/epl-live')?.schedule, '* * * * *');
  assert.equal(v.crons.find((c) => c.path === '/api/cron/poll-live'), undefined, 'poll-live stays retired');
});

// ---------------------------------------------------------------------------
// THE REPLAY, on DEV
// ---------------------------------------------------------------------------

const FX = '991557410';            // a fixture id no real row carries
const FX_STUCK = '991557999';
const KO = new Date('2030-03-02T15:00:00Z');
const at = (min) => new Date(KO.getTime() + min * 60000);
const SLUG = `zz-epl-replay-${process.pid}`;
const SLUG_STUCK = `zz-epl-replay-stuck-${process.pid}`;
let ids = [];

/** The recorded fixture as it stood at `minute`, with the provider's status. */
function frame(short, elapsed, { players = false, through = elapsed } = {}) {
  const events = REC.events.filter((e) => (e.time?.elapsed ?? 0) <= through);
  const g = goalsOf({ ...REC, events });
  return {
    ...REC,
    fixture: { ...REC.fixture, id: Number(FX), status: { long: short, short, elapsed, extra: null } },
    goals: short === 'NS' ? { home: null, away: null } : { home: g.filter((x) => x.side === 'home').length, away: g.filter((x) => x.side === 'away').length },
    score: { ...REC.score, halftime: elapsed >= 45 && short !== '1H' ? REC.score.halftime : { home: null, away: null } },
    events: short === 'NS' ? [] : events,
    statistics: short === 'NS' ? [] : REC.statistics,
    players: players ? REC.players : [],
  };
}

const calls = [];
const client = (f) => ({ fixturesByIds: async (want) => { calls.push(want); return [f].filter((x) => want.map(String).includes(String(x.fixture.id))); } });
const noBreaker = { isTripped: async () => false, trip: async () => {} };
const row = async (slug) => (await sql`SELECT id, status, home_score, away_score, metadata FROM matches WHERE slug = ${slug}`)[0];

before(async () => {
  const lg = await sql`SELECT id FROM leagues WHERE slug = 'epl'`;
  const t = await sql`
    SELECT t.id, t.external_ids->>'api_sports' AS fx FROM teams t
     WHERE t.league_id = ${lg[0].id} AND t.external_ids->>'api_sports' IN ('45', '57')`;
  const home = t.find((x) => x.fx === '45').id; const away = t.find((x) => x.fx === '57').id;
  const ins = await sql`
    INSERT INTO matches (league_id, slug, home_team_id, away_team_id, kickoff_at, status, season_year, week, external_ids)
    VALUES (${lg[0].id}, ${SLUG}, ${home}, ${away}, ${KO.toISOString()}, 'scheduled', 2026, 99, ${JSON.stringify({ api_sports: FX })}::jsonb),
           (${lg[0].id}, ${SLUG_STUCK}, ${home}, ${away}, ${at(-600).toISOString()}, 'scheduled', 2026, 99, ${JSON.stringify({ api_sports: FX_STUCK })}::jsonb)
    RETURNING id`;
  ids = ins.map((r) => r.id);
});

after(async () => {
  RESETTLE_HOOKS.length = 0;
  await sql`DELETE FROM matches WHERE id = ANY(${ids})`;
  const left = await sql`SELECT count(*)::int AS n FROM matches WHERE slug IN (${SLUG}, ${SLUG_STUCK})`;
  assert.equal(left[0].n, 0, 'teardown removed the replay rows (events, stats and player rows cascade)');
});

test('REPLAY: scheduled -> 1H -> HT -> 2H (red) -> FT -> player stats -> +24h re-sync', async () => {
  // Outside the window: no provider call at all.
  assert.equal(await eplWindowOpen(sql, at(-WINDOW_AFTER_MIN - 600)), false);
  assert.equal((await runEplLive({ sql, client: client(frame('NS', null)), breaker: noBreaker, now: at(-30) })).decision, 'outside-window');
  assert.equal(calls.length, 0, 'no request outside the window');

  // 10 minutes out: armed, polled, nothing a reader sees has moved yet.
  let r = await runEplLive({ sql, client: client(frame('NS', null)), breaker: noBreaker, now: at(-10) });
  assert.equal(r.decision, 'ran'); assert.equal(calls.length, 1); assert.deepEqual(calls[0], [FX]);
  assert.equal((await row(SLUG)).status, 'scheduled');

  // 12': Barry has scored.
  r = await runEplLive({ sql, client: client(frame('1H', 12)), breaker: noBreaker, now: at(12) });
  let m = await row(SLUG);
  assert.equal(m.status, 'live'); assert.equal(m.home_score, 1); assert.equal(m.away_score, 0);
  assert.deepEqual(m.metadata.live_state, { elapsed: 12, extra: null, period: '1H' });
  assert.equal(m.metadata.epl_live.goals[0].player, 'T. Barry');
  const ev = await sql`SELECT count(*)::int AS n FROM match_events WHERE match_id = ${m.id} AND is_current`;
  assert.ok(ev[0].n >= 1, 'the timeline atom wrote the goal');

  // The same minute again: nothing moved, nothing written.
  r = await runEplLive({ sql, client: client(frame('1H', 12)), breaker: noBreaker, now: at(13) });
  assert.equal(r.wrote, 0);

  // Half time.
  await runEplLive({ sql, client: client(frame('HT', 45)), breaker: noBreaker, now: at(48) });
  m = await row(SLUG);
  assert.equal(m.metadata.live_state.period, 'HT'); assert.deepEqual(m.metadata.epl_live.halftime, { home: 1, away: 0 });

  // 68': Ipswich are down to ten.
  await runEplLive({ sql, client: client(frame('2H', 68)), breaker: noBreaker, now: at(83) });
  m = await row(SLUG);
  assert.deepEqual(m.metadata.epl_live.reds, [{ minute: 67, extra: null, side: 'away', player: 'Abdul Fatawu Issahaku' }]);

  // Full time, players embedded: final, the whistle stamped, stats in from the tick.
  r = await runEplLive({ sql, client: client(frame('FT', 90, { players: true })), breaker: noBreaker, now: at(112) });
  m = await row(SLUG);
  assert.equal(m.status, 'final'); assert.equal(m.metadata.live_state, null);
  assert.equal(m.metadata.epl_live.fullTimeAt, at(112).toISOString());
  assert.deepEqual(r.final, [SLUG]);
  assert.equal(r.ft[0].from, 'tick', 'the stats came from the same request');
  const pms = await sql`SELECT count(*)::int AS n FROM player_match_stats WHERE match_id = ${m.id}`;
  assert.ok(pms[0].n >= 20, `player stats at full time (${pms[0].n} rows)`);
  assert.ok(m.metadata.epl_stats.ftSyncAt, 'ftSyncAt recorded');
  assert.equal(r.ft[0].rows, pms[0].n);
  const barry = await sql`
    SELECT s.goals FROM player_match_stats s JOIN players p ON p.id = s.player_id
     WHERE s.match_id = ${m.id} AND p.external_ids->>'api_sports' = '343684'`;
  if (barry.length) assert.equal(barry[0].goals, 1, 'the scorer has his goal');

  // The day after: nothing to do until +24h.
  assert.equal(await eplWindowOpen(sql, at(112 + 60 * 23)), false, 'quiet between full time and the re-sync');

  // +24h: the provider corrected one value; the re-sync finds it, says so, and calls the hook.
  const corrected = structuredClone(REC.players);
  const p0 = corrected[0].players.find((p) => (p.statistics?.[0]?.games?.minutes ?? 0) > 0);
  p0.statistics[0].shots = { ...(p0.statistics[0].shots ?? {}), total: (p0.statistics[0].shots?.total ?? 0) + 1 };
  const hooked = [];
  RESETTLE_HOOKS.push(async (h) => { hooked.push(h); });
  r = await runEplLive({
    sql, client: client(frame('FT', 90)), breaker: noBreaker, now: at(112 + 60 * 24 + 1),
    importStats: (s, o) => importEplPlayerStats(s, { ...o, fetchPlayers: async () => ({ teams: corrected, budget: null }) }),
  });
  m = await row(SLUG);
  assert.ok(m.metadata.epl_stats.resyncAt);
  assert.ok(r.resync[0].changed >= 1, 'the corrected value is found');
  assert.match(m.metadata.epl_stats.resyncSample.join(' '), /shots (null|\d+)->\d+/);
  assert.equal(hooked.length, 1); assert.equal(hooked[0].slug, SLUG);
  assert.equal(await eplWindowOpen(sql, at(112 + 60 * 25)), false, 'one re-sync, then quiet');
});

test('REPLAY: a live row the provider stops answering for goes final after 30 quiet minutes, not before', async () => {
  const stuckAt = at(400);
  await sql`UPDATE matches SET status = 'live', home_score = 2, away_score = 2,
              metadata = ${JSON.stringify({ live_state: { elapsed: 88, period: '2H' }, epl_live: { wroteAt: new Date(stuckAt - 29 * 60000).toISOString(), goals: [], reds: [] } })}::jsonb
             WHERE slug = ${SLUG_STUCK}`;
  const other = client(frame('FT', 90)); // a good response that does not carry FX_STUCK
  const importStats = async () => ({ inserted: 0, updated: 0 }); // never a real fetch for a fake fixture
  await runEplLive({ sql, client: other, breaker: noBreaker, importStats, now: stuckAt });
  assert.equal((await row(SLUG_STUCK)).status, 'live', '29 quiet minutes: still live');
  const r = await runEplLive({ sql, client: other, breaker: noBreaker, importStats, now: new Date(stuckAt.getTime() + 60000) });
  const m = await row(SLUG_STUCK);
  assert.equal(m.status, 'final'); assert.equal(m.home_score, 2); assert.equal(m.metadata.epl_live.forcedFinal, true);
  assert.deepEqual(r.forced, [SLUG_STUCK]);
  // A provider failure is not a vanished fixture.
  await sql`UPDATE matches SET status = 'live', metadata = ${JSON.stringify({ epl_live: { wroteAt: at(0).toISOString() } })}::jsonb WHERE slug = ${SLUG_STUCK}`;
  await runEplLive({ sql, client: { fixturesByIds: async () => { throw new Error('API-Sports 500'); } }, breaker: noBreaker, importStats, now: at(900) });
  assert.equal((await row(SLUG_STUCK)).status, 'live');
  await sql`UPDATE matches SET status = 'final' WHERE slug = ${SLUG_STUCK}`;
});

test('THE DAILY CAP trips the shared breaker and stops the tick', async () => {
  await sql`UPDATE matches SET status = 'live', metadata = '{}'::jsonb WHERE slug = ${SLUG_STUCK}`;
  let tripped = null;
  const r = await runEplLive({
    sql, now: at(1000),
    client: { fixturesByIds: async () => { const e = new Error('cap'); e.name = 'DailyCapError'; throw e; } },
    breaker: { isTripped: async () => false, trip: async (o) => { tripped = o; } },
  });
  assert.equal(r.decision, 'daily-cap'); assert.deepEqual(tripped, { reason: 'detected_in_epl_live' });
  const skip = await runEplLive({ sql, now: at(1001), client: client(frame('FT', 90)), breaker: { isTripped: async () => true, trip: async () => {} } });
  assert.equal(skip.decision, 'breaker-tripped');
  await sql`UPDATE matches SET status = 'final' WHERE slug = ${SLUG_STUCK}`;
  assert.equal(typeof eventsSig(REC), 'string');
});
