// lib/gridiron/oddsJoin.test.mjs — event->match resolution for gridiron odds.
// Run: node --test lib/gridiron/oddsJoin.test.mjs
//
// resolveTeamId is pure. joinEventsToMatches is driven by a FAKE sql (a
// tagged-template fn that pattern-matches the query text) so the primary/
// first-contact/window/event-id-capture paths are deterministic and DB-free.
// The one live dependency is toUtc('oddsapi'), which is pure Date math (no SQL).
//
// Route auth is covered by lib/pollers/cronAuth.test.mjs — the route delegates
// its gate to cronAuthorized; the contract test below re-asserts the no-bearer
// rejection the route relies on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// oddsJoin -> ingest -> lib/db binds neon(process.env.DATABASE_URL) at import, so
// load .env.local BEFORE importing (the fake-sql tests never touch the real DB;
// this only satisfies the import-time neon() binding). Same pattern as ingest.test.
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

const { resolveTeamId, joinEventsToMatches, CFB_TEAM_OVERRIDES } = await import('./oddsJoin.js');
const { normalizeName } = await import('./nameMatch.js');
const { cronAuthorized } = await import('../pollers/cronAuth.js');

// Build a teamsByNorm map + longest-first norm list from [name, id] pairs.
function teamsFrom(pairs) {
  const byNorm = new Map(pairs.map(([name, id]) => [normalizeName(name), id]));
  const desc = [...byNorm.keys()].sort((a, b) => b.length - a.length);
  return { byNorm, desc };
}

// ---------------------------------------------------------------------------
// resolveTeamId
// ---------------------------------------------------------------------------
test('NFL: exact normalized match only (no prefix)', () => {
  const { byNorm, desc } = teamsFrom([['Arizona Cardinals', 1], ['Buffalo Bills', 2]]);
  assert.equal(resolveTeamId('nfl', 'Arizona Cardinals', byNorm, desc), 1);
  assert.equal(resolveTeamId('nfl', 'Arizona Cardinals Football', byNorm, desc), null);
  assert.equal(resolveTeamId('nfl', 'Nope', byNorm, desc), null);
});

test('CFB: school name is a prefix of "School Mascot"', () => {
  const { byNorm, desc } = teamsFrom([['Alabama', 10], ['Air Force', 11]]);
  assert.equal(resolveTeamId('cfb', 'Alabama Crimson Tide', byNorm, desc), 10);
  assert.equal(resolveTeamId('cfb', 'Air Force Falcons', byNorm, desc), 11);
  assert.equal(resolveTeamId('cfb', 'Alabama', byNorm, desc), 10); // exact still works
});

test('CFB: longest prefix wins (miami oh vs miami)', () => {
  const { byNorm, desc } = teamsFrom([['Miami', 20], ['Miami (OH)', 21]]);
  // "Miami (OH) RedHawks" -> "miami oh redhawks": longest prefix "miami oh" -> 21
  assert.equal(resolveTeamId('cfb', 'Miami (OH) RedHawks', byNorm, desc), 21);
  // "Miami Hurricanes" -> "miami hurricanes": "miami oh " is NOT a prefix -> 20
  assert.equal(resolveTeamId('cfb', 'Miami Hurricanes', byNorm, desc), 20);
});

test('CFB: override beats prefix, exact beats override', () => {
  const { byNorm, desc } = teamsFrom([['Miami', 20], ['Alabama', 10]]);
  CFB_TEAM_OVERRIDES['miami gardens'] = 'Alabama'; // would prefix-match Miami(20)
  try {
    assert.equal(resolveTeamId('cfb', 'Miami Gardens', byNorm, desc), 10); // override wins
  } finally {
    delete CFB_TEAM_OVERRIDES['miami gardens'];
  }
});

// ---------------------------------------------------------------------------
// joinEventsToMatches — fake sql
// ---------------------------------------------------------------------------
function makeFakeSql({ leagueId = 62, teams = [], matches = [], updates }) {
  return async (strings) => {
    const q = strings.join('?');
    if (q.includes('FROM leagues')) return [{ id: leagueId }];
    if (q.includes('FROM teams')) return teams;
    if (q.includes('FROM matches')) return matches;
    if (q.includes('UPDATE matches')) { updates.push(strings); return []; }
    throw new Error(`fake sql: unexpected query ${q}`);
  };
}

