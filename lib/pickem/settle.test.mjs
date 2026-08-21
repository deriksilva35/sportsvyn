// lib/pickem/settle.test.mjs - the scorer and the gate against the database.
//
// Hermetic NOVEMBER 2031 (builder owns August, entry flow owns October - a
// window per file, so the parallel suite cannot cross-adopt boards). The
// sweep DOES see other fixtures' unsettled boards; every assertion here
// therefore reads its own contest's row out of the results, never counts.
//
// CALENDAR FACT: Mon 2031-11-03 starts the window (DST ended Nov 2 - the
// fixture speaks UTC and owes the zone nothing).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
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
const { ensurePickemBoard } = await import('./create.js');
const { savePick, receiptFor } = await import('./entry.js');
const { settleDuePickem, scoreLineup, stalePickemBoards } = await import('./settle.js');

const LG = 'pickemtest3-cfb';
const EMAIL_C = 'pickemtest-c@example.invalid';
const EMAIL_D = 'pickemtest-d@example.invalid';
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const KO = {
  g1: '2031-11-08T17:00:00Z', // Sat noon ET (EST)
  g2: '2031-11-08T20:30:00Z',
  g3: '2031-11-09T01:00:00Z', // Sat 8 PM ET
};
const OPEN_NOW = new Date('2031-11-05T15:00:00Z');   // Wed - board open, nothing kicked
const SUNDAY = new Date('2031-11-09T12:00:00Z');     // the settle window

let leagueId, uC, uD, contestId;
const matchIds = {};
const rowFor = (r, id) => r.summaryRow ?? r.results.find((x) => x.contestId === id);

