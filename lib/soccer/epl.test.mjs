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
import * as navMod from '../gridiron/scoresNav.js';

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

test('every MODEL-SPEND selector carries the content gate - gloss, odds', () => {
  // poll-lineups left this list deliberately: an XI fetch spends a provider
  // request, not a model call, and the gate is a spend ruling.
  for (const rel of ['lib/glossPass.js', 'lib/oddsMatches.js']) {
    const t = src(rel);
    assert.match(t, /CONTENT_EXCLUDED_SQL/, `${rel} imports the gate`);
    assert.match(t, /l\.slug <> ALL\(\$\{CONTENT_EXCLUDED_SQL\}\)/, `${rel} applies it in SQL`);
    assert.match(t, /JOIN leagues l ON l\.id = m\.league_id/, `${rel} joins to filter on`);
  }
  // And the ruling itself is unchanged where it belongs.
  assert.deepEqual(CONTENT_EXCLUDED_LEAGUES, ['epl']);
});

test('the two lists name the real distinction: model spend vs provider fetch', async () => {
  const { POLL_EXCLUDED_LEAGUES } = await import('./contentGate.js');
  assert.deepEqual(POLL_EXCLUDED_LEAGUES, [], 'a fetch is not a spend decision');
  const t = src('app/api/cron/poll-lineups/route.js');
  assert.match(t, /POLL_EXCLUDED_SQL/, 'lineups reads the poll list');
  assert.ok(!/CONTENT_EXCLUDED_SQL/.test(t), 'and no longer the content list');
});

