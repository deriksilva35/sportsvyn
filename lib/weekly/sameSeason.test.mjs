// lib/weekly/sameSeason.test.mjs - THE DRAFT AND THE WEEKLY SHOW THE SAME
// NUMBER FOR THE SAME MAN.
//
// THE DEFECT THIS CLOSES, DATED 17 Sep 2026. The draft room's stat column read
// `const SEASON_YEAR = 2025` (lib/fantasy/playerStats.js), hardcoded when 2026
// had no weeks. The Weekly's panel reads the contest's own season. So on one
// afternoon the Draft showed Kenneth Walker at 11.3 ppg and the Weekly showed
// him at 34.1 - the same player, two screens, two seasons, and nothing on
// either screen to say which.
//
// TWO READERS, ONE SCAN. Both now go through seasonTotals() in
// lib/weekly/seasonLine.js: the same finals, the same sums, the one scorer.
// This test is the link between them, and it reads the DATABASE rather than a
// fixture on purpose - a drift test against two mocks would pass on the day
// the readers part.

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
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const { sql } = await import('../db.js');
const { seasonStats } = await import('./seasonLine.js');
const { getPlayerSeasonSummaries } = await import('../fantasy/playerStats.js');

// The season under test: whichever one this database has finals for, newest
// first. Written this way so the test keeps meaning something in 2027.
let SEASON = null;
let pairs = [];   // [{ ffc, nflId, name }]
before(async () => {
  const [s] = await sql`
    SELECT max(m.season_year) AS y
      FROM nfl_player_game_stats s JOIN matches m ON m.id = s.match_id
      JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = 'nfl' AND m.season_phase = 'REG' AND m.status = 'final'`;
  SEASON = s?.y == null ? null : Number(s.y);
  if (SEASON == null) return;
  pairs = (await sql`
    SELECT DISTINCT ON (p.ffc_player_id) p.ffc_player_id AS ffc, np.id AS nfl_id, np.full_name AS name
      FROM sim_player_pool p
      JOIN nfl_players np ON np.id = p.matched_player_id
     WHERE np.is_team_defense IS NOT TRUE
       AND EXISTS (
         SELECT 1 FROM nfl_player_game_stats s JOIN matches m ON m.id = s.match_id
          WHERE s.nfl_player_id = np.id AND m.season_year = ${SEASON}
            AND m.season_phase = 'REG' AND m.status = 'final')
     LIMIT 40`).map((r) => ({ ffc: String(r.ffc), nflId: Number(r.nfl_id), name: r.name }));
});

test('this database has a season with finals to compare over', () => {
  assert.ok(SEASON != null, 'no final REG games at all');
  assert.ok(pairs.length > 0, 'no matched pool player has a game this season');
});

test('EVERY MATCHED PLAYER READS THE SAME PPG AND THE SAME GAMES ON BOTH SURFACES', async () => {
  if (!pairs.length) return;
  const weekly = await seasonStats(SEASON);
  const room = await getPlayerSeasonSummaries(pairs.map((p) => p.ffc), 'ppr', SEASON);
  let compared = 0;
  for (const p of pairs) {
    const w = weekly.get(p.nflId);
    const r = room[p.ffc];
    if (!w || !r) continue;   // one of them has no line; the disagreement test is below
    compared += 1;
    assert.equal(r.games, w.gp, `${p.name}: games`);
    // The two round at different moments (the room scores in the ROOM's format
    // and divides; the panel scores in PPR and divides), so a tenth of float
    // slack - never a season's worth.
    assert.ok(Math.abs(r.ppg - w.ppg) <= 0.1, `${p.name}: room ${r.ppg} vs weekly ${w.ppg}`);
  }
  assert.ok(compared >= 10, `only ${compared} players compared`);
});

test('AND NEITHER SURFACE KNOWS ABOUT A PLAYER THE OTHER DOES NOT', async () => {
  if (!pairs.length) return;
  const weekly = await seasonStats(SEASON);
  const room = await getPlayerSeasonSummaries(pairs.map((p) => p.ffc), 'ppr', SEASON);
  for (const p of pairs) {
    assert.equal(Boolean(room[p.ffc]), Boolean(weekly.get(p.nflId)),
      `${p.name}: one surface has a line and the other does not`);
  }
});

test("KENNETH WALKER, THE MAN THE TWO SCREENS DISAGREED ABOUT", async () => {
  // ffc 5625 -> nfl_players 133 on this database. Skipped rather than failed
  // where that pairing does not exist, because the rule is the agreement and
  // not this particular player.
  const walker = pairs.find((p) => p.nflId === 133) ?? null;
  if (!walker) return;
  const weekly = await seasonStats(SEASON);
  const room = await getPlayerSeasonSummaries([walker.ffc], 'ppr', SEASON);
  const w = weekly.get(133);
  const r = room[walker.ffc];
  assert.ok(w && r, 'both readers have him');
  assert.equal(r.games, w.gp);
  assert.ok(Math.abs(r.ppg - w.ppg) <= 0.1, `room ${r.ppg} vs weekly ${w.ppg}`);
  // On PROD at the time of writing this is 34.1 over one game of 2026; the
  // assertion is the AGREEMENT, so it survives him playing a second game.
  assert.ok(r.ppg > 0, `a real number, got ${r.ppg}`);
});

test('THE CONSTANT IS GONE, AND THE SEASON IS AN ARGUMENT', () => {
  const src = readFileSync(new URL('../fantasy/playerStats.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /const SEASON_YEAR\s*=/, 'the hardcoded season is deleted');
  assert.match(src, /export async function getPlayerSeasonSummaries\(ffcPlayerIds, scoringFormat, season\)/);
  assert.match(src, /export async function getPlayerSeasonStats\(ffcPlayerId, season\)/);
  assert.match(src, /import \{ seasonTotals \} from '\.\.\/weekly\/seasonLine\.js'/,
    'and the skill path reads the shared scan');
  // FINALS ONLY, on every season read in this file.
  assert.equal((src.match(/m\.status = 'final'/g) ?? []).length, 3,
    "the game log, the defense log and the DST summary each say finals only");
});

test('THE SEASON COMES FROM THE SERVER, never from the client', () => {
  const act = readFileSync(new URL('../../app/actions/sim.js', import.meta.url), 'utf8');
  assert.match(act, /async function seasonForDraft\(draftId\)/);
  assert.match(act, /FROM contest_entries e/, "a ranked room takes its contest's season");
  assert.match(act, /return resolveSeasonYear\(new Date\(\)\)/, 'and everything else takes the current one');
  assert.match(act, /export async function fetchPlayerSummaries\(draftId, ffcPlayerIds, scoringFormat\)/);
  assert.match(act, /export async function fetchPlayerStats\(draftId, ffcPlayerId\)/);
  // The client sends an id, never a year.
  const room = readFileSync(new URL('../../components/sim/DraftRoom.js', import.meta.url), 'utf8');
  assert.match(room, /fetchPlayerSummaries\(draftId, available\.map/);
  assert.doesNotMatch(room, /season(Year)?:\s*\d{4}/, 'no year is typed in the room');
});
