// lib/gridiron/leagueNav.test.mjs — one destination list, one resolver.
// Run: node --test lib/gridiron/leagueNav.test.mjs
//
// THE BUG THIS FILE EXISTS FOR ALREADY HAPPENED. The sub-nav's destinations
// were hand-written in four places and drifted: the rankings hub offered three
// doors, the CFB landing four, the NFL landing five. A reader who tapped
// Rankings could not reach Standings from where they landed. Nothing caught it
// because each list was locally consistent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAGUE_NAV, currentNavKey, navPills } from './leagueNav.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (r) => readFileSync(path.join(REPO, r), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('ONE DESTINATION LIST - no surface writes its own', () => {
  // The four that used to: two landings, two standings routes. Plus the hub,
  // which hardcoded a <nav> inline.
  for (const f of ['app/nfl/page.js', 'app/cfb/page.js',
                   'app/nfl/standings/page.js', 'app/cfb/standings/page.js',
                   'components/gridiron/RankingsHub.js', 'components/gridiron/TodayPage.js',
                   'components/standings/StandingsPage.js']) {
    const code = strip(src(f));
    assert.doesNotMatch(code, /_TABS = \[|const TABS = \[/, `${f} must not keep its own tab list`);
    assert.doesNotMatch(code, /gi-subnav/, `${f} must not render the retired sub-nav`);
  }
  // and the pills read the one list
  assert.match(strip(src('components/league/LeagueHeader.js')), /navPills\(leagueSlug, pathname\)/);
});

