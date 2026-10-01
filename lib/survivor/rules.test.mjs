// lib/survivor/rules.test.mjs - the rulings of 1 Oct 2026, one assertion each.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isPlaceholderKickoff, gameOpen, weekEnds, openWeek, teamSpread, teamRows, chooseAuto,
  gradePick, livesFrom, entriesOpen, entryCutoff, REFUSALS, RESULTS,
} from './rules.js';
import { LEAGUE_GAME_KEYS, isLeagueGame } from '../leagues/gameTypes.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(path.join(REPO, f), 'utf8');

test('week 18\'s placeholder kickoff (midnight ET) is not a time: no lock, no pick', () => {
  assert.equal(isPlaceholderKickoff('2027-01-10T05:00:00Z'), true, 'the PROD placeholder, 1 Oct');
  assert.equal(isPlaceholderKickoff('2026-10-11T04:00:00Z'), true, 'midnight EDT');
  assert.equal(isPlaceholderKickoff('2026-10-16T00:15:00Z'), false, 'Thursday night');
  assert.equal(isPlaceholderKickoff('2026-10-18T13:30:00Z'), false, 'London');
  const now = new Date('2027-01-01T00:00:00Z');
  assert.equal(gameOpen({ status: 'scheduled', kickoff_at: '2027-01-10T05:00:00Z' }, now), false);
  assert.equal(gameOpen({ status: 'scheduled', kickoff_at: '2027-01-10T18:00:00Z' }, now), true);
  assert.equal(gameOpen({ status: 'postponed', kickoff_at: '2027-01-10T18:00:00Z' }, now), false, 'scheduled only');
});

test('a tie is a LOSS; cancelled survives; postponed out of its week survives; played inside it grades', () => {
  const pick = { team_id: 1 };
  const g = (o) => ({ home_team_id: 1, away_team_id: 2, ...o });
  assert.equal(gradePick(pick, g({ status: 'final', home_score: 20, away_score: 17 })), 'win');
  assert.equal(gradePick(pick, g({ status: 'final', home_score: 17, away_score: 20 })), 'loss');
  assert.equal(gradePick(pick, g({ status: 'final', home_score: 20, away_score: 20 })), 'loss', 'tie');
  assert.equal(gradePick({ team_id: 2 }, g({ status: 'final', home_score: 3, away_score: 10 })), 'win', 'away side');
  assert.equal(gradePick(pick, g({ status: 'cancelled' })), 'survive');
  const end = new Date('2026-10-16T00:15:00Z').getTime();
  assert.equal(gradePick(pick, g({ status: 'postponed' }), { now: new Date('2026-10-14T00:00:00Z'), weekEndMs: end }), null, 'still inside the week: wait');
  assert.equal(gradePick(pick, g({ status: 'postponed' }), { now: new Date('2026-10-16T00:15:00Z'), weekEndMs: end }), 'survive');
  assert.equal(gradePick(pick, g({ status: 'final', home_score: null, away_score: 3 })), null, 'a final with no score waits');
});

test('a week ends at the next week\'s first kickoff; the open week waits for its own pending picks', () => {
  const weeks = [
    { week: 4, first_kickoff: '2026-10-02T00:15:00Z', last_kickoff: '2026-10-06T00:15:00Z', done: true },
    { week: 5, first_kickoff: '2026-10-09T00:15:00Z', last_kickoff: '2026-10-13T00:15:00Z', done: false },
    { week: 6, first_kickoff: '2026-10-16T00:15:00Z', last_kickoff: '2026-10-20T00:15:00Z', done: false },
  ];
  assert.equal(weekEnds(weeks).get(5), new Date('2026-10-16T00:15:00Z').getTime());
  assert.equal(weekEnds(weeks).get(6), new Date('2026-10-20T00:15:00Z').getTime() + 72 * 3600e3);
  assert.equal(openWeek(weeks, { startWeek: 5, now: new Date('2026-10-01T00:00:00Z') }), 5, 'opens before its first kickoff');
  const done5 = weeks.map((w) => (w.week === 5 ? { ...w, done: true } : w));
  assert.equal(openWeek(done5, { startWeek: 5, now: new Date('2026-10-13T04:00:00Z') }), 6);
  assert.equal(openWeek(done5, { startWeek: 5, now: new Date('2026-10-13T04:00:00Z'), pendingWeeks: new Set([5]) }), 5, 'ungraded');
  assert.equal(openWeek(weeks, { startWeek: 5, now: new Date('2026-10-16T01:00:00Z') }), 6, 'a postponed game cannot hold week 5 open past its end');
  assert.equal(openWeek(weeks.map((w) => ({ ...w, done: true })), { startWeek: 5, now: new Date('2027-02-01T00:00:00Z') }), null);
});

