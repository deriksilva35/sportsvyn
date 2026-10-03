// lib/cfb/bdlLive.test.mjs — the live overlay's vocabulary, its team map, and
// the law that keeps it out of a finished game.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STAT_MAP, TEAM_ALIAS, normalizeName, toLineRow,
  syncCfbLiveLines, sharedGamesFetcher, resolveBdlGameId, LIVE_LINES_CONCURRENCY, LIVE_LINES_BUDGET_MS,
} from './bdlLive.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const LIVE = src('lib/cfb/bdlLive.js');
// CODE ONLY, comments stripped. The file explains at length why resolution is
// an alias rather than a FUZZY match, and a naive grep flags that sentence as
// the very thing it forbids. Third time this trap has fired in this codebase;
// strip first, assert second.
const LIVE_CODE = LIVE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const MIG = src('migrations/080_cfb_live_player_lines.sql');
const SQL_ONLY = MIG.replace(/--[^\n]*/g, '');

// THE CENSUS KEY LIST, verbatim from the 30 Aug probe of a live game.
const CENSUS_KEYS = [
  'player', 'team', 'game',
  'passing_completions', 'passing_attempts', 'passing_yards', 'passing_touchdowns',
  'passing_interceptions', 'passing_qbr', 'passing_rating',
  'rushing_attempts', 'rushing_yards', 'rushing_touchdowns', 'rushing_long',
  'receptions', 'receiving_yards', 'receiving_touchdowns', 'receiving_targets',
  'receiving_long', 'total_tackles', 'solo_tackles', 'tackles_for_loss',
  'sacks', 'interceptions', 'passes_defended',
];

// A verbatim row: Jackson Arnold, UNLV, captured live at Q2 on 30 Aug.
const ARNOLD = {
  player: {
    id: 54276, first_name: 'Jackson', last_name: 'Arnold', position: 'QB',
    position_abbreviation: 'QB', height: "6' 1\"", weight: '220 lbs', jersey_number: '11',
  },
  team: {
    id: 102, conference: 8, college: 'UNLV', name: 'Rebels',
    full_name: 'UNLV Rebels', abbreviation: 'UNLV',
  },
  game: { id: 457189, season: 2026, week: 1, status: 'in', status_state: 'in_progress' },
  passing_completions: 17, passing_attempts: 21, passing_yards: 203,
  passing_touchdowns: 1, passing_interceptions: 0, passing_qbr: null, passing_rating: null,
  rushing_attempts: 3, rushing_yards: -8, rushing_touchdowns: 0, rushing_long: 4,
  receptions: 0, receiving_yards: 0, receiving_touchdowns: 0, receiving_targets: 0,
  receiving_long: 0, total_tackles: 0, solo_tackles: 0, tackles_for_loss: 0,
  sacks: 0, interceptions: 0, passes_defended: 0,
};

// ------------------------------------------------- vocabulary vs the census

test('EVERY census stat key is mapped - none silently dropped', () => {
  const stats = CENSUS_KEYS.filter((k) => !['player', 'team', 'game'].includes(k));
  for (const k of stats) {
    assert.ok(STAT_MAP[k], `census key ${k} must have a column`);
  }
  assert.equal(Object.keys(STAT_MAP).length, stats.length,
    'the map holds exactly the census keys - no invented columns');
});