test('first contact: name+window match, captures event id (merge only)', async () => {
  const updates = [];
  const capturedValues = [];
  // Intercept the update to inspect the merged jsonb payload + target id.
  const sql = async (strings, ...values) => {
    const q = strings.join('?');
    if (q.includes('FROM leagues')) return [{ id: 62 }];
    if (q.includes('FROM teams')) return [{ id: 1, name: 'Arizona Cardinals' }, { id: 2, name: 'Buffalo Bills' }];
    if (q.includes('FROM matches')) {
      return [{ id: 100, home_team_id: 1, away_team_id: 2, kickoff_at: '2026-09-05T00:20:00Z', external_ids: { bdl_game_id: 'bg1' } }];
    }
    if (q.includes('UPDATE matches')) { capturedValues.push(values); return []; }
    throw new Error(`unexpected ${q}`);
  };
  const events = [{
    id: 'evt1', home_team: 'Arizona Cardinals', away_team: 'Buffalo Bills',
    commence_time: '2026-09-05T00:20:00Z',
  }];
  const out = await joinEventsToMatches(sql, { leagueSlug: 'nfl', sport: 'nfl', events });
  assert.equal(out.stats.matched, 1);
  assert.equal(out.stats.captured, 1);
  assert.deepEqual(out.matched[0], { event: events[0], matchId: 100 });
  // The captured jsonb payload is ONLY the new key (merge via Postgres ||, never a clobber).
  const [jsonPayload, matchId] = capturedValues[0];
  assert.deepEqual(JSON.parse(jsonPayload), { odds_api_event: 'evt1' });
  assert.equal(matchId, 100);
  void updates;
});

test('kickoff outside 30-min window -> unmatched, no capture', async () => {
  const updates = [];
  const sql = makeFakeSql({
    teams: [{ id: 1, name: 'Arizona Cardinals' }, { id: 2, name: 'Buffalo Bills' }],
    matches: [{ id: 100, home_team_id: 1, away_team_id: 2, kickoff_at: '2026-09-05T00:20:00Z', external_ids: {} }],
    updates,
  });
  const events = [{
    id: 'evt2', home_team: 'Arizona Cardinals', away_team: 'Buffalo Bills',
    commence_time: '2026-09-05T02:00:00Z', // 100 min off
  }];
  const out = await joinEventsToMatches(sql, { leagueSlug: 'nfl', sport: 'nfl', events });
  assert.equal(out.stats.matched, 0);
  assert.equal(out.stats.unmatched, 1);
  assert.equal(updates.length, 0);
  assert.equal(out.unmatched[0].home, 'Arizona Cardinals');
});

test('primary path: existing event id matches regardless of names/time', async () => {
  const updates = [];
  const sql = makeFakeSql({
    teams: [],
    matches: [{ id: 200, home_team_id: 9, away_team_id: 8, kickoff_at: '2026-01-01T00:00:00Z', external_ids: { odds_api_event: 'evtX' } }],
    updates,
  });
  const events = [{ id: 'evtX', home_team: 'Whoever', away_team: 'Someone', commence_time: '2030-01-01T00:00:00Z' }];
  const out = await joinEventsToMatches(sql, { leagueSlug: 'nfl', sport: 'nfl', events });
  assert.equal(out.stats.matched, 1);
  assert.equal(out.stats.captured, 0);      // already captured; no re-write
  assert.equal(updates.length, 0);
  assert.deepEqual(out.matched[0], { event: events[0], matchId: 200 });
});

test('no league row -> everything unmatched', async () => {
  const sql = async (strings) => (strings.join('?').includes('FROM leagues') ? [] : []);
  const out = await joinEventsToMatches(sql, { leagueSlug: 'nope', sport: 'nfl', events: [{ id: 'e', home_team: 'a', away_team: 'b', commence_time: '2026-01-01T00:00:00Z' }] });
  assert.equal(out.stats.matched, 0);
  assert.equal(out.stats.unmatched, 1);
});

// ---------------------------------------------------------------------------
// route auth contract (delegated to cronAuthorized)
// ---------------------------------------------------------------------------
test('route auth: no/invalid bearer is rejected', () => {
  const req = (h) => ({ headers: { get: () => h } });
  assert.equal(cronAuthorized(req('Bearer good'), 'good'), true);
  assert.equal(cronAuthorized(req(null), 'good'), false);
  assert.equal(cronAuthorized(req('Bearer bad'), 'good'), false);
});
