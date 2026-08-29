// lib/stuckLiveSweep.test.mjs — the sweep learns that sports differ.
//
// THE DEFECT THIS PINS, observed in production 29 Aug: the candidate query had
// no league filter and 180 minutes is a football-match number. UNC @ TCU was
// force-finaled with 38 seconds left on the Q4 clock, 3h26m after kickoff — an
// ordinary college game. 39 NFL preseason rows went the same way, none of them
// ever asked a provider, because the poll-once-before-flip guarantee keys on
// external_ids.api_sports and no gridiron row carries that key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STUCK_LIVE_TIMEOUT_MIN, GRIDIRON_STUCK_TIMEOUT_MIN, GRIDIRON_SLUGS,
  timeoutMinFor, gridironStatusResolver,
} from './stuckLiveSweep.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const SWEEP = src('lib/stuckLiveSweep.js');

// ------------------------------------------------------- per-code timeouts

test('soccer is UNCHANGED at 180 - this file was written for it', () => {
  assert.equal(STUCK_LIVE_TIMEOUT_MIN, 180);
  assert.equal(timeoutMinFor('epl'), 180);
  assert.equal(timeoutMinFor('international-friendlies'), 180);
  assert.equal(timeoutMinFor('world-cup-2026'), 180, 'anything not gridiron keeps the old number');
  assert.equal(timeoutMinFor(undefined), 180, 'an unknown league is treated as soccer, not as gridiron');
});

test('gridiron gets 330, and the number is above the observed maximum', () => {
  assert.equal(GRIDIRON_STUCK_TIMEOUT_MIN, 330);
  assert.deepEqual([...GRIDIRON_SLUGS], ['nfl', 'cfb']);
  assert.equal(timeoutMinFor('nfl'), 330);
  assert.equal(timeoutMinFor('cfb'), 330);
  // Censused: the longest gridiron game we actually watched end was ~215min
  // (UNC @ TCU); last night's nine NFL preseason games ran 182-203min.
  assert.ok(GRIDIRON_STUCK_TIMEOUT_MIN > 215 + 60,
    'at least an hour of margin over the observed ceiling');
});

test('a 3h26m live CFB game is NOT a candidate; a 6h one is', () => {
  const cfb = timeoutMinFor('cfb');
  assert.ok(206 < cfb, '3h26m - the game that was wrongly forced - is inside the window');
  assert.ok(360 > cfb, '6h is outside it and still gets swept');
  // And the same two durations against soccer's number, unchanged.
  assert.ok(206 > timeoutMinFor('epl'), 'soccer still sweeps at 3h26m');
});

test('the timeout is applied IN THE QUERY, not filtered afterwards', () => {
  // A game inside its own window must never be enumerated as a candidate; a
  // later branch that forgets to check cannot then force it.
  const q = SWEEP.slice(SWEEP.indexOf('const candidates = await sql'), SWEEP.indexOf('const results ='));
  assert.match(q, /JOIN leagues l ON l\.id = m\.league_id/);
  assert.match(q, /CASE WHEN l\.slug = ANY\(\$\{GRIDIRON_SLUGS\}\)/);
  assert.match(q, /THEN \$\{GRIDIRON_STUCK_TIMEOUT_MIN\}/);
  assert.match(q, /ELSE \$\{STUCK_LIVE_TIMEOUT_MIN\} END/);
});

// ------------------------------------------- provider confirmation, gridiron

test('CFB: provider in_progress resolves to live, completed to final', async () => {
  const rows = [
    { id: 401856766, status: 'in_progress' },
    { id: 401864494, status: 'completed' },
    { id: 401111111, status: 'scheduled' },
  ];
  const ask = gridironStatusResolver({ fetchCfb: async () => rows });
  assert.equal(await ask('cfb', { cfbd_game_id: '401856766' }), 'live');
  assert.equal(await ask('cfb', { cfbd_game_id: '401864494' }), 'final');
  assert.equal(await ask('cfb', { cfbd_game_id: '401111111' }), null, 'scheduled is not a final');
  assert.equal(await ask('cfb', { cfbd_game_id: '999' }), null, 'absent from the payload = silent');
  assert.equal(await ask('cfb', {}), null, 'no id = silent');
});

