// components/team/gridiron.test.mjs - gridiron team-page chrome, and the pins
// that keep soccer out of it.
//
// Every test here has a SOCCER HALF. The relay was gridiron-only, and the one
// regression this build actually produced was a soccer one - Argentina's
// breadcrumb changed from "FIFA World Cup 2026" to "2026 FIFA World Cup"
// because the fallback read the league's name from the database instead of
// returning the literal previous string.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isGridiron, breadcrumbFor, anchorPillsFor, scheduleHeadingFor,
  heightImperial, weightImperial, tagLine, groupRoster,
} from './gridiron.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

test('BREADCRUMB: gridiron gets its real league; soccer is byte-identical', () => {
  assert.deepEqual(breadcrumbFor('nfl'), { label: 'NFL', href: '/nfl' });
  assert.deepEqual(breadcrumbFor('cfb'), { label: 'CFB', href: '/cfb' });
  // THE REGRESSION PIN. Every non-gridiron league keeps the exact previous
  // string and href - no database name, no interpolation.
  for (const lg of ['fifa-wc-2026', 'international-friendlies', 'epl', null, undefined]) {
    assert.deepEqual(breadcrumbFor(lg),
      { label: 'FIFA World Cup 2026', href: '/world-cup-2026/bracket' },
      `${lg} must keep the original crumb`);
  }
});

test('PILLS: gridiron renders only sections that exist; soccer keeps all seven', () => {
  for (const lg of ['nfl', 'cfb']) {
    const p = anchorPillsFor(lg).map((x) => x.href);
    assert.deepEqual(p, ['#matches', '#squad', '#schedule', '#articles']);
    // The four dead ones must be ABSENT, not merely unlinked.
    for (const dead of ['#stats', '#players', '#trajectory']) {
      assert.ok(!p.includes(dead), `${dead} must not appear for ${lg}`);
    }
  }
  const soccer = anchorPillsFor('fifa-wc-2026').map((x) => x.label);
  assert.deepEqual(soccer, ['Recent + Next', 'Team Stats', 'Top Players', 'Squad',
    'Trajectory', 'Schedule', 'Articles']);
});

test('SCHEDULE HEADING: a season is not a tournament, and soccer still is one', () => {
  assert.deepEqual(scheduleHeadingFor('nfl', 2026), { lead: '2026', accent: 'Season' });
  assert.deepEqual(scheduleHeadingFor('cfb', 2025), { lead: '2025', accent: 'Season' });
  assert.deepEqual(scheduleHeadingFor('nfl', null), { lead: '', accent: 'Season' },
    'no year, no invented year');
});

test('SOCCER PASSES NO HEADING AT ALL - the regression a text check missed', () => {
  // Returning the literal 'Full Tournament' rendered the identical words while
  // silently dropping <span class="accent"> from around "Tournament", because a
  // truthy heading skips Schedule's fallback. Only a MARKUP diff caught it, so
  // the pin is on the markup.
  for (const lg of ['fifa-wc-2026', 'international-friendlies', null, undefined]) {
    assert.equal(scheduleHeadingFor(lg, 2026), null, `${lg} must not pass a heading`);
  }
  const sched = src('components/team/Schedule.js')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  // The soccer branch is the original line, accent span intact.
  assert.match(sched, /: <h2 className="section-head-title">Full <span className="accent">Tournament<\/span><\/h2>/);
  // And the gridiron branch accents its tail the way every other head does.
  assert.match(sched, /heading\.lead[\s\S]*?<span className="accent">\{heading\.accent\}<\/span>/);
});

