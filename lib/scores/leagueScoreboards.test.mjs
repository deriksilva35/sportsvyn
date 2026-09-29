// lib/scores/leagueScoreboards.test.mjs — /nfl/scores and /cfb/scores are 308s
// to /scores?sport=<league> (tue-12). The proxy cannot be imported under node
// (next/server), so its half is pinned by source; the destination itself is the
// pure helper both the proxy and the fallback routes call.
// Run: node --test lib/scores/leagueScoreboards.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAGUE_SCOREBOARDS, scoreboardRedirect, scoreboardRedirectFromParams } from './leagueScoreboards.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (r) => readFileSync(path.join(REPO, r), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('each league scoreboard goes to its sport chip on /scores', () => {
  assert.equal(scoreboardRedirect('/nfl/scores', ''), '/scores?sport=nfl');
  assert.equal(scoreboardRedirect('/cfb/scores', ''), '/scores?sport=cfb');
  assert.equal(scoreboardRedirect('/cfb/scores/', ''), '/scores?sport=cfb', 'a trailing slash is the same route');
});

test('THE QUERY RIDES ALONG, and sport= is set from the path, never doubled', () => {
  assert.equal(scoreboardRedirect('/nfl/scores', '?date=2026-10-04'), '/scores?date=2026-10-04&sport=nfl');
  assert.equal(scoreboardRedirect('/cfb/scores', 'top25=1&conf=sec&mine=1'), '/scores?top25=1&conf=sec&mine=1&sport=cfb');
  const u = new URL(scoreboardRedirect('/nfl/scores', '?sport=cfb&date=2026-10-04'), 'https://x');
  assert.deepEqual(u.searchParams.getAll('sport'), ['nfl'], 'the path named the league');
  assert.equal(u.searchParams.get('date'), '2026-10-04');
  // the shell param must survive: the proxy sets the cookie on this same response
  assert.equal(new URL(scoreboardRedirect('/nfl/scores', '?shell=sim-app'), 'https://x').searchParams.get('shell'), 'sim-app');
});

test('every other path is not ours', () => {
  for (const p of ['/scores', '/nfl', '/nfl/scoresx', '/nfl/scores/extra', '/mlb/scores', '/epl/scores', '/', '', null]) {
    assert.equal(scoreboardRedirect(p, '?a=1'), null, String(p));
  }
});

test('the fallback route builds the same URL from searchParams (arrays included)', () => {
  assert.equal(scoreboardRedirectFromParams('/nfl/scores', { date: '2026-10-04' }), '/scores?date=2026-10-04&sport=nfl');
  assert.equal(scoreboardRedirectFromParams('/cfb/scores', { conf: ['sec', 'b1g'] }), '/scores?conf=sec&conf=b1g&sport=cfb');
  assert.equal(scoreboardRedirectFromParams('/cfb/scores', {}), '/scores?sport=cfb');
});

test('the destination sport values are ones /scores accepts', async () => {
  const { parseV4 } = await import('./v4.js');
  for (const sport of Object.values(LEAGUE_SCOREBOARDS)) {
    assert.equal(parseV4({ sport }).sport, sport, `/scores?sport=${sport} must not fall back to all`);
  }
});

test('THE PROXY: matcher literals equal LEAGUE_SCOREBOARDS, and it redirects 308 before the admin gate', () => {
  const t = strip(src('proxy.js'));
  const m = t.match(/matcher:\s*\[([\s\S]*?)\n  \],/);
  assert.ok(m, 'matcher block not found');
  const literals = [...m[1].matchAll(/'(\/(?:nfl|cfb|mlb|epl)\/scores)'/g)].map((x) => x[1]).sort();
  assert.deepEqual(literals, Object.keys(LEAGUE_SCOREBOARDS).sort());
  assert.match(t, /import \{ scoreboardRedirect \} from '\.\/lib\/scores\/leagueScoreboards\.js'/);
  const call = t.indexOf('scoreboardRedirect(pathname, request.nextUrl.search)');
  assert.ok(call > 0, 'the proxy must call the helper with the raw query');
  assert.match(t.slice(call, call + 300), /NextResponse\.redirect\([^)]*\), 308\)/, 'permanent, 308');
  assert.ok(call < t.indexOf('const isAdminPath'), 'and it runs before the admin gate');
});

test('WALK app/: no route under a league mounts a scoreboard; the retired ones only redirect', () => {
  // Walks rather than naming files, so a /mlb/scores added later is seen.
  const found = [];
  for (const d of readdirSync(path.join(REPO, 'app'), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const f = path.join('app', d.name, 'scores', 'page.js');
    if (existsSync(path.join(REPO, f))) found.push(f);
  }
  assert.deepEqual(found.sort(), ['app/cfb/scores/page.js', 'app/nfl/scores/page.js']);
  for (const f of found) {
    const t = strip(src(f));
    assert.doesNotMatch(t, /ScoresView|<Scoreboard|LeagueHeader/, `${f} must not draw a board`);
    const route = '/' + f.split('/').slice(1, 3).join('/');
    assert.ok(LEAGUE_SCOREBOARDS[route], `${route} must be in LEAGUE_SCOREBOARDS`);
    assert.ok(t.includes(`permanentRedirect(scoreboardRedirectFromParams('${route}'`), `${f} falls back to the same URL`);
  }
});