test('ONE call per league per sweep, however many candidates', async () => {
  let calls = 0;
  const ask = gridironStatusResolver({ fetchCfb: async () => { calls += 1; return [{ id: 1, status: 'in_progress' }]; } });
  await ask('cfb', { cfbd_game_id: '1' });
  await ask('cfb', { cfbd_game_id: '1' });
  await ask('cfb', { cfbd_game_id: '1' });
  assert.equal(calls, 1, 'the slate is fetched once and cached for the sweep');
});

test('no gridiron candidate means no provider call at all', async () => {
  let calls = 0;
  const ask = gridironStatusResolver({ fetchCfb: async () => { calls += 1; return []; } });
  assert.equal(await ask('epl', { api_sports: '5' }), null);
  assert.equal(calls, 0, 'a soccer-only sweep pays nothing');
});

test('a provider that throws is a provider that is SILENT, not one that blocks', async () => {
  // Unreachable must fall back to the timer. Stranding a row live forever is
  // the failure this whole file exists to prevent.
  const ask = gridironStatusResolver({ fetchCfb: async () => { throw new Error('CFBD 502'); } });
  assert.equal(await ask('cfb', { cfbd_game_id: '401856766' }), null);
});

test('NFL resolves through apisports_game_id or bdl_game_id', async () => {
  const rows = [{ id: 21511, status: { short: 'Q3' } }, { id: 21512, status: { short: 'FT' } }];
  const ask = gridironStatusResolver({ fetchNfl: async () => rows });
  assert.equal(await ask('nfl', { apisports_game_id: '21511' }), 'live');
  assert.equal(await ask('nfl', { apisports_game_id: '21512' }), 'final');
  assert.equal(await ask('nfl', { bdl_game_id: '21511' }), 'live', 'either key resolves');
});

// ------------------------------------------------------------- the branches

test('provider-says-live SKIPS the force and says so', () => {
  const body = SWEEP.slice(SWEEP.indexOf('for (const m of candidates)'));
  const grid = body.slice(body.indexOf('if (GRIDIRON_SLUGS.includes(m.league_slug))'));
  assert.match(grid, /if \(verdict === 'live'\)/);
  assert.match(grid, /reason: 'provider_says_still_live'/);
  // It must land in wouldNotFlip, never in resolved.
  const beforeForce = grid.slice(0, grid.indexOf('await forceFinalFromLastKnown'));
  assert.match(beforeForce, /results\.wouldNotFlip\.push/);
  assert.match(beforeForce, /continue;/);
});

test('the gridiron branch runs BEFORE the api_sports branch it could never reach', () => {
  const body = SWEEP.slice(SWEEP.indexOf('for (const m of candidates)'));
  assert.ok(body.indexOf('GRIDIRON_SLUGS.includes(m.league_slug)') < body.indexOf('const apiId ='),
    'gridiron must be handled before the no_api_id fallthrough that was forcing it');
});

test('EVERY force nulls live_state - the bypass-writer gap', () => {
  const fn = SWEEP.slice(SWEEP.indexOf('async function forceFinalFromLastKnown'), SWEEP.indexOf('* THE POLL-ONCE'));
  assert.match(fn, /metadata = COALESCE\(metadata, '\{\}'::jsonb\) \|\| '\{"live_state": null\}'::jsonb/);
  assert.match(fn, /status = 'final'/);
});

test('the audit column is still written, and the log names league + timeout', () => {
  assert.match(SWEEP, /timer_forced_final_at = now\(\)/);
  assert.match(SWEEP, /\[stuck-live\] \$\{m\.league_slug\} \$\{m\.slug\}/);
  assert.match(SWEEP, /timeout \$\{timeoutMin\}min/);
});

test('the soccer path is untouched below the gridiron branch', () => {
  // Its three outcomes and the poll-once guarantee must survive verbatim.
  assert.match(SWEEP, /outcome: 'api_confirmed_final'/);
  assert.match(SWEEP, /reason: 'api_says_still_live'/);
  assert.match(SWEEP, /reason: 'breaker_tripped'/);
  assert.match(SWEEP, /await apiSports\.fixture\(apiId\)/);
  assert.match(SWEEP, /if \(err instanceof DailyCapError\)/);
});
