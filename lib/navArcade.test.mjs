// lib/navArcade.test.mjs - the arcade header's nav and the homepage per theme (tue-3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NAV, ARCADE_NAV, navFor, resolveActive } from './nav.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

test('the arcade nav is exactly Play · Scores · Market · Rankings · Leagues, with the footer\'s hrefs', () => {
  assert.deepEqual(ARCADE_NAV.map((n) => [n.label, n.href]), [
    ['PLAY', '/games'], ['SCORES', '/scores'], ['MARKET', '/market'], ['RANKINGS', '/rankings'], ['LEAGUES', '/leagues'],
  ]);
  const labels = ARCADE_NAV.map((n) => n.label);
  for (const gone of ['TODAY', 'GAMES', 'NFL', 'CFB', 'SOCCER']) assert.ok(!labels.includes(gone), gone);
  assert.ok(!ARCADE_NAV.some((n) => n.href === '/today'), '/today is linked from no nav');
});

test('which tab lights: Play for the lobby and the Daily, none for a league page; the dark header is untouched', () => {
  assert.equal(navFor(true, 'games').active, 'play');
  assert.equal(navFor(true, 'daily').active, 'play');
  assert.equal(navFor(true, 'scores').active, 'scores');
  assert.equal(navFor(true, 'market').active, 'market');
  assert.equal(navFor(true, 'home').active, null, '/today (the unlinked front page) lights no tab');
  assert.equal(navFor(true, 'nfl').active, null, 'a league page keeps its own pill row');
  assert.deepEqual(navFor(false, 'nfl'), { items: NAV, active: resolveActive('nfl') }, 'dark: the old nav, the old rule');
  assert.equal(navFor(false, 'x').items, NAV);
});

test('every header gets the flag from the server; the client component never reads it', () => {
  assert.match(src('components/GlobalHeader.js'), /const \{ items: NAV, active \} = navFor\(arcade, activeNav\);/);
  assert.doesNotMatch(code(src('components/GlobalHeader.js')), /arcadeOn|process\.env/);
  assert.match(src('components/GlobalHeaderServer.js'), /arcade=\{arcadeOn\(\)\}/);
  assert.match(src('app/market/page.js'), /<GlobalHeaderClient activeNav="market" arcade=\{arcadeOn\(\)\} \/>/);
  assert.match(src('app/not-found.js'), /<GlobalHeaderClient arcade=\{arcadeOn\(\)\} \/>/);
});

test('/ under arcade is the Games lobby (signed-out included); dark / is the front page, unchanged; /today is the front page', () => {
  const page = code(src('app/page.js'));
  const home = page.slice(page.indexOf('export default async function HomePage'));
  assert.match(home, /if \(!arcadeFor\(isShell\)\) return <FrontPage \/>;/, 'dark: the front page, as before');
  assert.ok(home.indexOf('requireSignInInShell({ isShell, userId, dest: \'/\' })') < home.indexOf('lobbyV3(userId,'), 'the shell guard precedes the lobby read');
  assert.match(home, /<GlobalHeaderServer activeNav="games" \/>\s*<LobbyMain v=\{v\} chip=\{chip\} userId=\{userId\} isShell=\{isShell\} \/>\s*<SiteFooter \/>/);
  assert.match(page, /export async function FrontPage\(\) \{/);
  assert.match(code(src('app/today/page.js')), /import \{ FrontPage \} from '\.\.\/page';[\s\S]*return <FrontPage \/>;/);
  // the same <main> /games draws, and signed-out is the lobby's own state
  const main = code(src('components/games/LobbyMain.js'));
  assert.match(main, /signedIn=\{userId != null\}/);
  assert.match(code(src('app/games/page.js')), /<LobbyMain v=\{v\} chip=\{chip\} userId=\{userId\} isShell=\{isShell\} \/>/);
});
