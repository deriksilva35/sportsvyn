// lib/gridiron/leagueSwitch.test.mjs — the switcher's resolver and its sheet.
// Run: node --test lib/gridiron/leagueSwitch.test.mjs
//
// THE RESOLVER IS THE WHOLE FEATURE. A switcher that always dropped you at the
// front door would make comparing two codes on the same surface a four-tap
// round trip, and that comparison is the only reason anyone opens this control.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { switchTo, switcherRows, SWITCHER_LEAGUES } from './leagueSwitch.js';
import { LEAGUE_NAV } from './leagueNav.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (r) => readFileSync(path.join(REPO, r), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('EVERY LEAGUE ROUTE x EVERY TARGET, the whole table', () => {
  const T = [
    // from                     nfl                cfb                epl
    ['/nfl',        'nfl', '/nfl',            '/cfb',            '/epl'],
    ['/nfl/scores', 'nfl', '/nfl/scores',     '/cfb/scores',     '/epl'],
    ['/nfl/wire',   'nfl', '/nfl/wire',       '/cfb/wire',       '/epl'],
    ['/nfl/standings', 'nfl', '/nfl/standings', '/cfb/standings', '/epl'],
    ['/nfl/rankings',  'nfl', '/nfl/rankings',  '/cfb/rankings',  '/epl'],
    ['/nfl/market',    'nfl', '/nfl/market',    '/cfb/market',    '/epl'],
    // FANTASY HAS NO COUNTERPART: the landing, not a 404 and not a dead row.
    ['/nfl/fantasy',   'nfl', '/nfl/fantasy',   '/cfb',           '/epl'],
    ['/cfb',        'cfb', '/nfl',            '/cfb',            '/epl'],
    ['/cfb/scores', 'cfb', '/nfl/scores',     '/cfb/scores',     '/epl'],
    ['/cfb/wire',   'cfb', '/nfl/wire',       '/cfb/wire',       '/epl'],
    ['/cfb/standings', 'cfb', '/nfl/standings', '/cfb/standings', '/epl'],
    ['/cfb/rankings',  'cfb', '/nfl/rankings',  '/cfb/rankings',  '/epl'],
    ['/cfb/market',    'cfb', '/nfl/market',    '/cfb/market',    '/epl'],
    // Outside the nav set entirely - a game page - is the landing.
    ['/nfl/game/some-slug', 'nfl', '/nfl',      '/cfb',           '/epl'],
  ];
  for (const [from, league, wantNfl, wantCfb, wantEpl] of T) {
    assert.equal(switchTo(from, league, 'nfl'), wantNfl, `${from} -> nfl`);
    assert.equal(switchTo(from, league, 'cfb'), wantCfb, `${from} -> cfb`);
    assert.equal(switchTo(from, league, 'epl'), wantEpl, `${from} -> epl`);
  }
});

test('SOCCER ALWAYS LANDS ON /epl - it is not a gridiron league', () => {
  // It has its own surfaces with their own grammar; there is no /epl/wire to
  // preserve a section into. Declared on the row rather than discovered by the
  // resolver failing to match.
  const epl = SWITCHER_LEAGUES.find((l) => l.slug === 'epl');
  assert.equal(epl.standalone, true);
  for (const p of ['/nfl', '/nfl/wire', '/cfb/standings', '/cfb/market']) {
    assert.equal(switchTo(p, p.startsWith('/nfl') ? 'nfl' : 'cfb', 'epl'), '/epl');
  }
});

test('the resolver reads the NAV\'s section, not a second path parser', () => {
  // One answer to "which section is this", shared with the pills. A second
  // parser is how /nfl/scores and the Scores pill would come to disagree.
  const code = strip(src('lib/gridiron/leagueSwitch.js'));
  assert.match(code, /currentNavKey\(pathname, from\)/);
  assert.match(code, /LEAGUE_NAV\.find/);
  assert.doesNotMatch(code, /split\('\/'\)|pathname\.replace/, 'no hand parsing');
});

