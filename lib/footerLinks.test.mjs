// lib/footerLinks.test.mjs - R5 removed LINKS, not ROUTES.
//
// The footer went from four headed columns to two rows, and the league pill row
// lost Wire. Every URL that left those lists must still serve: a reader holding
// an old link, a bookmark or a search result lands on the page, not a 404. The
// preview curl in the relay report checks the 200s over HTTP; this pins that
// each route still has its page file, so a later cleanup cannot quietly delete
// one on the grounds that "nothing links there".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const REMOVED = Object.freeze([
  ['/', 'app/page.js'],                         // Daily Card
  ['/nfl/fantasy', 'app/nfl/fantasy/page.js'],  // Fantasy
  ['/sim', 'app/sim/page.js'],                  // Mock Draft (the header button stays)
  ['/nfl/rankings', 'app/nfl/rankings/page.js'],
  ['/epl/standings', 'app/epl/standings/page.js'], // Premier League
  ['/schedule', 'app/schedule/page.js'],
  ['/stats', 'app/stats/page.js'],
  ['/nfl/wire', 'app/nfl/wire/page.js'],        // the Wire pill
  ['/cfb/wire', 'app/cfb/wire/page.js'],
]);

test('EVERY REMOVED LINK STILL HAS ITS ROUTE', () => {
  const missing = REMOVED.filter(([, f]) => !existsSync(path.join(REPO, f))).map(([u]) => u);
  assert.deepEqual(missing, [], `route(s) gone: ${missing.join(', ')}`);
});

test('the removed links are really gone from the footer and the pill row', () => {
  const footer = readFileSync(path.join(REPO, 'components/SiteFooter.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const label of ['Daily Card', 'Fantasy', 'Voice Bible', 'Newsletter', 'RSS', 'Premier League', '<h4>']) {
    assert.ok(!footer.includes(label), `footer still carries ${label}`);
  }
  assert.ok(footer.includes('The arcade of sports games.'));
  assert.ok(footer.includes('© 2026 Sportsvyn'));
  assert.ok(!footer.includes('Considered Network'));
  const nav = readFileSync(path.join(REPO, 'lib/gridiron/leagueNav.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.match(nav, /key: 'wire'.*pill: false/, 'the Wire pill is out of the row');
});
