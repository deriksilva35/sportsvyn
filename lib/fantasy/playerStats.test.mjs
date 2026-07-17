// lib/fantasy/playerStats.test.mjs - the REAL stats path, against DEV.
// node --test. Read-only: this suite never writes, so there is no cleanup hook.
// Run: node --test lib/fantasy/playerStats.test.mjs
//
// Data under test is the gridiron session 2 backfill (migration 049):
// nfl_players 11,697 (incl 32 synthetic DSTs) - nfl_player_game_stats 18,632
// (17,777 REG + 855 POST) - sim_player_pool 717/717 matched.

import { test, before } from 'node:test';
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
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const { neon } = await import('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const { getPlayerSeasonStats, getPlayerSeasonSummaries, toStatLine, toDefenseLine, oppFor, sumStats } =
  await import('./playerStats.js');
const { seasonSummary, fantasyPoints } = await import('./scoring.js');
const { viewFor } = await import('./statView.js');

const idOf = async (name) =>
  (await sql`SELECT ffc_player_id FROM sim_player_pool WHERE name = ${name} LIMIT 1`)[0]?.ffc_player_id;

let STAFFORD; let DENVER; let NOSTATS;
before(async () => {
  STAFFORD = await idOf('Matthew Stafford');
  DENVER = await idOf('Denver Defense');
  NOSTATS = (await sql`
    SELECT p.ffc_player_id FROM sim_player_pool p
      JOIN nfl_players np ON p.matched_player_id = np.id
     WHERE NOT np.is_team_defense
       AND NOT EXISTS (SELECT 1 FROM nfl_player_game_stats s WHERE s.nfl_player_id = np.id)
     LIMIT 1`)[0]?.ffc_player_id;
  assert.ok(STAFFORD && DENVER && NOSTATS, 'fixture players resolve');
});

// ---------------------------------------------------------------------------
// pure helpers
// ---------------------------------------------------------------------------
test('oppFor labels away games with @ and home games bare', () => {
  const m = { home_team_id: 10, home_abbr: 'KC', away_abbr: 'DEN' };
  assert.equal(oppFor(10, m), 'DEN');   // player is home -> opponent is the away side
  assert.equal(oppFor(99, m), '@KC');   // player is away -> at the home side
  assert.equal(oppFor('10', m), 'DEN'); // ids may arrive as strings
});

test('sumStats skips nulls entirely: null is "not recorded", never a 0', () => {
  const t = sumStats([{ stats: { rec: 3, recYds: null } }, { stats: { rec: null, recYds: 40 } }]);
  assert.equal(t.rec, 3);
  assert.equal(t.recYds, 40);
});

test('toStatLine does NOT emit defensive stats on an offensive line', () => {
  // Regression: scoring.js scores `fr` as a defensive recovery (+2). Mapping the
  // column onto a QB paid Stafford +6 for recovering his own fumbles.
  const line = toStatLine({ pass_yds: 300, pass_td: 2, fr: 3, sacks: 1, def_int: 2, def_td: 1 });
  assert.equal(line.passYds, 300);
  for (const k of ['fr', 'sacks', 'defInt', 'defTd']) {
    assert.ok(!(k in line), `offensive line must not carry ${k}`);
  }
  assert.equal(fantasyPoints(line, 'ppr'), 20); // 300/25 + 2*4, no defensive credit
});

test('toDefenseLine carries only what scoring treats as DST production', () => {
  const d = toDefenseLine({ sacks: '6.5', def_int: 2, fr: 1, def_td: 1 });
  assert.deepEqual(d, { sacks: 6.5, defInt: 2, fr: 1, defTd: 1 }); // numeric sacks coerced
});

// ---------------------------------------------------------------------------
// real path
// ---------------------------------------------------------------------------
test('a matched QB returns structured REG-only stats', async () => {
  const s = await getPlayerSeasonStats(STAFFORD);
  assert.equal(s.season, 2025);
  assert.equal(s.source, 'db');
  assert.equal(s.position, 'QB');
  assert.equal(s.games.length, 17);                 // 17 REG; the 3 POST games are excluded
  assert.equal(s.totals.passYds, 4707);
  assert.equal(s.totals.passTd, 46);
  assert.equal(typeof s.games[0].week, 'number');
  assert.match(s.games[0].opp, /^@?[A-Z]{2,3}$/);
  assert.equal(typeof s.games[0].stats.passYds, 'number'); // structured, not a display string
});

test('POST rows are excluded from totals and the game log', async () => {
  const all = (await sql`
    SELECT count(*)::int games, sum(s.pass_yds)::int yds, sum(s.pass_td)::int td
      FROM nfl_player_game_stats s
      JOIN nfl_players np ON s.nfl_player_id = np.id
      JOIN matches m ON s.match_id = m.id
     WHERE np.normalized_name = 'matthew stafford'`)[0];
  const s = await getPlayerSeasonStats(STAFFORD);
  // All-phase totals are strictly larger; the reader must return the REG subset.
  assert.equal(all.games, 20);
  assert.equal(all.yds, 5643);
  assert.equal(all.td, 52);
  assert.ok(s.totals.passYds < all.yds, 'REG totals must exclude playoff yardage');
  assert.equal(s.games.length, 17);
  assert.equal(s.games.filter((g) => g.week > 18).length, 0);
});

test('a DST aggregates its team defensive rows, per game and for the season', async () => {
  const d = await getPlayerSeasonStats(DENVER);
  assert.equal(d.position, 'DEF');
  assert.equal(d.games.length, 17);
  assert.equal(d.totals.sacks, 68);
  assert.equal(d.totals.defInt, 10);
  // The season line must equal the sum of the per-game lines it is built from.
  const summed = d.games.reduce((a, g) => a + Number(g.stats.sacks ?? 0), 0);
  assert.equal(summed, d.totals.sacks);
  // Cross-check the aggregation against the DB directly.
  const direct = (await sql`
    SELECT sum(s.sacks)::float sacks FROM nfl_players dst
      JOIN nfl_player_game_stats s ON s.team_id = dst.team_id
      JOIN matches m ON s.match_id = m.id AND m.season_phase = 'REG'
     WHERE dst.is_team_defense AND dst.team_id = (
       SELECT np.team_id FROM sim_player_pool p JOIN nfl_players np ON p.matched_player_id = np.id
        WHERE p.ffc_player_id = ${DENVER} LIMIT 1)`)[0];
  assert.equal(d.totals.sacks, direct.sacks);
});

test('a matched player with no 2025 line returns null, not a line of zeros', async () => {
  assert.equal(await getPlayerSeasonStats(NOSTATS), null);
  const sum = await getPlayerSeasonSummaries([NOSTATS], 'ppr');
  assert.deepEqual(sum, {}); // omitted -> the room renders "unknown", not 0.0 PPG
});

test('an unknown ffc id returns null rather than throwing', async () => {
  assert.equal(await getPlayerSeasonStats('not-a-real-ffc-id'), null);
  assert.deepEqual(await getPlayerSeasonSummaries(['not-a-real-ffc-id'], 'ppr'), {});
});

// ---------------------------------------------------------------------------
// the fan-out trap
// ---------------------------------------------------------------------------
test('snapshot fan-out does not multiply totals (sim_player_pool has 4 rows per player)', async () => {
  const rows = (await sql`
    SELECT count(*)::int n FROM sim_player_pool WHERE ffc_player_id = ${STAFFORD}`)[0].n;
  assert.ok(rows > 1, 'precondition: this player has multiple snapshot rows');
  const s = await getPlayerSeasonStats(STAFFORD);
  // Joining stats THROUGH pool rows would report 17 * rows games and 4x the yards.
  assert.equal(s.games.length, 17);
  assert.equal(s.totals.passYds, 4707);
  assert.ok(s.totals.passYds < 4707 * rows);
});

test('summaries are keyed per player and never multiplied by snapshot count', async () => {
  const sum = await getPlayerSeasonSummaries([STAFFORD, DENVER], 'ppr');
  assert.equal(sum[STAFFORD].games, 17);
  assert.equal(sum[DENVER].games, 17);
  assert.equal(sum[STAFFORD].totals.passYds, 4707);
});

// ---------------------------------------------------------------------------
// summaries
// ---------------------------------------------------------------------------
test('collapsed-row PPG equals the expanded strip PER GAME (same function, no drift)', async () => {
  const s = await getPlayerSeasonStats(STAFFORD);
  const sum = await getPlayerSeasonSummaries([STAFFORD], 'ppr');
  assert.equal(sum[STAFFORD].ppg, seasonSummary(s.games, 'ppr').ppg);
  assert.equal(sum[STAFFORD].points, seasonSummary(s.games, 'ppr').points);
});

test('summaries are format-aware: PPR pays receptions, standard does not', async () => {
  const wr = (await sql`
    SELECT p.ffc_player_id FROM sim_player_pool p
      JOIN nfl_players np ON p.matched_player_id = np.id
     WHERE p.position = 'WR'
       AND EXISTS (SELECT 1 FROM nfl_player_game_stats s WHERE s.nfl_player_id = np.id)
     LIMIT 1`)[0].ffc_player_id;
  const ppr = await getPlayerSeasonSummaries([wr], 'ppr');
  const std = await getPlayerSeasonSummaries([wr], 'standard');
  assert.ok(ppr[wr].points > std[wr].points, 'PPR must outscore standard for a receiver');
  assert.equal(ppr[wr].totals.rec, std[wr].totals.rec); // same stats, different scoring
});

test('the whole pool resolves: 218 ids in, 201 out, 17 with no 2025 REG line', async () => {
  const ids = (await sql`SELECT DISTINCT ffc_player_id FROM sim_player_pool`).map((r) => r.ffc_player_id);
  assert.equal(ids.length, 218);
  const sum = await getPlayerSeasonSummaries(ids, 'ppr');
  assert.equal(Object.keys(sum).length, 201);
  assert.equal(ids.length - Object.keys(sum).length, 17);
});

test('getPlayerSeasonSummaries([]) short-circuits without a query', async () => {
  assert.deepEqual(await getPlayerSeasonSummaries([], 'ppr'), {});
  assert.deepEqual(await getPlayerSeasonSummaries(undefined, 'ppr'), {});
});

// ---------------------------------------------------------------------------
// consumer contract
// ---------------------------------------------------------------------------
test('statView renders a real line without xpAtt (BDL has no such field)', async () => {
  const k = (await sql`
    SELECT p.ffc_player_id FROM sim_player_pool p
      JOIN nfl_players np ON p.matched_player_id = np.id
     WHERE p.position = 'PK'
       AND EXISTS (SELECT 1 FROM nfl_player_game_stats s WHERE s.nfl_player_id = np.id)
     LIMIT 1`)[0].ffc_player_id;
  const s = await getPlayerSeasonStats(k);
  const view = viewFor(s.position);
  const row = view.row(s.games[0].stats);
  assert.equal(row.length, view.columns.length - 1); // columns[0] is OPP
  assert.ok(row.every((c) => c !== undefined && !String(c).includes('undefined')));
  assert.ok(view.quick(s.totals).every((q) => !q.includes('undefined') && !q.includes('NaN')));
});

test('every fantasy position produces a renderable, scoreable real line', async () => {
  for (const pos of ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF']) {
    const row = (await sql`
      SELECT p.ffc_player_id FROM sim_player_pool p
        JOIN nfl_players np ON p.matched_player_id = np.id
       WHERE p.position = ${pos}
         AND (np.is_team_defense
              OR EXISTS (SELECT 1 FROM nfl_player_game_stats s WHERE s.nfl_player_id = np.id))
       LIMIT 1`)[0];
    const s = await getPlayerSeasonStats(row.ffc_player_id);
    assert.ok(s, `${pos} resolves a season`);
    const view = viewFor(s.position);
    assert.equal(view.row(s.games[0].stats).length, view.columns.length - 1, `${pos} row width`);
    const pts = fantasyPoints(s.games[0].stats, 'ppr');
    assert.ok(Number.isFinite(pts), `${pos} scores a finite number`);
  }
});