test('the auto-pick is the biggest unused favorite by SPREAD, then moneyline, else nobody', () => {
  const now = new Date('2026-10-09T01:00:00Z');
  const games = [
    { match_id: 1, kickoff_at: '2026-10-09T00:15:00Z', status: 'scheduled', home: { id: 1, abbr: 'SEA' }, away: { id: 2, abbr: 'DEN' } },
    { match_id: 2, kickoff_at: '2026-10-11T17:00:00Z', status: 'scheduled', home: { id: 3, abbr: 'BUF' }, away: { id: 4, abbr: 'NE' } },
    { match_id: 3, kickoff_at: '2026-10-11T20:25:00Z', status: 'scheduled', home: { id: 5, abbr: 'LV' }, away: { id: 6, abbr: 'KC' } },
  ];
  const spreads = new Map([[1, -10], [2, -6.5], [3, 3]]);
  const rows = teamRows(games, spreads);
  assert.deepEqual(rows.map((r) => r.abbr), ['SEA', 'BUF', 'KC', 'LV', 'NE', 'DEN']);
  assert.equal(chooseAuto(rows, new Set(), now).abbr, 'BUF', 'SEA has kicked off');
  assert.equal(chooseAuto(rows, new Set([3]), now).abbr, 'KC', 'BUF used');
  const h2h = new Map([[2, { home: { implied: 70 }, away: { implied: 30 } }], [3, { home: { implied: 40 }, away: { implied: 60 } }]]);
  assert.equal(chooseAuto(teamRows(games, new Map(), h2h), new Set(), now).abbr, 'BUF', 'moneyline fallback');
  assert.equal(chooseAuto(teamRows(games), new Set(), now), null, 'no line anywhere: nobody');
  assert.equal(teamSpread(-3, true), -3);
  assert.equal(teamSpread(-3, false), 3);
  assert.equal(teamSpread(0, false), 0);
});

test('lives come from the picks: a loss or a miss costs one; later picks never revive', () => {
  const p = (week, result) => ({ week, result });
  assert.deepEqual(livesFrom([p(5, 'win'), p(6, 'loss')], 1), { livesLeft: 0, eliminatedWeek: 6 });
  assert.deepEqual(livesFrom([p(5, 'loss'), p(6, 'survive'), p(7, 'win')], 2), { livesLeft: 1, eliminatedWeek: null });
  assert.deepEqual(livesFrom([p(6, 'missed'), p(5, 'loss'), p(7, 'loss')], 2), { livesLeft: 0, eliminatedWeek: 6 }, 'week order, not row order');
  assert.deepEqual(livesFrom([p(5, 'pending')], 1), { livesLeft: 1, eliminatedWeek: null });
});

test('entries close at the CUTOFF week\'s first kickoff, read from the schedule; no cutoff never closes', () => {
  const weeks = [
    { week: 5, first_kickoff: '2026-10-09T00:15:00Z' },
    { week: 6, first_kickoff: '2026-10-16T00:15:00Z' },
  ];
  const pool = { start_week: 5, entry_until_week: 6 };
  const ko = entryCutoff(pool, weeks);
  assert.equal(ko, '2026-10-16T00:15:00Z', 'week 6 first kickoff, from matches');
  assert.equal(entriesOpen(pool, ko, new Date('2026-10-16T00:14:59Z')), true, 'a second before');
  assert.equal(entriesOpen(pool, ko, new Date('2026-10-16T00:15:00Z')), false, 'at kickoff: closed');
  assert.equal(entriesOpen({ entry_until_week: null }, null, new Date('2027-01-01T00:00:00Z')), true, 'no cutoff');
  assert.equal(entryCutoff({ entry_until_week: null }, weeks), null);
});

test('every refusal the writer returns has a sentence; every result word is in the table\'s CHECK', () => {
  const src = read('lib/survivor/pick.js');
  for (const [, key] of src.matchAll(/fail\('(\w+)'\)/g)) assert.ok(REFUSALS[key], `REFUSALS.${key}`);
  const mig = read('migrations/118_survivor.sql');
  for (const r of RESULTS) assert.match(mig, new RegExp(`'${r}'`));
});

test('Survivor is a league game type (Leagues V1); its grade cron is PAUSED while it is pulled (thu-27)', () => {
  assert.ok(isLeagueGame('survivor'));
  assert.ok(LEAGUE_GAME_KEYS.includes('pickem') && LEAGUE_GAME_KEYS.includes('weekly'));
  const v = JSON.parse(read('vercel.json'));
  // When Survivor returns, the schedule it ran on was "25 * * * *".
  assert.equal(v.crons.find((c) => c.path === '/api/cron/survivor-grade'), undefined, 'unscheduled');
  assert.match(read('app/api/cron/survivor-grade/route.js'), /cronAuthorized|Bearer/, 'the route stays, Bearer-gated');
});

test('PULLED (thu-27): off unless SURVIVOR=on, and every door asks the flag', async () => {
  const { survivorOn } = await import('./flag.js');
  assert.equal(survivorOn({}), false, 'unset is off');
  assert.equal(survivorOn({ SURVIVOR: 'off' }), false);
  assert.equal(survivorOn({ SURVIVOR: 'on' }), true);
  const page = read('app/survivor/page.js');
  assert.match(page, /export default async function SurvivorPage\(\) \{\n {2}if \(!survivorOn\(\)\) notFound\(\);/, '/survivor 404s first');
  assert.match(read('app/actions/survivor.js'), /if \(!survivorOn\(\)\) return \{ ok: false, reason: 'closed' \}/);
  assert.match(read('lib/games/lobbyV3.js'), /const survivor = survivorOn\(\) \? await survivorRowFor\(/, 'no /games row');
});

test('the dev-only schedule override is dead in production', async () => {
  const { survivorSport } = await import('./rules.js');
  assert.equal(survivorSport({ NODE_ENV: 'production', SURVIVOR_SPORT_DEV: 'svshot' }), 'nfl');
  assert.equal(survivorSport({ NODE_ENV: 'development', SURVIVOR_SPORT_DEV: 'svshot' }), 'svshot');
  assert.equal(survivorSport({ NODE_ENV: 'development' }), 'nfl');
});