test('poll-lineups wraps BOTH windows in the gate - AND/OR precedence SURVIVES', () => {
  const t = src('app/api/cron/poll-lineups/route.js');
  // The precedence fix outlives the ungating: the gate position must still be
  // followed by AND (( ... ) OR ( ... )), or a future re-gate silently covers
  // window (A) only.
  assert.match(t, /POLL_EXCLUDED_SQL\}::text\[\]\)\s*\n\s*AND \(\(/);
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

// ---------------------------------------------------------------------------
// RELAY 2: live_state, the chip, the soccer card, the table
// ---------------------------------------------------------------------------

const { soccerLiveChip, soccerLiveState } = await import('./liveChip.js');
const { toStandingRow, railFor } = await import('./standings.js');

test('the soccer chip counts UP, with stoppage added on', () => {
  assert.equal(soccerLiveChip({ elapsed: 67, extra: null, period: '2H' }), "67'");
  assert.equal(soccerLiveChip({ elapsed: 90, extra: 4, period: '2H' }), "90+4'");
  assert.equal(soccerLiveChip({ elapsed: 45, extra: 2, period: '1H' }), "45+2'");
  assert.equal(soccerLiveChip({ elapsed: 12, extra: 0, period: '1H' }), "12'", 'zero stoppage is no stoppage');
  assert.equal(soccerLiveChip({ elapsed: 45, extra: null, period: 'HT' }), 'HT');
  assert.equal(soccerLiveChip({ elapsed: 120, extra: null, period: 'P' }), 'PENS');
  assert.equal(soccerLiveChip(null), null);
});

test('live_state is null whenever the match is not live', () => {
  const st = { elapsed: 67, extra: null, short: '2H' };
  assert.deepEqual(soccerLiveState('live', st), { elapsed: 67, extra: null, period: '2H' });
  assert.equal(soccerLiveState('final', st), null, 'a stale clock never outlives its match');
  assert.equal(soccerLiveState('scheduled', st), null);
});

test('the poller writes live_state flat, merge-safe', () => {
  const t = src('lib/syncFixture.js');
  assert.match(t, /soccerLiveState\(status, f\.fixture\.status\)/);
  assert.match(t, /metadata = COALESCE\(matches\.metadata, '\{\}'::jsonb\)\s*\n?\s*\|\| \$\{JSON\.stringify\(\{ live_state: liveState \}\)\}::jsonb/);
});

test('A DRAW DIMS NOBODY - the soccer card refuses the winner/loser law', () => {
  const t = src('components/gridiron/Scoreboard.js');
  const card = t.slice(t.indexOf('function SoccerCard'), t.indexOf('function Section'));
  assert.match(card, /const lost = final && !draw &&/, 'a draw can never mark a loser');
  assert.match(card, /const draw = \(final \|\| live\) && g\.homeScore != null && g\.homeScore === g\.awayScore/);
  assert.ok(!/lineScoreGrid|gi-ls/.test(card), 'no line score on a game with no quarters');
  assert.match(card, /soccerLiveChip\(g\.liveState\)/, 'the minute comes from the one formatter');
});

test('THE GRIDIRON CARD IS UNTOUCHED - its instruments all still render', () => {
  const t = src('components/gridiron/Scoreboard.js');
  // The Card RENDERS <LineScore>; the grid derivation lives in that helper
  // above it, so the marker to look for in Card's own body is the component.
  const card = t.slice(t.indexOf('function Card({ g })'), t.indexOf('function SoccerCard'));
  // Card mounts its instruments through two helpers - LineScore (the quarter
  // grid) and PreGamePane (facts + the odds strip) - so those are the markers
  // in its own body; the helpers' internals are asserted separately below.
  for (const marker of ['<LineScore', '<PreGamePane', 'PhaseBadge', 'gi-card-body', 'Full game →']) {
    assert.ok(card.includes(marker), `the gridiron card kept ${marker}`);
  }
  assert.match(t, /const grid = lineScoreGrid\(g\)/, 'the grid derivation is still wired');
  assert.match(t, /<OddsStrip odds=\{g\.odds\} \/>/, 'the odds strip is still wired');
  // DriveStrip lives in the shell's dormant demo block, not the card - it is
  // still mounted and still waiting on live drive rows.
  assert.match(t, /<DriveStrip yardsToEndzone=/);
  // and the per-sport pick is a lookup, not a rewrite of the gridiron path
  assert.match(t, /const CardFor = sport\.key === 'epl' \? SoccerCard : Card/);
});

test('the sport filter round-trips through epl, and junk still falls to all', () => {
  const { parseScoresParams, scoresHref, SPORT_KEYS } = navMod;
  assert.deepEqual(SPORT_KEYS, ['nfl', 'cfb', 'epl']);
  for (const s of ['nfl', 'cfb', 'epl']) {
    const href = scoresHref('2026-08-23', { sport: s });
    const sp = Object.fromEntries(new URL(`https://x${href}`).searchParams);
    assert.equal(parseScoresParams(sp).sport, s, `${s} survives the round trip`);
  }
  assert.equal(parseScoresParams({ sport: 'mls' }).sport, 'all', 'an unknown league is not a filter');
  assert.equal(scoresHref('2026-08-23', { sport: 'all' }), '/scores?date=2026-08-23', 'default omitted');
});

test('the standings row maps the provider, and the rail reads its prose', () => {
  const r = toStandingRow({
    rank: 1, team: { id: 51, name: 'Brighton' }, points: 3, goalsDiff: 4, form: 'W',
    description: 'Promotion - Champions League (League phase)',
    all: { played: 1, win: 1, draw: 0, lose: 0, goals: { for: 4, against: 0 } },
  });
  assert.deepEqual(r, {
    rank: 1, teamId: 51, team: 'Brighton', played: 1, win: 1, draw: 0, lose: 0,
    goalsFor: 4, goalsAgainst: 0, goalsDiff: 4, points: 3, form: 'W',
    note: 'Promotion - Champions League (League phase)',
  });
  assert.equal(railFor('Promotion - Champions League (League phase)'), 'ucl');
  assert.equal(railFor('Promotion - Europa League (League phase)'), 'uel');
  assert.equal(railFor('Relegation - Championship'), 'drop');
  assert.equal(railFor(null), null);
  assert.equal(railFor('Mid-table obscurity'), null);
});

test('the standings cron is modern-shaped and takes the fourth minute', () => {
  const route = src('app/api/cron/epl-standings/route.js');
  assert.match(route, /recordRun\(sql, \{/);
  assert.match(route, /await maybeAlert\(sql, \{/);
  assert.match(route, /syncEplStandings\(\)/);
  const crons = JSON.parse(src('vercel.json')).crons;
  assert.equal(crons.find((c) => c.path === '/api/cron/epl-standings')?.schedule, '26 13 * * *');
});

test('the table keeps the numcols discipline on every number column', () => {
  const css = src('app/epl/standings/standings.css');
  for (const rule of [/\.ep-rank \{[^}]*width: 3ch/, /\.ep-n \{[^}]*width: 3ch/, /\.ep-n\.wide \{ width: 4ch/, /\.ep-n\.pts \{ width: 4ch/]) {
    assert.match(css, rule);
  }
  // Both number families (rank, the P/W/D/L/GF/GA/GD/PTS cells) are tabular.
  assert.equal((css.match(/font-variant-numeric: tabular-nums/g) ?? []).length, 2);
});

// ---------------------------------------------------------------------------
// SOCCER CARD DENSITY PASS - parity with gridiron, soccer's own markup
// ---------------------------------------------------------------------------

test('the club code comes from the REAL field, not a new derivation', () => {
  const t = src('components/gridiron/Scoreboard.js');
  const card = t.slice(t.indexOf('function SoccerCard'), t.indexOf('function Section'));
  assert.match(card, /<span className="abbr">\{t\?\.abbreviation \?\? ''\}<\/span>/,
    'teams.abbreviation, the same field the match-center header uses');
  assert.ok(!/slice\(0, 3\)|toUpperCase\(\)/.test(card), 'no ad-hoc code derivation in the card');
});

test('the meta line carries league + matchweek and venue, from the DTO', () => {
  const t = src('components/gridiron/Scoreboard.js');
  const card = t.slice(t.indexOf('function SoccerCard'), t.indexOf('function Section'));
  assert.match(card, /\[g\.leagueName, g\.week != null \? `Matchweek \$\{g\.week\}` : null\]/);
  assert.match(card, /className="gi-soccer-meta"/);
  assert.match(card, /className="venue">\{g\.venue\}/);
  // The reader must actually supply both, or the row renders half-empty.
  const rd = src('lib/gridiron/readers.js');
  assert.match(rd, /leagueName: r\.league_name \?\? null/);
  assert.match(rd, /venue: meta\.venue \?\? r\.venue \?\? null/,
    'EPL writes the venue COLUMN, gridiron writes metadata - both must resolve');
  assert.match(rd, /l\.name AS league_name/);
  assert.match(rd, /m\.metadata, m\.venue/);
});

test('THE NO-EXPAND LAW STANDS - a soccer card has nothing to open', () => {
  const t = src('components/gridiron/Scoreboard.js');
  const card = t.slice(t.indexOf('function SoccerCard'), t.indexOf('function Section'));
  for (const forbidden of ['gi-card-body', 'gi-chev', 'lineScoreGrid', '<LineScore', 'useState']) {
    assert.ok(!card.includes(forbidden), `the soccer card must not carry ${forbidden}`);
  }
});

test('the minute chip renders in THE CARD, not only the match page', () => {
  const t = src('components/gridiron/Scoreboard.js');
  const card = t.slice(t.indexOf('function SoccerCard'), t.indexOf('function Section'));
  assert.match(card, /const chip = live \? soccerLiveChip\(g\.liveState\) : null/);
  assert.match(card, /\{chip && <span className="gi-qc">\{chip\}<\/span>\}/);
  assert.match(card, /<span className="gi-final">FT<\/span>/, 'and FT for finals');
});

test('THE GRIDIRON CARD IS UNTOUCHED by the density pass', () => {
  const t = src('components/gridiron/Scoreboard.js');
  const card = t.slice(t.indexOf('function Card({ g })'), t.indexOf('function SoccerCard'));
  for (const marker of ['<LineScore', '<PreGamePane', 'PhaseBadge', 'gi-card-body', 'gi-chev']) {
    assert.ok(card.includes(marker), `the gridiron card kept ${marker}`);
  }
  assert.ok(!card.includes('gi-soccer-meta'), 'and gained none of soccer\'s markup');
});