{
  leagueId = (await sql`
    INSERT INTO leagues (slug, name, sport, external_ids, metadata)
    VALUES (${LG}, 'Pickem Settle Test', 'cfb', '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  const tA = (await sql`INSERT INTO teams (league_id, slug, name, short_name, external_ids, metadata)
    VALUES (${leagueId}, 'pk3-home', 'Homer', 'Homer', '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  const tB = (await sql`INSERT INTO teams (league_id, slug, name, short_name, external_ids, metadata)
    VALUES (${leagueId}, 'pk3-away', 'Roader', 'Roader', '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  for (const [key, ko] of Object.entries(KO)) {
    matchIds[key] = (await sql`
      INSERT INTO matches (league_id, slug, kickoff_at, status, home_team_id, away_team_id,
                           season_year, season_phase, week, external_ids, metadata)
      VALUES (${leagueId}, ${'pk3-' + key}, ${ko}, 'scheduled', ${tA}, ${tB},
              2031, 'REG', 99, '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  }
  for (const email of [EMAIL_C, EMAIL_D]) {
    await sql`INSERT INTO users (email) VALUES (${email}) ON CONFLICT DO NOTHING`;
  }
  uC = (await sql`SELECT id FROM users WHERE email = ${EMAIL_C}`)[0].id;
  uD = (await sql`SELECT id FROM users WHERE email = ${EMAIL_D}`)[0].id;
  contestId = (await ensurePickemBoard({ leagueSlug: LG, now: OPEN_NOW })).id;
  // C plays the full board: home, away, home. D shares only g1's home side.
  await savePick(uC, contestId, matchIds.g1, 'home', { now: OPEN_NOW });
  await savePick(uC, contestId, matchIds.g2, 'away', { now: OPEN_NOW });
  await savePick(uC, contestId, matchIds.g3, 'home', { now: OPEN_NOW });
  await savePick(uD, contestId, matchIds.g1, 'home', { now: OPEN_NOW });
}

after(async () => {
  await sql`DELETE FROM contest_entries WHERE contest_id = ${contestId}`;
  await sql`DELETE FROM contests WHERE game_type = 'pickem' AND sport = ${LG}`;
  await sql`DELETE FROM matches WHERE league_id = ${leagueId}`;
  await sql`DELETE FROM teams WHERE league_id = ${leagueId}`;
  await sql`DELETE FROM leagues WHERE id = ${leagueId}`;
  await sql`DELETE FROM users WHERE email IN (${EMAIL_C}, ${EMAIL_D})`;
});

test('scoreLineup is counting: wins count, no-pick is 0 by absence, null wins nobody', () => {
  const results = { 1: 'home', 2: 'away', 3: null };
  assert.equal(scoreLineup({ 1: 'home', 2: 'away', 3: 'home' }, results), 2);
  assert.equal(scoreLineup({ 1: 'away' }, results), 0);
  assert.equal(scoreLineup({}, results), 0);
  assert.equal(scoreLineup({ 3: 'home' }, results), 0, 'a tie awards nobody');
});

test('the gate refuses while any game is not final - a refusal, not a failure', async () => {
  await sql`UPDATE matches SET status = 'final', home_score = 31, away_score = 17
    WHERE id = ${matchIds.g1}`;                                     // home wins
  await sql`UPDATE matches SET status = 'live', home_score = 3, away_score = 10
    WHERE id = ${matchIds.g2}`;
  const r = await settleDuePickem({ now: SUNDAY });
  const mine = r.results.find((x) => x.contestId === contestId);
  assert.equal(mine.settled, false);
  assert.equal(mine.remaining, 2, 'live + scheduled both hold the gate');
  const c = (await sql`SELECT settled FROM contests WHERE id = ${contestId}`)[0];
  assert.equal(c.settled, false);
});

test('all finals in: the board settles, scores are counted, receipts read the field', async () => {
  await sql`UPDATE matches SET status = 'final', home_score = 13, away_score = 20
    WHERE id = ${matchIds.g2}`;                                     // away wins
  await sql`UPDATE matches SET status = 'final', home_score = 24, away_score = 27
    WHERE id = ${matchIds.g3}`;                                     // away wins
  const r = await settleDuePickem({ now: SUNDAY });
  const mine = r.results.find((x) => x.contestId === contestId);
  assert.equal(mine.settled, true);
  assert.equal(mine.entries, 2);

  const c = (await sql`SELECT settled, perfect FROM contests WHERE id = ${contestId}`)[0];
  assert.equal(c.settled, true);
  assert.equal(c.perfect.results[String(matchIds.g1)], 'home', 'the counted results ride the row');

  const rows = await sql`
    SELECT user_id, score, locked_at FROM contest_entries WHERE contest_id = ${contestId}`;
  const eC = rows.find((x) => x.user_id === uC);
  const eD = rows.find((x) => x.user_id === uD);
  assert.equal(Number(eC.score), 2, 'C: g1 home W, g2 away W, g3 home L');
  assert.equal(Number(eD.score), 1, 'D: the one shared pick won; two no-picks are 0');
  assert.ok(eC.locked_at != null && eD.locked_at != null, 'settle stamps the lock');

  // THE RECEIPT: rank over scores; best pick = MY rarest correct side.
  const board = (await sql`SELECT board FROM contests WHERE id = ${contestId}`)[0].board;
  const rC = await receiptFor(contestId, uC, { results: c.perfect.results, board });
  assert.deepEqual({ rank: rC.rank, field: rC.field, score: rC.score }, { rank: 1, field: 2, score: 2 });
  assert.equal(rC.best.name, 'Roader', "C's g2 away win was C's alone");
  assert.equal(rC.best.pct, 50);
  const rD = await receiptFor(contestId, uD, { results: c.perfect.results, board });
  assert.equal(rD.rank, 2);
  assert.equal(rD.best.pct, 100, "D's only win was the whole field's pick");
});

test('a second sweep is a no-op - the settled board is out of the due set', async () => {
  const r = await settleDuePickem({ now: SUNDAY });
  assert.equal(r.results.find((x) => x.contestId === contestId), undefined);
});

test('the stale alarm sees a board that cannot complete; the cron is wired', async () => {
  // A board 3 days past its advisory settle, still unsettled, would page.
  const ghost = (await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at)
    VALUES ('pickem', ${LG}, 2031, 98, '[]'::jsonb,
            '2031-10-27T13:00:00Z', '2031-11-01T17:00:00Z', '2031-11-02T05:00:00Z')
    RETURNING id`)[0].id;
  const stale = await stalePickemBoards({ now: SUNDAY });
  assert.ok(stale.some((s) => s.id === ghost), '48h past settles_at without a settle pages');
  await sql`DELETE FROM contests WHERE id = ${ghost}`;

  const route = src('app/api/cron/pickem-settle/route.js');
  assert.match(route, /settleDuePickem\(\)/);
  assert.match(route, /stalePickemBoards\(\)/, 'the stall cannot pass silently');
  assert.match(route, /await maybeAlert\(sql, \{/);
  const crons = JSON.parse(src('vercel.json')).crons;
  const mine = crons.find((x) => x.path === '/api/cron/pickem-settle');
  assert.equal(mine?.schedule, '0 6-20 * * 0,1', 'hourly Sundays and Mondays');
});