test('every section head on this page accents its tail', () => {
  // Power Ranking / Over Time, Tournament / to Date, Top / Performers, The / 95.
  // A flat gridiron heading would have been the only unaccented one.
  for (const f of ['components/team/Trajectory.js', 'components/team/TeamStatsGrid.js',
                   'components/team/TopPlayers.js', 'components/team/GridironRoster.js']) {
    assert.match(src(f), /section-head-title"[\s\S]{0,120}?<span className="accent">/, f);
  }
});

test('HT/WT convert from stored metric to US display', () => {
  // Real stored values from the import.
  assert.equal(heightImperial(193), "6'4\"");
  assert.equal(heightImperial(183), "6'0\"");
  assert.equal(heightImperial(178), "5'10\"");
  assert.equal(weightImperial(102.06), '225');
  assert.equal(weightImperial(86.18), '190');
  // Null in, null out - never a 0'0" or a 0 lb player.
  assert.equal(heightImperial(null), null);
  assert.equal(weightImperial(null), null);
  assert.equal(heightImperial(0), null);
});

test('TAG LINE omits college when absent - CFB rows are thinner by design', () => {
  // BDL carries college; CFBD does not, because for a college player the team
  // IS the college. No dangling separator either way.
  assert.equal(tagLine({ position: 'QB', college: 'Texas Tech', experienceYears: 9 }),
    'QB · Texas Tech · yr9');
  assert.equal(tagLine({ position: 'LS', college: null, experienceYears: 3 }), 'LS · yr3');
  assert.equal(tagLine({ position: 'K', college: null, experienceYears: null }), 'K');
});

test('ROSTER GROUPS match the real stored position_group values', () => {
  // Stored across 29,721 gridiron players: OFF 14,601 / DEF 13,527 / ST 1,214 /
  // null 379. Nothing invented.
  const roster = [
    { slug: 'a', full_name: 'A', position_group: 'OFF', current_team_jersey_number: 15 },
    { slug: 'b', full_name: 'B', position_group: 'DEF', current_team_jersey_number: 5 },
    { slug: 'c', full_name: 'C', position_group: 'ST', current_team_jersey_number: 7 },
    { slug: 'd', full_name: 'D', position_group: 'OFF', current_team_jersey_number: 3 },
  ];
  const g = groupRoster(roster);
  assert.deepEqual(g.map((x) => x.label), ['Offense', 'Defense', 'Special Teams']);
  assert.deepEqual(g[0].members.map((m) => m.current_team_jersey_number), [3, 15], 'jersey order');
  assert.equal(g[0].count, 2);
});

test('UNLISTED appears only when THAT team has one - not league-wide', () => {
  // All 379 null-position players are CFB; zero NFL teams have any. An
  // unconditional group would have put an empty "Unlisted" header on all 32
  // NFL team pages, and the mock's "379 league-wide" label would have been a
  // lie on every one of them.
  const noneUnlisted = [{ slug: 'a', full_name: 'A', position_group: 'OFF' }];
  assert.ok(!groupRoster(noneUnlisted).some((g) => g.key === null));

  const someUnlisted = [
    { slug: 'a', full_name: 'A', position_group: 'OFF' },
    { slug: 'b', full_name: 'B', position_group: null },
    { slug: 'c', full_name: 'C', position_group: null },
  ];
  const g = groupRoster(someUnlisted).find((x) => x.key === null);
  assert.equal(g.label, 'Unlisted');
  assert.equal(g.count, 2, "this team's own count, not 379");
});

test('roster rows LINK to the player page - the inversion', () => {
  // This test used to pin ZERO links, because there was no gridiron player page
  // and a link would have been a promise to a 404. /player/[slug] now renders
  // one, so the pin inverts: every row must carry the link. Same promise, after
  // rather than before.
  const c = src('components/team/GridironRoster.js')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(c, /<a className="gr-row" href=\{`\/player\/\$\{p\.slug\}`\}>/);
  assert.doesNotMatch(c, /<div className="gr-row">/);
  // Soccer's squad keeps its own links, unchanged.
  assert.match(src('components/team/SquadList.js'), /href=\{`\/player\/\$\{player\.slug\}`\}/);
});

test('the roster reuses numcols rather than a second column system', () => {
  const c = src('components/team/GridironRoster.js');
  for (const cls of ['nrail', 'ndeck', 'nline1', 'nline2', 'ncols', 'ncol']) {
    assert.match(c, new RegExp(`"[^"]*\\b${cls}\\b`), `${cls} must be reused`);
  }
});

test('the four gridiron-absent sections do not render for gridiron', () => {
  const page = src('app/team/[slug]/page.js').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  for (const comp of ['TeamStatsGrid', 'TopPlayers', 'Trajectory']) {
    assert.match(page, new RegExp(`\\{!gridiron && <${comp}`), `${comp} must be gated`);
  }
  assert.match(page, /gridiron\s*\n?\s*\? <GridironRoster players=\{squad\} \/>/);
});
