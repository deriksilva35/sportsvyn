// lib/mlb/notNeeded.test.mjs - a decided series' leftover games are 'not_needed',
// written by us, kept by the schedule writer, and skipped by every reader (thu-26).
//
// Pure rules first; then the write on a DEV fixture - season 2099, slugs
// carrying "test" so scripts/dev-orphan-sweep.mjs lists any a killed run leaves.
// Run: node --test lib/mlb/notNeeded.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { notNeededGames, markNotNeeded } from './notNeeded.js';
import { shapeSeries } from './series.js';
import { slateDone, parseImportOutput, journalLine } from './advance.js';
import { refuseReason, nextLock, dayState } from '../october/rules.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (r) => readFileSync(path.join(REPO, r), 'utf8');

// CHC@SD, the 30 Sep shape: SD won games 1 and 2, game 3 still listed.
const row = (id, status, hs, as, ko) => ({
  id, slug: `mlb-g${id}`, stage: 'wild_card', kickoff_at: ko, status, home_score: hs, away_score: as,
  home_team_id: 1, away_team_id: 2, home_abbr: 'SD', away_abbr: 'CHC',
});
const decided = () => shapeSeries([
  row(1, 'final', 8, 0, '2026-09-30T02:00:00Z'),
  row(2, 'final', 4, 1, '2026-10-01T02:00:00Z'),
  row(3, 'cancelled', null, null, '2026-10-02T00:00:00Z'),
]);

test('A DECIDED SERIES: every game not final is not needed', () => {
  const g = notNeededGames(decided());
  assert.deepEqual(g.map((x) => x.id), [3]);
  assert.equal(g[0].from, 'cancelled', 'the resync had already called it cancelled - ours replaces it');
});

test('AN UNDECIDED SERIES gives nothing - 1-1 is when game 3 matters most', () => {
  const s = shapeSeries([
    row(1, 'final', 5, 3, '2026-09-29T18:00:00Z'),
    row(2, 'final', 3, 4, '2026-09-30T18:00:00Z'),
    row(3, 'scheduled', null, null, '2026-10-02T00:00:00Z'),
  ]);
  assert.equal(s[0].winner, null);
  assert.deepEqual(notNeededGames(s), []);
});

test('a LIVE game is never marked, even in a series the rows call decided', () => {
  const s = shapeSeries([
    row(1, 'final', 8, 0, '2026-09-30T02:00:00Z'),
    row(2, 'final', 4, 1, '2026-10-01T02:00:00Z'),
    row(3, 'live', 0, 0, '2026-10-02T00:00:00Z'),
  ]);
  assert.deepEqual(notNeededGames(s), []);
});

test('THE SERIES A READER SEES has no not-needed game in it', () => {
  const s = shapeSeries([
    row(1, 'final', 8, 0, '2026-09-30T02:00:00Z'),
    row(2, 'final', 4, 1, '2026-10-01T02:00:00Z'),
    row(3, 'not_needed', null, null, '2026-10-02T00:00:00Z'),
  ]);
  assert.equal(s[0].gameCount, 2);
  assert.equal(s[0].record, '2-0');
});

