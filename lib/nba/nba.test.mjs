// lib/nba/nba.test.mjs - the NBA pipeline's pure parts, and the wiring that
// makes the live poller and the cron run them (nba-core, Phase A).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { shapeNbaTeams, teamSlug, nbaLeagueRow, isCurrentTeam } from './sync.js';
import { NBA_COLORS, nbaColorRows } from './teamColors.js';
import { fromBdlNba, nbaLineScore, nbaDetailOf } from './ingest.js';
import { planNbaSlugs, parseNbaSlug, shapeNbaMatch, gameDay, nbaResyncWindow } from './schedule.js';
import { minutesToSeconds, shapeNbaStatLine, lastPlayOf } from './statsSync.js';
import { loadReplay, rowAt, replaySpan, replayFetch, REPLAY_GAMES } from './replay.js';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ------------------------------------------------------------------ teams

test('teams: thirty current franchises, historical rows skipped, slugs derived', () => {
  const rows = [
    { id: 2, conference: 'East', division: 'Atlantic', city: 'Boston', name: 'Celtics', full_name: 'Boston Celtics', abbreviation: 'BOS' },
    { id: 13, conference: 'West', division: 'Pacific', city: 'LA', name: 'Clippers', full_name: 'LA Clippers', abbreviation: 'LAC' },
    { id: 31, conference: ' ', division: '', city: 'Anderson', name: 'Packers', full_name: 'Anderson Packers', abbreviation: 'AND' },
    { id: 99, conference: 'East', division: 'Atlantic', full_name: 'No Abbr', abbreviation: '' },
  ];
  const { teams, rejected, historical } = shapeNbaTeams(rows);
  assert.equal(historical, 1);
  assert.deepEqual(teams.map((t) => t.slug), ['boston-celtics', 'la-clippers']);
  assert.deepEqual(teams[0].externalIds, { bdl_team_id: '2' });
  assert.equal(teams[0].conference, 'East');
  assert.equal(teams[0].shortName, 'Celtics');
  assert.equal(rejected.length, 1);
  assert.equal(teamSlug('Philadelphia 76ers'), 'philadelphia-76ers');
  assert.equal(isCurrentTeam({ conference: 'West', division: 'Northwest' }), true);
  assert.equal(isCurrentTeam({ conference: '', division: '' }), false);
});

test('league row: sport is basketball, by the vocabulary', () => {
  const l = nbaLeagueRow();
  assert.equal(l.slug, 'nba');
  assert.equal(l.sport, 'basketball');
});

