// lib/house/wiring.test.mjs - the house reaches every board, and the engine
// every player uses is untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('ALL SEVEN NAMED READERS SELECT THE FLAG and mark their rows', () => {
  // Every one of them already joined `users`, so this costs a column and not
  // a join - which is the whole reason a boolean on users was enough.
  const files = {
    'lib/daily/seasonBoardLeaderboards.js': 3,   // main, today, streak
    'lib/games/read.js': 2,                      // pickemTable, gameSeasonTable
    'lib/weekly/live.js': 2,                     // liveBoard, weeklyBoardTable
  };
  for (const [f, selects] of Object.entries(files)) {
    const t = stripComments(src(`../../${f}`));
    assert.ok((t.match(/u\.is_house|ce\.user_id, u\.handle, u\.is_house/g) ?? []).length >= 1, `${f} selects is_house`);
    assert.match(t, /houseMark\(/, `${f} marks its rows`);
    assert.ok((t.match(/is_house/g) ?? []).length >= selects, `${f} selects it in each query`);
  }
});

test('THE THREE DAILY BOARDS SHARE ONE MAPPER, so the flag cannot reach two of three', () => {
  const t = stripComments(src('../daily/seasonBoardLeaderboards.js'));
  assert.match(t, /function withHandle\(rows\)[\s\S]{0,400}houseMark\(/);
});

test('the grade-page leaderboards mark their rows too', () => {
  // Not in the relay's list of seven, but they render rows and an unmarked
  // house row on a grade page is the exact failure the ruling forbids.
  const t = stripComments(src('../games/leaderboard.js'));
  assert.equal((t.match(/houseMark\(/g) ?? []).length, 3,
    'scoreLeaderboard, pickemBoardLeaderboard and draftFieldLeaderboard');
  assert.match(t, /game: 'weekly'|game = null/);
});

test('EVERY COMPONENT THAT RENDERS A BOARD ROW RENDERS THE MARKER', () => {
  for (const f of [
    '../../app/games/page.js',
    '../../app/daily/board/page.js',
    '../../app/daily/board/[date]/page.js',
    '../../components/weekly/WeeklyGrade.js',
    '../../components/pickem/PickemGrade.js',
    '../../components/draft/DraftGrade.js',
  ]) {
    const t = src(f);
    assert.match(t, /HouseTag|HouseMark/, `${f} renders no house marker`);
    assert.match(t, /components\/house\/house\.css/, `${f} does not load the marker's stylesheet`);
  }
});

test('the marker and the method line are ONE component, not six opinions', () => {
  const t = src('../../components/house/HouseTag.js');
  assert.match(t, /if \(!row\?\.house\) return null/, 'a person renders nothing');
  assert.match(t, /row\.method \?/, 'and a house row with no method still gets the marker');
});

test('THE ENGINE EVERY PLAYER USES IS NOT TOUCHED (ruling R4)', () => {
  const engine = stripComments(src('../fantasy/engine.js'));
  // aiPick is what the eleven bots run, in every room in the product.
  assert.equal(/persona|house|seatStrategy/i.test(engine), false,
    'no persona may reach the shared engine');
  // The only change to it is that legalCandidates is now exported.
  assert.match(engine, /export function legalCandidates\(/);
});

test('the seat hook is OPT-IN, and defaults to exactly the old behaviour', () => {
  const t = stripComments(src('../fantasy/drafts.js'));
  // The signature gained `now` with the rolling-pool relay; what this pins is
  // that seatStrategy still DEFAULTS TO NULL, which is what makes it opt-in.
  assert.match(t, /autoCompleteDraftFor\(draftId, \{ seatStrategy = null/);
  assert.match(t, /rec = chosen \? engine\.applyPick\(state, seat, chosen, 'ai'\) : engine\.autoPick\(state, seat\)/,
    'no strategy means autoPick, which is what it did before');
  assert.match(t, /rec = engine\.aiPick\(state, seat, engine\.makeRng\(draftId \* 7919 \+ state\.overallPick\)\)/,
    'and the other eleven seats are untouched');
});

test('NOTHING BUT THE HOUSE PASSES A SEAT STRATEGY', () => {
  const callers = ['../../app/api/draft/start/route.js', '../draft/entry.js'];
  for (const f of callers) {
    assert.equal(/seatStrategy/.test(src(f)), false, `${f} must not pass one`);
  }
  assert.match(stripComments(src('./run.js')), /autoCompleteDraftFor\(started\.draftId, \{ seatStrategy: strategy \}\)/);
});

test('ONE CRON, HOURLY, and it reads boards rather than making them', () => {
  const route = stripComments(src('../../app/api/cron/house-entries/route.js'));
  assert.match(route, /cronAuthorized\(request\)/, 'authorised like every other cron');
  assert.match(route, /withAdvisoryLock\(SOURCE/, 'and single-flighted');
  assert.equal(/ensureWeek|ensureDaily|createBoard/.test(route), false,
    'it must never create a board - three other crons own that');
  const vercel = JSON.parse(src('../../vercel.json'));
  const cron = vercel.crons.find((c) => c.path === '/api/cron/house-entries');
  assert.ok(cron, 'scheduled');
  assert.match(cron.schedule, /^\d+ \* \* \* \*$/, 'hourly');
});

test('ensureDraftWeek IS GONE - a second creator for a one-per-week row is a trap', () => {
  const t = src('../draft/contest.js');
  assert.equal(/^export async function ensureDraftWeek/m.test(t), false);
  assert.match(t, /ensureDraftWeek\(\) WAS HERE AND IS GONE/, 'and the reason is recorded');
  // Its imports went with it; leaving them would be a dead cycle back into
  // lib/weekly/create.js.
  for (const dead of ['activePool', 'firstKickoff', 'tuesdayBefore', 'easternLocalToUtc']) {
    assert.equal(new RegExp(`^import .*\\b${dead}\\b`, 'm').test(t), false, `${dead} import still here`);
  }
});

test('the migration adds one column and nothing else', () => {
  const m = src('../../migrations/101_users_is_house.sql');
  assert.match(m, /ALTER TABLE users ADD COLUMN IF NOT EXISTS is_house boolean NOT NULL DEFAULT false/);
  assert.equal((m.match(/ALTER TABLE|CREATE TABLE|DROP /g) ?? []).length, 1,
    'one statement against one table');
  assert.match(m, /COMMENT ON COLUMN users\.is_house/);
});

test('THE ACCOUNTS CARRY NO EMAIL AND NO AUTH PROVIDER', () => {
  const t = stripComments(src('./accounts.js'));
  assert.match(t, /INSERT INTO users \(handle, name, is_house, first_seen_context\)/);
  // The COLUMNS and the TABLES, not any use of the words - ensureHouseAccounts
  // is itself called "accounts". A house account cannot sign in and is not
  // supposed to be able to.
  assert.equal(/\bemail\b/i.test(t), false, 'no email column is written');
  assert.equal(/(FROM|INTO|JOIN)\s+(accounts|sessions)\b/i.test(t), false,
    'no auth table is touched');
  assert.equal(/(FROM|INTO|UPDATE)\s+(?!users\b)\w+/i.test(t.replace(/INTO users/g, '')), false,
    'users is the only table this module writes');
});