test('the 19 shared columns use cfb_player_game_stats\' OWN names', () => {
  // The point of mapping at the boundary: relay 2's reader reads one
  // vocabulary whichever source answered.
  const shared = {
    passing_completions: 'pass_cmp', passing_attempts: 'pass_att',
    passing_yards: 'pass_yds', passing_touchdowns: 'pass_td',
    passing_interceptions: 'pass_int', rushing_attempts: 'rush_car',
    rushing_yards: 'rush_yds', rushing_touchdowns: 'rush_td', rushing_long: 'rush_long',
    receptions: 'rec', receiving_yards: 'rec_yds', receiving_touchdowns: 'rec_td',
    receiving_long: 'rec_long', total_tackles: 'tackles_tot',
    solo_tackles: 'tackles_solo', tackles_for_loss: 'tfl', sacks: 'sacks',
    interceptions: 'def_int', passes_defended: 'pass_def',
  };
  assert.equal(Object.keys(shared).length, 19);
  for (const [k, col] of Object.entries(shared)) assert.equal(STAT_MAP[k], col);
  const OTHER = src('lib/cfb/gameStats.js');
  for (const col of Object.values(shared)) {
    assert.ok(OTHER.includes(`'${col}'`), `${col} must exist in the complete import too`);
  }
});

test('the 3 live-only fields are kept and are NOT in the complete import', () => {
  for (const [k, col] of [['passing_qbr', 'pass_qbr'], ['passing_rating', 'pass_rating'],
    ['receiving_targets', 'rec_targets']]) {
    assert.equal(STAT_MAP[k], col);
    assert.match(SQL_ONLY, new RegExp(`${col}\\s+`), `${col} must exist on the live table`);
  }
});

test('an UNMAPPED key is counted, never coerced', () => {
  const unmapped = [];
  const r = toLineRow({ ...ARNOLD, kicking_points: 3 }, { matchId: 1, unmapped });
  assert.deepEqual(unmapped, ['kicking_points']);
  assert.equal(r.kicking_points, undefined, 'an unknown key lands in no column');
});

test('identity is stored AS DELIVERED, not re-derived', () => {
  const r = toLineRow(ARNOLD, { matchId: 42 });
  assert.equal(r.bdl_player_id, 54276);
  assert.equal(r.first_name, 'Jackson');
  assert.equal(r.last_name, 'Arnold');
  assert.equal(r.position, 'QB');
  assert.equal(r.jersey_number, '11');
  // and the numbers came across under our names
  assert.equal(r.pass_cmp, 17); assert.equal(r.pass_att, 21);
  assert.equal(r.pass_yds, 203); assert.equal(r.pass_td, 1);
  assert.equal(r.rush_yds, -8, 'a negative rushing total survives');
});

test('a row with no usable player id is skipped, not stored half-formed', () => {
  assert.equal(toLineRow({ ...ARNOLD, player: {} }, { matchId: 1 }), null);
  assert.equal(toLineRow({}, { matchId: 1 }), null);
});

// ---------------------------------------------------- team-name resolution