test('THE SCHEDULE WRITER NEVER FLIPS not_needed BACK', () => {
  const t = src('lib/mlb/schedule.js');
  assert.match(t, /status = CASE WHEN matches\.status = 'not_needed' THEN matches\.status ELSE \$\{g\.status\} END/);
  assert.doesNotMatch(t, /kickoff_at = \$\{g\.kickoffAt\}, status = \$\{g\.status\}/, 'the old unguarded write is gone');
  // and the resync's own cancel only ever touches scheduled/postponed
  assert.match(src('lib/mlb/resync.js'), /SET status = 'cancelled'[^`]*status IN \('scheduled', 'postponed'\)/);
});

test('THE READERS SKIP IT: scores, October days, the home slate, The Run', () => {
  assert.match(src('lib/gridiron/scoresV2.js'), /AND m\.status <> 'not_needed'/);
  const oc = src('lib/october/create.js');
  assert.match(oc, /m\.stage IS NOT NULL AND m\.season_year = \$\{season\}[\s\S]{0,200}m\.status NOT IN \('cancelled', 'not_needed'\)/);
  assert.equal((src('lib/today/daySlate.js').match(/m\.status <> 'not_needed'/g) ?? []).length, 2);
  assert.equal((src('lib/run/pool.js').match(/isNotPlayed\(/g) ?? []).length, 4);
  // probables refresh and the odds cron read 'scheduled' only, so they skip it already
  assert.match(src('lib/mlb/probablesRefresh.js'), /WHERE m\.status = 'scheduled'/);
  assert.match(src('app/api/cron/gridiron-odds/route.js'), /AND m\.status = 'scheduled'/);
});

// ---- October, against 1 Oct's real board shape ----
const BOARD = [
  { match_id: 42149, kickoff_at: '2026-10-01T18:00:00Z' },  // PHI@ATL, moved to 00:00Z
  { match_id: 42150, kickoff_at: '2026-10-01T21:00:00Z' },  // CHW@HOU g3, moot
  { match_id: 41763, kickoff_at: '2026-10-02T00:00:00Z' },  // BOS@NYY g3, moot
  { match_id: 41764, kickoff_at: '2026-10-02T02:00:00Z' },  // CHC@SD g3, moot
];
const statusBy = new Map([['42149', 'scheduled'], ['42150', 'not_needed'], ['41763', 'not_needed'], ['41764', 'cancelled']]);
const kickoffBy = new Map([['42149', '2026-10-02T00:00:00Z']]);
const NOW = new Date('2026-10-01T17:30:00Z');

test('OCTOBER: the card clock counts to PHI@ATL, not to a moot 21:00Z', () => {
  const n = nextLock(BOARD, NOW, { statusBy, kickoffBy });
  assert.equal(n.match_id, 42149);
});

test('OCTOBER: the server refuses a pick from a game that will not be played', () => {
  const r = refuseReason({}, 'bat1', { playerId: '596', matchId: 42150, kind: 'bat' },
    { board: BOARD, now: NOW, statusBy, kickoffBy });
  assert.equal(r, 'not_played');
});

test('OCTOBER: the day is not a DNF until the last game that WILL be played', () => {
  const at = (iso) => dayState({}, BOARD, new Date(iso), { statusBy, kickoffBy }).state;
  assert.equal(at('2026-10-01T23:59:00Z'), 'open');
  assert.equal(at('2026-10-02T00:00:01Z'), 'dnf', 'PHI@ATL is the last chance; the 02:00Z moot game is not');
});

test('ADVANCE: a day of finals and not-needed games is over', () => {
  assert.equal(slateDone([{ status: 'final' }, { status: 'not_needed' }]), true);
});

test('ADVANCE: the journal names what it marked', () => {
  const out = [
    '  not needed 2',
    '    mlb-2026-10-01-chw-hou  wild_card:CHW-HOU  was cancelled',
    '    mlb-2026-10-01-chc-sd  wild_card:CHC-SD  was scheduled',
    '    october contest 29 relocked 2026-10-02T02:00Z -> 2026-10-02T00:00Z',
    '',
    'APPLIED  inserted 0 | updated 12 | refused 0',
  ].join('\n');
  const s = parseImportOutput(out);
  assert.deepEqual(s.notNeeded, ['mlb-2026-10-01-chw-hou', 'mlb-2026-10-01-chc-sd']);
  assert.match(journalLine(s, { trigger: 'event' }), / \/ not needed mlb-2026-10-01-chw-hou, mlb-2026-10-01-chc-sd$/);
  assert.doesNotMatch(journalLine(parseImportOutput('APPLIED  inserted 0 | updated 0 | refused 0'), {}), /not needed/,
    'a run that marked nothing keeps the old line');
});

// ---- the write, on DEV ----
const { sql } = await import('../db.js');
const TAG = `notneeded-test-${process.pid}`;
let league; let home; let away; const made = [];
before(async () => {
  [{ id: league }] = await sql`SELECT id FROM leagues WHERE slug = 'mlb' LIMIT 1`;
  [home, away] = (await sql`SELECT id FROM teams WHERE league_id = ${league} ORDER BY id LIMIT 2`).map((t) => t.id);
});
after(async () => {
  await sql`DELETE FROM matches WHERE id = ANY(${made}::int[])`;
  const [{ n }] = await sql`SELECT count(*)::int n FROM matches WHERE slug LIKE ${`${TAG}-%`}`;
  assert.equal(n, 0, 'the fixture tears itself down');
});

test('THE WRITE: the database takes not_needed (migration 120) and a live game is left alone', async () => {
  const mk = async (n, status) => {
    const [m] = await sql`
      INSERT INTO matches (league_id, slug, home_team_id, away_team_id, kickoff_at, status, season_year, season_phase, stage)
      VALUES (${league}, ${`${TAG}-${n}`}, ${home}, ${away}, ${`2099-10-0${n}T00:00:00Z`}, ${status}, 2099, 'POST', 'wild_card')
      RETURNING id`;
    made.push(m.id); return m.id;
  };
  const moot = await mk(3, 'scheduled');
  const raced = await mk(4, 'scheduled');
  await sql`UPDATE matches SET status = 'live' WHERE id = ${raced}`;   // went live between read and write
  const series = [{ key: 'wild_card:T', winner: home, games: [
    { id: moot, slug: 'g3', status: 'scheduled' }, { id: raced, slug: 'g4', status: 'scheduled' }] }];
  const res = await markNotNeeded(sql, series);
  assert.deepEqual(res.marked.map((g) => g.id), [moot]);
  const rows = await sql`SELECT id, status FROM matches WHERE id = ANY(${[moot, raced]}) ORDER BY id`;
  assert.deepEqual(rows.map((r) => r.status), ['not_needed', 'live']);

  const dry = await markNotNeeded(sql, [{ key: 'k', winner: 1, games: [{ id: raced, slug: 'x', status: 'scheduled' }] }], { dryRun: true });
  assert.equal(dry.marked.length, 0); assert.equal(dry.wouldMark.length, 1, 'a dry run writes nothing and says what it would');
});
