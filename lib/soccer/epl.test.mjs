// lib/soccer/epl.test.mjs - the EPL sync's pure laws and THE CONTENT GATE.
//
// The gate is the test that matters: the soccer-era AI crons select from the
// database, so the only thing standing between an EPL matchweek and a bill
// nobody approved is a WHERE clause. It is pinned at every selector.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapFixtureStatus, matchweekOf, slugify, EPL_LEAGUE_API_ID, EPL_SEASON } from './epl.js';
import { contentAllowedForLeague, CONTENT_EXCLUDED_LEAGUES } from './contentGate.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

test('the league is 39 and the 2026-27 season is keyed by its opening year', () => {
  assert.equal(EPL_LEAGUE_API_ID, 39);
  assert.equal(EPL_SEASON, 2026);
});

test('fixture statuses map across the whole vocabulary; the unknown throws', () => {
  assert.equal(mapFixtureStatus('NS'), 'scheduled');
  assert.equal(mapFixtureStatus('1H'), 'live');
  assert.equal(mapFixtureStatus('HT'), 'live');
  assert.equal(mapFixtureStatus('FT'), 'final');
  assert.equal(mapFixtureStatus('AET'), 'final');
  assert.equal(mapFixtureStatus('PST'), 'postponed');
  assert.equal(mapFixtureStatus('ABD'), 'cancelled');
  assert.throws(() => mapFixtureStatus('WAT'), /unknown API-Sports status/);
});

test('the matchweek comes off the round string, and cup rounds yield null', () => {
  assert.equal(matchweekOf('Regular Season - 1'), 1);
  assert.equal(matchweekOf('Regular Season - 38'), 38);
  assert.equal(matchweekOf('Quarter-finals'), null);
  assert.equal(matchweekOf(null), null);
});

test('club slugs survive accents and punctuation', () => {
  assert.equal(slugify('Brighton & Hove Albion'), 'brighton-hove-albion');
  assert.equal(slugify('Wolverhampton Wanderers'), 'wolverhampton-wanderers');
  assert.equal(slugify('AFC Bournemouth'), 'afc-bournemouth');
});

// ---------------------------------------------------------------------------
// THE HARD RULING: no AI content cron may touch an EPL row
// ---------------------------------------------------------------------------

test('EPL is excluded from the content machine, explicitly', () => {
  assert.deepEqual(CONTENT_EXCLUDED_LEAGUES, ['epl']);
  assert.equal(contentAllowedForLeague('epl'), false);
  assert.equal(contentAllowedForLeague('fifa-wc-2026'), true, 'the WC keeps what it had');
  assert.equal(contentAllowedForLeague('nfl'), true, 'gridiron untouched');
});

test('every content selector carries the gate - gloss, odds, lineups', () => {
  for (const rel of ['lib/glossPass.js', 'lib/oddsMatches.js', 'app/api/cron/poll-lineups/route.js']) {
    const t = src(rel);
    assert.match(t, /CONTENT_EXCLUDED_SQL/, `${rel} imports the gate`);
    assert.match(t, /l\.slug <> ALL\(\$\{CONTENT_EXCLUDED_SQL\}\)/, `${rel} applies it in SQL`);
    assert.match(t, /JOIN leagues l ON l\.id = m\.league_id/, `${rel} joins to filter on`);
  }
});

test('poll-lineups wraps BOTH windows in the gate - AND/OR precedence', () => {
  const t = src('app/api/cron/poll-lineups/route.js');
  // The gate must be followed by AND (( ... ) OR ( ... )) - an unwrapped OR
  // would let every just-kicked EPL fixture through the second window.
  assert.match(t, /CONTENT_EXCLUDED_SQL\}\)\s*\n\s*AND \(\(/);
});

test('the allowlist crons never named EPL, and still do not', () => {
  const briefs = src('app/api/cron/generate-briefs/route.js');
  assert.match(briefs, /BRIEF_LEAGUE_SLUGS = \[/);
  assert.ok(!/'epl'/.test(briefs), 'briefs run a positive allowlist - EPL is simply not in it');
  // The prematch analyst and both editions are hardcoded to the WC slug.
  assert.match(src('app/api/cron/prematch-analyst/route.js'), /const WC_LEAGUE_SLUG = 'fifa-wc-2026'/);
  for (const rel of ['app/api/cron/publish-player-edition/route.js', 'app/api/cron/publish-team-edition/route.js']) {
    assert.match(src(rel), /leagueSlug: 'fifa-wc-2026'/);
  }
});

test('the fixture cron is modern-shaped and staggered off the other creators', () => {
  const route = src('app/api/cron/epl-fixtures/route.js');
  assert.match(route, /recordRun\(sql, \{/);
  assert.match(route, /await maybeAlert\(sql, \{/);
  assert.match(route, /syncEpl\(\)/);
  const crons = JSON.parse(src('vercel.json')).crons;
  const mine = crons.find((c) => c.path === '/api/cron/epl-fixtures');
  assert.equal(mine?.schedule, '25 13 * * *');
  const minutes = crons.filter((c) => /pickem-board|weekly-board|epl-fixtures/.test(c.path))
    .map((c) => c.schedule.split(' ')[0]);
  assert.deepEqual(minutes.sort(), ['23', '24', '25'], 'three creators, three minutes');
});

test('the World Cup stopped being a front door; its routes still exist', () => {
  // href values only - the comments explaining the retirement mention the
  // path, and a naive grep would fail on its own documentation.
  const hrefs = (t) => [...t.matchAll(/href[=:]\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.ok(!hrefs(src('lib/nav.js')).some((h) => h.includes('world-cup-2026')), 'no WC in the primary nav');
  assert.ok(!hrefs(src('components/SiteFooter.js')).some((h) => h.includes('world-cup-2026')), 'no WC in the footer');
  // The routes are NOT deleted - the data and any shared link keep working.
  assert.ok(readFileSync(path.join(REPO, 'app/world-cup-2026/bracket/page.js'), 'utf8').length > 0);
});