test('ST. FRANCIS: the one census miss is an ALIAS, not a fuzzy match', () => {
  // We say "St. Francis (PA)"; the feed says "Saint Francis" (the Red Flash).
  // The feed ALSO carries "St. Francis (IN)" and "St Francis Illinois", so a
  // contains-match would attach a Pennsylvania line to an Indiana club.
  assert.equal(TEAM_ALIAS['saint francis'], 'St. Francis (PA)');
  assert.match(LIVE, /St\. Francis \(IN\)/, 'the near-miss siblings are named in the comment');
  assert.doesNotMatch(LIVE_CODE, /\.includes\(.*college|fuzzy|levenshtein/i,
    'resolution must not be a loose contains-match');
});

test('normalizeName collapses punctuation and case only', () => {
  assert.equal(normalizeName('St. Francis (PA)'), 'stfrancispa');
  assert.equal(normalizeName('San José State'), 'sanjosstate');
  assert.equal(normalizeName(null), '');
  // It must NOT strip a state suffix - that is what keeps the three Francis
  // schools apart.
  assert.notEqual(normalizeName('St. Francis (PA)'), normalizeName('St. Francis (IN)'));
});

test('an unresolved team keeps the line with a name and a NULL team_id', () => {
  const r = toLineRow(ARNOLD, { matchId: 1, resolveTeam: () => null });
  assert.equal(r.team_id, null);
  assert.equal(r.team_name, 'UNLV', 'a wrong team is worse than an absent one');
  assert.match(SQL_ONLY, /team_id\s+integer REFERENCES teams\(id\)/,
    'team_id must be nullable - no NOT NULL');
});

// ------------------------------------------------------ the state-flip law

test('WRITES STOP AT FINAL - the status test is in the query', () => {
  const q = LIVE.slice(LIVE.indexOf('export async function liveCfbMatches'),
    LIVE.indexOf('export function sharedGamesFetcher'));
  assert.match(q, /WHERE m\.status = 'live' AND m\.league_id = \$\{leagueId\}/,
    'a finished game is never enumerated');
  // ...and re-asserted after the fetch, because the game can finalise mid-call.
  const fn = LIVE.slice(LIVE.indexOf('export async function syncCfbLiveLines'));
  assert.match(fn, /SELECT status FROM matches WHERE id = \$\{id\}/);
  assert.match(fn, /const still = await readStatus\(m\.id\);/);
  assert.match(fn, /if \(still !== 'live'\)/);
  assert.match(fn, /skipped: 'went-final'/);
});

test('ROWS ARE NOT DELETED AT FINAL - the last snapshot survives the lag', () => {
  assert.doesNotMatch(LIVE, /DELETE FROM cfb_live_player_lines/,
    'deleting on the flip would blank the box score for CFBD\'s ~35-minute lag');
  assert.match(MIG, /NOT DELETED AT FINAL/);
});

test('the table is declared EPHEMERAL where a reader would look', () => {
  assert.match(MIG, /EPHEMERAL BY DESIGN/);
  assert.match(MIG, /never blended|NEVER blended/i);
  assert.match(MIG, /COMMENT ON TABLE cfb_live_player_lines/);
});

test('the four-group coverage limit is on the record', () => {
  // The live feed has no kicking, punting, returns or fumbles. Relay 2 must
  // not render six empty tables.
  // The sentence wraps a line, and the wrap point carries the SQL comment
  // prefix ("-- "), so the assertion starts after it.
  assert.match(MIG, /kicking,\s*punting,\s*returns\s+or\s+fumbles/i);
  assert.match(MIG, /Four groups where the complete import/i);
  for (const absent of ['fgm', 'punts', 'kr_yds', 'fum_lost']) {
    assert.doesNotMatch(SQL_ONLY, new RegExp(`\\b${absent}\\b`),
      `${absent} must not exist on the live table - the feed does not carry it`);
  }
});

// ------------------------------------------------------ the bridge and tick

test('the game-id bridge resolves ONCE and caches on the match', () => {
  assert.match(LIVE, /const cached = match\.external_ids\?\.bdl_ncaaf_game_id;/);
  assert.match(LIVE, /if \(cached\) return \{ id: Number\(cached\), cached: true, calls: 0 \}/);
  assert.match(LIVE, /jsonb_build_object\('bdl_ncaaf_game_id'/);
  // The cache write must MERGE, never replace external_ids.
  assert.match(LIVE, /COALESCE\(external_ids, '\{\}'::jsonb\)\s*\n?\s*\|\| jsonb_build_object/);
});

test('one game throwing cannot abort the tick for its siblings', () => {
  const fn = LIVE.slice(LIVE.indexOf('export async function syncCfbLiveLines'));
  const bodyStart = fn.indexOf('async function syncOne(m)');
  const tryStart = fn.indexOf('try {', bodyStart);
  const catchStart = fn.indexOf('} catch (e) {', bodyStart);
  assert.ok(bodyStart > -1 && tryStart > bodyStart && catchStart > tryStart,
    'the per-game body must be inside its own try/catch, not the bare pool');
  assert.match(fn.slice(catchStart), /summary\.perGame\.push\(\{ match: m\.id, error:/,
    'a failed game is recorded on the summary, not thrown past the pool');
});

test('the cache-write parameter is cast - jsonb_build_object cannot infer it bare', () => {
  assert.match(LIVE, /jsonb_build_object\('bdl_ncaaf_game_id', \$\{String\(hit\.id\)\}::text\)/,
    'an uncast parameter into a variadic "any" function fails every first resolution');
});

test('it is LEAGUE-WIDE now - no board join (ruling sun-7)', () => {
  // This test used to pin the Pick'em board join as the cost bound. The
  // ruling widened the box score to every live CFB game; the bound is now the
  // concurrency + time budget, pinned by the behavioural tests below.
  const q = LIVE_CODE.slice(LIVE_CODE.indexOf('export async function liveCfbMatches'),
    LIVE_CODE.indexOf('export function sharedGamesFetcher'));
  assert.doesNotMatch(q, /contests|board|pickem/i, 'enumeration must not depend on a board');
  assert.match(q, /FROM matches m/);
  const fn = LIVE.slice(LIVE.indexOf('export async function syncCfbLiveLines'));
  assert.match(fn, /if \(!live\.length\) return summary;/,
    'no live game means no provider call at all');
  assert.doesNotMatch(LIVE, /BOARD-SCOPED, the same bound/, 'the stale board-scoped doc is gone');
});

test('the tick runs it LAST, and its failure cannot fail the games sync', () => {
  const SYNC = src('lib/gridiron/sync.js');
  const fn = SYNC.slice(SYNC.indexOf('export async function syncCfbGames'));
  assert.ok(fn.indexOf('await upsertGame') < fn.indexOf('syncCfbLiveLines('),
    'status must be written before the overlay reads it');
  assert.ok(fn.indexOf('syncCfbLiveScores(') < fn.indexOf('syncCfbLiveLines('));
  // recordRun wraps the call now, not a bare .catch() - but the promise it
  // wraps is not awaited by the outer syncCfbGames() try/catch (there is
  // none), so a throw inside syncCfbLiveLines still cannot fail the tick.
  assert.match(fn, /recordRun\(sql, \{[\s\S]*?source: 'cfb-live-lines'[\s\S]*?run: \(\) => syncCfbLiveLines\(leagueId, \{ deadlineAt: tickStartedAt \+ CFB_LIVE_LINES_DEADLINE_MS \}\)/,
    'the overlay gets its own recordRun-wrapped ledger row');
  assert.match(fn, /if \(!liveLineRun\.ok\)/,
    'a failure must be visible - checked, not just contained');
});

// ------------------------------------- league-wide, bounded (ruling sun-7)
//
// BEHAVIOUR, NOT SOURCE TEXT. Every DB seam is stubbed, so these run with no
// database and no network: a fake matches table, fake fetchers that count
// their calls, and a fake clock for the budget.

const KICK = '2026-10-03T19:30:00Z';
const mk = (id, home, away, extra = {}) => ({
  id, slug: `m${id}`, kickoff_at: KICK, external_ids: {}, home_name: home, away_name: away, ...extra,
});
const bdlGame = (id, home, away) => ({ id, home_team: { college: home }, visitor_team: { college: away } });
const statRow = (pid, college) => ({ player: { id: pid, first_name: 'A', last_name: `P${pid}` }, team: { college }, passing_yards: 10 });

function harness({ live, statusOf = () => 'live', games, statsDelay = 0, clock } = {}) {
  const calls = { games: [], stats: [], saved: [], written: [] };
  return {
    calls,
    opts: {
      listLive: async () => live,
      loadTeamMap: async () => ({ resolve: () => 1 }),
      readStatus: async (id) => statusOf(id),
      writeLines: async (rows) => { calls.written.push(...rows.map((r) => r.match_id)); return rows.length; },
      saveGameId: async (matchId, bdlId) => { calls.saved.push([matchId, bdlId]); },
      fetchGames: async (iso) => { calls.games.push(iso); return games ?? []; },
      fetchPlayerStats: async (bdlId) => {
        calls.stats.push(bdlId);
        if (statsDelay) await new Promise((r) => setTimeout(r, statsDelay));
        return [statRow(bdlId * 10, 'X')];
      },
      ...(clock ? { clock } : {}),
    },
  };
}

test('an OFF-BOARD live game is synced - enumeration no longer asks for a board', async () => {
  // Match 7 is on no Pick'em board anywhere; under the old join it was
  // invisible. It is live, so it is enumerated, resolved and written.
  const h = harness({
    live: [mk(7, 'UNLV', 'Boise State')],
    games: [bdlGame(457189, 'UNLV', 'Boise State')],
  });
  const s = await syncCfbLiveLines(99, h.opts);
  assert.equal(s.liveGames, 1);
  assert.equal(s.resolved, 1);
  assert.deepEqual(h.calls.written, [7]);
  assert.deepEqual(h.calls.saved, [[7, 457189]], 'the resolution is cached on the match');
});

test('a game that went FINAL during the fetch is not written', async () => {
  const h = harness({
    live: [mk(1, 'A', 'B'), mk(2, 'C', 'D')],
    games: [bdlGame(11, 'A', 'B'), bdlGame(22, 'C', 'D')],
    statusOf: (id) => (id === 2 ? 'final' : 'live'),
  });
  const s = await syncCfbLiveLines(99, h.opts);
  assert.deepEqual(h.calls.written, [1], 'only the still-live game is written');
  assert.ok(s.perGame.some((g) => g.match === 2 && g.skipped === 'went-final'));
});

test('ONE dated /games call per tick, shared by every unresolved game', async () => {
  const live = Array.from({ length: 25 }, (_, i) => mk(i + 1, `H${i}`, `V${i}`));
  const games = live.map((m, i) => bdlGame(1000 + i, m.home_name, m.away_name));
  const h = harness({ live, games });
  const s = await syncCfbLiveLines(99, h.opts);
  assert.equal(h.calls.games.length, 1, `25 unresolved games, one /games call (got ${h.calls.games.length})`);
  assert.equal(s.gamesCalls, 1);
  assert.equal(s.statsCalls, 25);
  assert.equal(s.calls, 26, 'calls counts what was actually made');
  assert.equal(s.resolved, 25);
});

test('a game with a CACHED BDL id makes no /games call at all', async () => {
  const h = harness({ live: [mk(1, 'A', 'B', { external_ids: { bdl_ncaaf_game_id: '55' } })] });
  const s = await syncCfbLiveLines(99, h.opts);
  assert.equal(h.calls.games.length, 0);
  assert.deepEqual(h.calls.stats, [55]);
  assert.equal(s.calls, 1);
});

test('a FAILED dated call is shared too - one call, every game on it reports the error', async () => {
  let n = 0;
  const shared = sharedGamesFetcher(async () => { n += 1; throw new Error('BDL 401 on /ncaaf/v1/games'); });
  const results = await Promise.allSettled([shared('2026-10-03'), shared('2026-10-03'), shared('2026-10-04')]);
  assert.equal(n, 2, 'one call per distinct date');
  assert.equal(shared.calls(), 2);
  assert.ok(results.every((r) => r.status === 'rejected'));

  const live = [mk(1, 'A', 'B'), mk(2, 'C', 'D')];
  const h = harness({ live });
  h.opts.fetchGames = async (iso) => { h.calls.games.push(iso); throw new Error('BDL 401 on /ncaaf/v1/games'); };
  const s = await syncCfbLiveLines(99, h.opts);
  assert.equal(h.calls.games.length, 1);
  assert.equal(s.perGame.filter((g) => /401/.test(g.error ?? '')).length, 2,
    'each game still records its own error - containment is per game');
});

test('the shared fetcher keys by DATE: a game kicking off past midnight UTC asks for its own day', async () => {
  const live = [mk(1, 'A', 'B'), mk(2, 'C', 'D', { kickoff_at: '2026-10-04T00:30:00Z' })];
  const h = harness({ live, games: [] });
  await syncCfbLiveLines(99, h.opts);
  assert.deepEqual(h.calls.games.sort(), ['2026-10-03', '2026-10-04']);
});

test('CONCURRENCY is bounded: never more than LIVE_LINES_CONCURRENCY in flight', async () => {
  assert.equal(LIVE_LINES_CONCURRENCY, 5);
  const live = Array.from({ length: 23 }, (_, i) => mk(i + 1, `H${i}`, `V${i}`, { external_ids: { bdl_ncaaf_game_id: String(i + 1) } }));
  const h = harness({ live });
  let inFlight = 0, peak = 0;
  h.opts.fetchPlayerStats = async () => {
    inFlight += 1; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return [];
  };
  const s = await syncCfbLiveLines(99, h.opts);
  assert.equal(peak, 5, `peak in flight ${peak}`);
  assert.equal(s.statsCalls, 23, 'and every game is still reached');
  assert.equal(s.skippedForBudget, 0);
});

test('the TIME BUDGET stops starting games and counts what it skipped', async () => {
  // A fake clock that advances 1 s per read: with budgetMs 4000 and
  // concurrency 1, only a handful of games are started; the rest wait.
  let t = 0;
  const clock = () => (t += 1000);
  const live = Array.from({ length: 30 }, (_, i) => mk(i + 1, `H${i}`, `V${i}`, { external_ids: { bdl_ncaaf_game_id: String(i + 1) } }));
  const h = harness({ live, clock });
  const s = await syncCfbLiveLines(99, { ...h.opts, concurrency: 1, budgetMs: 4000 });
  assert.ok(s.statsCalls > 0 && s.statsCalls < 30, `started ${s.statsCalls}`);
  assert.equal(s.skippedForBudget, 30 - s.statsCalls, 'every game not started is counted');
  assert.equal(s.liveGames, 30);
});

test('the caller DEADLINE wins when it is earlier than the budget', async () => {
  const live = Array.from({ length: 10 }, (_, i) => mk(i + 1, `H${i}`, `V${i}`, { external_ids: { bdl_ncaaf_game_id: String(i + 1) } }));
  const h = harness({ live });
  const s = await syncCfbLiveLines(99, { ...h.opts, deadlineAt: Date.now() - 1 });
  assert.equal(s.statsCalls, 0, 'a tick already past its deadline starts nothing');
  assert.equal(s.skippedForBudget, 10);
  assert.equal(LIVE_LINES_BUDGET_MS, 20_000);
});

test('a game still IN FLIGHT at the deadline is abandoned, not awaited', async () => {
  const live = [mk(1, 'A', 'B', { external_ids: { bdl_ncaaf_game_id: '1' } }),
    mk(2, 'C', 'D', { external_ids: { bdl_ncaaf_game_id: '2' } })];
  const h = harness({ live });
  h.opts.fetchPlayerStats = () => new Promise(() => {}); // a provider that never answers
  const t0 = Date.now();
  const s = await syncCfbLiveLines(99, { ...h.opts, budgetMs: 60, concurrency: 1 });
  assert.ok(Date.now() - t0 < 1000, 'returned at the budget, not never');
  assert.equal(s.timedOut, 1);
  assert.equal(s.skippedForBudget, 1, 'the second game was never started');
});

test('no live game: no provider call, no team map', async () => {
  const h = harness({ live: [] });
  let mapped = false;
  const s = await syncCfbLiveLines(99, { ...h.opts, loadTeamMap: async () => { mapped = true; } });
  assert.equal(s.liveGames, 0);
  assert.equal(h.calls.games.length + h.calls.stats.length, 0);
  assert.equal(mapped, false);
});

test('resolveBdlGameId: an unlisted game is unresolved, not mismatched', async () => {
  const r = await resolveBdlGameId(mk(1, 'A', 'B'), {
    fetchGames: async () => [bdlGame(9, 'A', 'Z')], saveGameId: async () => { throw new Error('must not save'); },
  });
  assert.equal(r.id, null);
});