test('a section the target lacks falls to its landing, always a real route', () => {
  for (const item of LEAGUE_NAV) {
    for (const target of ['nfl', 'cfb']) {
      const from = item.leagues.includes('nfl') ? item.href('nfl') : '/nfl';
      const to = switchTo(from, 'nfl', target);
      // Whatever comes back must be a route this league actually has.
      const known = to === `/${target}`
        || LEAGUE_NAV.some((i) => i.leagues.includes(target) && i.href(target) === to);
      assert.ok(known, `${from} -> ${target} produced ${to}`);
    }
  }
});

test('the rows carry the current league and its way home', () => {
  const rows = switcherRows('/nfl/standings', 'nfl');
  assert.deepEqual(rows.map((r) => r.label), ['NFL', 'CFB', 'SOCCER']);
  const cur = rows.find((r) => r.current);
  assert.equal(cur.slug, 'nfl');
  // THE WAY HOME MOVED INSIDE THE SHEET. From a sub-page the current row is the
  // one-tap route back to the landing, which is what the title used to do.
  assert.equal(cur.href, '/nfl/standings', 'from a sub-page the current row holds the section');
  assert.equal(switcherRows('/nfl', 'nfl').find((r) => r.current).href, '/nfl');
});

// -------------------------------------------------------------- the sheet

test('THE SHEET SHIPS NO MARKUP UNTIL IT IS OPENED', () => {
  // Everything but the trigger is behind the open state, so a reader who never
  // taps the title pays for a button and a chevron.
  const c = strip(src('components/league/LeagueSwitcher.js'));
  assert.match(c, /\{open \? \(/);
  const closed = c.slice(0, c.indexOf('{open ? ('));
  for (const only in { 'lsw-sheet': 1, 'lsw-back': 1, 'lsw-row': 1, 'role="dialog"': 1 }) {
    assert.equal(closed.includes(only), false, `${only} must not render closed`);
  }
});

test('DIALOG SEMANTICS, FOCUS TRAP, ESC - all four', () => {
  const c = strip(src('components/league/LeagueSwitcher.js'));
  assert.match(c, /role="dialog"/);
  assert.match(c, /aria-modal="true"/);
  assert.match(c, /aria-haspopup="dialog"/);
  assert.match(c, /aria-expanded=\{open\}/);
  assert.match(c, /e\.key === 'Escape'/);
  assert.match(c, /triggerRef\.current\?\.focus\(\)/, 'focus returns to the trigger');
  assert.match(c, /e\.key !== 'Tab'/, 'and the tab order is trapped');
  // The backdrop is a real button, so tap-out is reachable by keyboard too.
  assert.match(c, /className="lsw-back" aria-label="Close league switcher"/);
});

test('THE TITLE IS ONE TAP TARGET, not a split hitbox', () => {
  const h = strip(src('components/league/LeagueHeader.js'));
  // The old anchor is gone; the trigger wraps the title and the chevron.
  assert.doesNotMatch(h, /<a className="lgh-h1"/);
  assert.match(h, /<LeagueSwitcher label=\{label\} rows=\{rows\}/);
  const c = strip(src('components/league/LeagueSwitcher.js'));
  assert.match(c, /<span className="lgh-h1">\{label\}<\/span>/, 'the title keeps its type inside the button');
});

test('the rows are resolved on the SERVER, eyebrows caught one by one', () => {
  const h = strip(src('components/league/LeagueHeader.js'));
  assert.match(h, /switcherRows\(pathname, leagueSlug\)/);
  assert.match(h, /resolveEplWeek\(\)/, 'soccer reads a matchweek, not a gridiron week');
  assert.match(h, /catch \{ return null; \}/, 'one league failing must not close the sheet');
  const c = strip(src('components/league/LeagueSwitcher.js'));
  assert.doesNotMatch(c, /\bsql`|resolveLeagueWeek/, 'the client component reads nothing');
});