test('colours: thirty valid pairs, one per BDL abbreviation', () => {
  const rows = nbaColorRows();
  assert.equal(rows.length, 30);
  assert.equal(Object.keys(NBA_COLORS).length, 30);
  for (const a of ['BKN', 'GSW', 'NOP', 'NYK', 'PHX', 'SAS', 'UTA', 'WAS']) assert.ok(NBA_COLORS[a], a);
  for (const r of rows) assert.match(r.primary, /^#[0-9A-F]{6}$/);
});

// ------------------------------------------------------------------ ingest

const LIVE = {
  id: 7, date: '2026-10-20', datetime: '2026-10-20T23:00:00.000Z', season: 2026, postseason: false,
  status: '3rd Qtr', status_state: 'in_progress', period: 3, time: '5:12',
  home_team_score: 70, visitor_team_score: 66, ist_stage: null,
  home_q1: 25, home_q2: 30, home_q3: 15, home_q4: null, visitor_q1: 20, visitor_q2: 30, visitor_q3: 16, visitor_q4: null,
  home_ot1: null, visitor_ot1: null,
  home_timeouts_remaining: 3, visitor_timeouts_remaining: 2, home_in_bonus: false, visitor_in_bonus: true,
  home_team: { id: 9, abbreviation: 'DET' }, visitor_team: { id: 2, abbreviation: 'BOS' },
};

test('fromBdlNba: status_state, scores, the strict clock, the phase', () => {
  const u = [];
  const n = fromBdlNba(LIVE, u);
  assert.equal(n.status, 'live');
  assert.deepEqual(n.liveState, { period: 3, clock: '5:12' });
  assert.equal(n.homeScore, 70); assert.equal(n.awayScore, 66);
  assert.equal(n.seasonPhase, 'REG');
  assert.equal(n.kickoffAt, '2026-10-20T23:00:00.000Z');
  assert.deepEqual(u, []);
  // an unobserved clock spelling: chip withheld, token RECORDED, status kept
  const u2 = [];
  const m = fromBdlNba({ ...LIVE, time: '3rd Qtr' }, u2);
  assert.equal(m.status, 'live');
  assert.equal(m.liveState, null);
  assert.deepEqual(u2, ['nba-time:3/3rd Qtr']);
  // a scheduled row's `status` is a datetime and is never read
  const s = fromBdlNba({ ...LIVE, status: '2026-10-20T19:00:00Z', status_state: 'scheduled', period: 0, time: null }, []);
  assert.equal(s.status, 'scheduled'); assert.equal(s.liveState, null);
  // an unknown status_state writes nothing
  const u3 = [];
  assert.equal(fromBdlNba({ ...LIVE, status_state: 'delayed' }, u3).status, null);
  assert.deepEqual(u3, ['delayed']);
  assert.equal(fromBdlNba({ ...LIVE, postseason: true }, []).seasonPhase, 'POST');
});

test('line score, timeouts, bonus: nested detail shape; nothing for a scheduled row', () => {
  assert.deepEqual(nbaLineScore(LIVE), [
    { period: 1, home: 25, away: 20 }, { period: 2, home: 30, away: 30 }, { period: 3, home: 15, away: 16 }]);
  assert.deepEqual(nbaDetailOf(LIVE), {
    line_score: nbaLineScore(LIVE), timeouts: { home: 3, away: 2 }, bonus: { home: false, away: true } });
  assert.equal(nbaDetailOf({ id: 1 }), null);
});

// ------------------------------------------------------------------ schedule

const row = (id, date, away, home, datetime = `${date}T23:00:00.000Z`) => ({
  id, date, datetime, status_state: 'scheduled', status: datetime, season: 2026, postseason: false, period: 0,
  visitor_team: { id: 100 + id, abbreviation: away }, home_team: { id: 200 + id, abbreviation: home } });

test('slugs: nba-<day>-<away>-<home>; kept unless day or clubs change; -g2 only on collision', () => {
  const a = row(1, '2026-10-20', 'BOS', 'DET');
  const plan = planNbaSlugs([a]);
  assert.equal(plan.get('1'), 'nba-2026-10-20-bos-det');
  assert.deepEqual(parseNbaSlug('nba-2026-10-20-bos-det'), { day: '2026-10-20', away: 'bos', home: 'det', n: 1 });
  // kept: same day and clubs, a new tip
  assert.equal(planNbaSlugs([{ ...a, datetime: '2026-10-20T23:30:00.000Z' }], new Map([['1', 'nba-2026-10-20-bos-det']])).get('1'), 'nba-2026-10-20-bos-det');
  // moved a day: new slug
  assert.equal(planNbaSlugs([row(1, '2026-10-21', 'BOS', 'DET')], new Map([['1', 'nba-2026-10-20-bos-det']])).get('1'), 'nba-2026-10-21-bos-det');
  // collision with a row outside the batch
  assert.equal(planNbaSlugs([a], new Map(), new Set(['nba-2026-10-20-bos-det'])).get('1'), 'nba-2026-10-20-bos-det-g2');
  assert.equal(gameDay({ date: '2026-10-20' }), '2026-10-20');
});

test('shapeNbaMatch: the tip is the feed datetime; a row with an unresolved club is refused', () => {
  const r = row(1, '2026-10-20', 'BOS', 'DET', '2026-10-20T19:00:00.000Z');
  const ids = new Map([['101', 5], ['201', 6]]);
  const g = shapeNbaMatch(r, 'nba-2026-10-20-bos-det', ids);
  assert.equal(g.kickoffAt, '2026-10-20T19:00:00.000Z');
  assert.equal(g.homeTeamId, 6); assert.equal(g.awayTeamId, 5);
  assert.equal(g.seasonPhase, 'REG'); assert.equal(g.week, null);
  assert.deepEqual(g.externalIds, { bdl_game_id: '1' });
  assert.equal(shapeNbaMatch(r, 'x', new Map([['101', 5]])), null);
  assert.equal(shapeNbaMatch({ ...r, datetime: null }, 'x', ids), null);
});

test('re-sync window: yesterday .. +14 days, hourly (no due gate)', () => {
  assert.deepEqual(nbaResyncWindow(new Date('2026-10-20T12:00:00Z')), { from: '2026-10-19', to: '2026-11-03' });
});

test('THE TIP FOLLOWS THE FEED: the writer rewrites kickoff_at on every path, live rows included', () => {
  const w = strip(src('./schedule.js'));
  const body = w.slice(w.indexOf('export async function writeNbaMatches'), w.indexOf('export function nbaResyncWindow'));
  const updates = body.match(/UPDATE matches SET[\s\S]*?WHERE id = \$\{prev\.id\}/g) ?? [];
  assert.equal(updates.length, 2, 'two update paths: poller-owned and scheduled/final');
  for (const u of updates) assert.match(u, /kickoff_at = \$\{g\.kickoffAt\}/);
  // and the cron runs every hour with no due gate
  const route = strip(src('../../app/api/cron/nba-schedule/route.js'));
  assert.match(route, /resyncNbaSchedule\(sql, \{ now, dryRun \}\)/);
  assert.doesNotMatch(route, /resyncDue/);
  const v = JSON.parse(src('../../vercel.json'));
  assert.equal(v.crons.find((c) => c.path === '/api/cron/nba-schedule')?.schedule, '52 * * * *');
});

// ------------------------------------------------------------------ stats

test('stats: minutes as seconds; counting stats only; DNP flagged', () => {
  assert.equal(minutesToSeconds('29'), 1740);
  assert.equal(minutesToSeconds('04'), 240);
  assert.equal(minutesToSeconds('29:14'), 1754);
  assert.equal(minutesToSeconds(''), null);
  assert.equal(minutesToSeconds('29:75'), null);
  const s = shapeNbaStatLine({ min: '29', pts: 10, fgm: 4, fga: 12, fg3m: 2, fg3a: 8, fg_pct: 0.33, turnover: 3, plus_minus: -1,
    player: { id: 1057263194, first_name: 'Kon', last_name: 'Knueppel', position: 'G-F' }, team: { id: 4 } });
  assert.equal(s.bdlPlayerId, '1057263194'); assert.equal(s.playerName, 'Kon Knueppel');
  assert.equal(s.seconds, 1740); assert.equal(s.dnp, false); assert.equal(s.turnovers, 3);
  assert.equal('fgPct' in s, false);
  assert.equal(shapeNbaStatLine({ min: '', player: { id: 1, first_name: 'A', last_name: 'B' } }).dnp, true);
  assert.equal(shapeNbaStatLine({ player: {} }), null);
});

test('last play: the highest order wins', () => {
  const lp = lastPlayOf([{ order: 2, text: 'b', period: 4, clock: '1.5' }, { order: 9, text: 'z', period: 4, clock: '0.0', team: { abbreviation: 'HOU' } }, { order: 5 }]);
  assert.equal(lp.order, 9); assert.equal(lp.clock, '0.0'); assert.equal(lp.team, 'HOU');
  assert.equal(lastPlayOf([]), null);
});

test('migration 119: the table, its unique key, seconds not minutes', () => {
  const p = new URL('../../migrations/119_nba_player_game_stats.sql', import.meta.url);
  assert.ok(existsSync(p));
  const m = readFileSync(p, 'utf8');
  assert.match(m, /CREATE TABLE IF NOT EXISTS nba_player_game_stats/);
  assert.match(m, /UNIQUE \(match_id, bdl_player_id\)/);
  assert.match(m, /seconds\s+INTEGER/);
  assert.doesNotMatch(m.replace(/--.*$/gm, ''), /_pct/, 'no stored rates');
});

// ------------------------------------------------------------------ the poller

test('the poller registry: nba with its own detail writer and the tip hook; no enrich', () => {
  const idx = strip(src('../../services/live-poller/index.mjs'));
  const entry = idx.slice(idx.indexOf("{ slug: 'nba'"), idx.indexOf('];', idx.indexOf("{ slug: 'nba'")));
  assert.match(entry, /normalise: fromNba/);
  assert.match(entry, /fetcher: \(now\) => nbaDay\(now\)\(\)/);
  assert.match(entry, /detail: nbaDetail, writeDetail: writeNbaDetail/);
  assert.match(entry, /kickoffOf: nbaKickoff/);
  assert.doesNotMatch(entry, /enrich/);
  assert.match(idx, /writeDetail: lg\.writeDetail/);
  assert.match(idx, /lg\.slug === 'nba'\) \? new StatsTracker\(\)/);
  assert.match(idx, /lg\.slug === 'nba' \? syncNbaGameStats/);
  assert.match(idx, /syncNbaLastPlay\(d\.id\)/);
  // pollOnce's defaults keep every other league exactly as it was
  const poll = strip(src('../../services/live-poller/poll.mjs'));
  assert.match(poll, /writeDetail = writeMlbDetail,/);
  assert.match(poll, /dispatchFn = dispatch,/);
});