test('EVERY LISTED ROUTE ACTUALLY EXISTS - a pill is a door, not a promise', () => {
  // "Pills whose route does not exist for a league are absent, not disabled."
  // This is the rule enforced against the filesystem, so a pill can never point
  // at a 404.
  for (const item of LEAGUE_NAV) {
    for (const lg of item.leagues) {
      const href = item.href(lg);
      const file = path.join(REPO, 'app', href.replace(/^\//, ''), 'page.js');
      assert.ok(existsSync(file), `${href} has a pill but no route (${item.key}/${lg})`);
    }
  }
});

test('THE PER-LEAGUE PILL SET', () => {
  const nfl = navPills('nfl', '/nfl').map((p) => p.label);
  const cfb = navPills('cfb', '/cfb').map((p) => p.label);
  assert.deepEqual(nfl, ['Scores', 'Rankings', 'Standings', 'Market', 'Fantasy', 'Stats']);
  assert.deepEqual(cfb, ['Scores', 'Rankings', 'Standings', 'Market', 'Stats']);
  // FANTASY IS NFL-ONLY, and that is data on the entry rather than a branch.
  assert.equal(cfb.includes('Fantasy'), false, 'there is no /cfb/fantasy route');
  // READS IS ON NEITHER. The mock draws it, but no /nfl/reads or /cfb/reads
  // route exists, and the rule is absent-not-disabled. It joins the day the
  // route does - which is what the existence test above will then require.
  assert.equal(nfl.includes('Reads'), false);
  assert.equal(cfb.includes('Reads'), false);
});

test('THE RESOLVER MAPS EACH ROUTE TO EXACTLY ONE FILLED PILL, OR NONE', () => {
  const cases = [
    ['nfl', '/nfl', null], ['cfb', '/cfb', null],           // the landing fills none
    ['nfl', '/scores', 'scores'], ['cfb', '/scores', 'scores'],
    ['nfl', '/nfl/rankings', 'rankings'], ['cfb', '/cfb/rankings', 'rankings'],
    ['nfl', '/nfl/standings', 'standings'], ['cfb', '/cfb/standings', 'standings'],
    ['nfl', '/market', 'market'], ['cfb', '/market', 'market'],
    ['nfl', '/nfl/fantasy', 'fantasy'],
    ['nfl', '/stats', 'stats'], ['cfb', '/stats', 'stats'],
  ];
  for (const [lg, route, expected] of cases) {
    assert.equal(currentNavKey(route, lg), expected, `${lg} ${route}`);
    const filled = navPills(lg, route).filter((p) => p.current);
    assert.equal(filled.length, expected ? 1 : 0, `${lg} ${route} must fill ${expected ? 'one' : 'no'} pill`);
    if (expected) assert.equal(filled[0].key, expected);
  }
});

test('THE LANDING FILLS NO PILL - the title is already Today', () => {
  for (const lg of ['nfl', 'cfb']) {
    assert.equal(navPills(lg, `/${lg}`).some((p) => p.current), false);
  }
});

test('query strings and trailing slashes resolve the same route', () => {
  assert.equal(currentNavKey('/cfb/standings?division=fcs', 'cfb'), 'standings');
  assert.equal(currentNavKey('/nfl/standings/', 'nfl'), 'standings');
  assert.equal(currentNavKey('/nfl/rankings?tab=power', 'nfl'), 'rankings');
  // A sub-route of a destination still lights that destination.
  assert.equal(currentNavKey('/nfl/fantasy/anything', 'nfl'), 'fantasy');
  // A page outside the set lights nothing rather than guessing.
  assert.equal(currentNavKey('/nfl/game/some-slug', 'nfl'), null);
  assert.equal(currentNavKey('/', 'nfl'), null);
});

test('SCORES IS OUTLINED ONLY WHEN IT IS NOT THE CURRENT PAGE', () => {
  const away = navPills('nfl', '/nfl/standings').find((p) => p.key === 'scores');
  assert.equal(away.outlined, true, 'the most-tapped door wears the outline');
  assert.equal(away.current, false);
  const here = navPills('nfl', '/scores').find((p) => p.key === 'scores');
  assert.equal(here.current, true);
  assert.equal(here.outlined, false, 'on /scores it is filled like any current pill');
});

test('NO PILL IS EVER BOTH OUTLINED AND FILLED', () => {
  // The mock draws the outline with :first-child, which would put both states
  // on Scores while standing on /scores. The resolver decides instead.
  const routes = ['/nfl', '/scores', '/nfl/rankings', '/nfl/standings', '/market',
                  '/nfl/fantasy', '/stats', '/cfb', '/cfb/rankings', '/cfb/standings'];
  for (const lg of ['nfl', 'cfb']) {
    for (const r of routes) {
      for (const p of navPills(lg, r)) {
        assert.equal(p.current && p.outlined, false, `${lg} ${r} ${p.key} wears two states`);
      }
    }
    // and never more than one outline
    for (const r of routes) {
      assert.ok(navPills(lg, r).filter((p) => p.outlined).length <= 1);
    }
  }
});

test('the three states are three CSS rules, and only .on inverts', () => {
  const css = src('components/league/league.css');
  const on = css.slice(css.indexOf('.lgn-p.on {'), css.indexOf('}', css.indexOf('.lgn-p.on {')) + 1);
  const out = css.slice(css.indexOf('.lgn-p.out {'), css.indexOf('}', css.indexOf('.lgn-p.out {')) + 1);
  assert.match(on, /background: var\(--volt\)/);
  assert.match(on, /color: var\(--ink\)/);
  assert.match(out, /border-color: var\(--volt\)/);
  assert.doesNotMatch(out, /background: var\(--volt\)/, 'the outline must not fill');
  // No :first-child rule - the outline is decided in the resolver.
  assert.doesNotMatch(css.slice(css.indexOf('.lgn {')), /first-child/);
});

test('.gi-subnav IS DELETED, not dormant', () => {
  const css = src('components/gridiron/gridiron.css');
  assert.doesNotMatch(strip(css), /\.gi-subnav|\.gi-season/);
  assert.match(css, /gi-subnav \/ \.gi-season DELETED/, 'and the deletion is explained where it stood');
});

test('THE LEAGUE HEADER IS ON LEAGUE SURFACES ONLY', () => {
  // RULED: /nfl/fantasy is an NFL page and carries the league's destinations.
  // /scores, /market and /stats are NETWORK surfaces - they serve both codes at
  // once, so a header titled with one league would be a lie about what the page
  // is. They get no league header, and their pill is reachable from every
  // league page instead.
  assert.match(strip(src('app/nfl/fantasy/page.js')), /<LeagueHeader[^>]*leagueSlug="nfl"/s);
  assert.match(strip(src('app/nfl/fantasy/page.js')), /pathname="\/nfl\/fantasy"/);
  for (const f of ['app/scores/page.js', 'app/market/page.js', 'app/stats/page.js']) {
    assert.doesNotMatch(strip(src(f)), /<LeagueHeader/, `${f} serves both codes; it takes no league header`);
  }
});