test('nbaDay: one call when nothing is on; the live route overlays its rows when a game is', async () => {
  const { nbaDay } = await import('../../services/live-poller/poll.mjs');
  const seen = [];
  const mk = (games, live) => async (url) => {
    seen.push(new URL(url).pathname);
    const p = new URL(url).pathname;
    const body = p === '/nba/v1/games' ? { data: games } : { data: live };
    return { ok: true, status: 200, json: async () => body };
  };
  const sched = { ...LIVE, status_state: 'scheduled', datetime: '2026-10-20T23:00:00.000Z', time: null, period: 0 };
  let r = await nbaDay(new Date('2026-10-20T20:00:00Z'), { fetchImpl: mk([sched], []), key: 'k' })();
  assert.equal(r.calls, 1); assert.equal(r.rows.length, 1);
  seen.length = 0;
  // tip passed but /games still says scheduled: the live route is asked, and wins
  r = await nbaDay(new Date('2026-10-20T23:05:00Z'), { fetchImpl: mk([sched], [{ ...LIVE, period: 1, time: '11:20', home_team: { id: 0 } }]), key: 'k' })();
  assert.equal(r.calls, 2);
  assert.deepEqual(seen, ['/nba/v1/games', '/nba/v1/box_scores/live']);
  assert.equal(r.rows[0].status_state, 'in_progress');
  assert.equal(r.rows[0].time, '11:20');
  assert.equal(r.rows[0].home_team.id, 9, 'the /games row keeps its team objects');
});

// ------------------------------------------------------------------ replay synth

test('replay synth: scheduled before the first play, live in between, the recorded final after', async () => {
  const fx = loadReplay(REPLAY_GAMES.ot);
  const { tipAt, endAt } = replaySpan(fx);
  const pre = rowAt(fx, tipAt - 1000);
  assert.equal(pre.status_state, 'scheduled'); assert.equal(pre.period, 0);
  const mid = rowAt(fx, tipAt + 30 * 60_000);
  assert.equal(mid.status_state, 'in_progress');
  assert.ok(mid.period >= 1);
  assert.equal(mid.home_team_score, (mid.home_q1 ?? 0) + (mid.home_q2 ?? 0) + (mid.home_q3 ?? 0) + (mid.home_q4 ?? 0) + (mid.home_ot1 ?? 0));
  const end = rowAt(fx, endAt + 1000);
  assert.equal(end.status_state, 'final');
  assert.equal(end.period, 5);
  // halftime is spelled the one way parseNbaLive accepts
  const endQ2 = fx.plays.find((p) => p.type === 'End Period' && p.period === 2);
  const half = rowAt(fx, Date.parse(endQ2.wallclock) + 1000);
  assert.equal(half.time, 'Halftime');
  // the stub serves the routes the poller asks, and 404s anything else
  let t = tipAt + 60_000;
  const f = replayFetch([fx], () => t);
  const g = await (await f(`https://x/nba/v1/games?dates[]=${fx.game.date}`)).json();
  assert.equal(g.data.length, 1);
  assert.equal((await f('https://x/nba/v1/odds')).status, 404);
  t = endAt + 1;
  assert.equal((await (await f('https://x/nba/v1/box_scores/live')).json()).data.length, 0);
});
