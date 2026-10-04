// lib/auth/ageProxyScope.test.mjs - THE AGE CLAUSE WIDENED THE MATCHER, AND
// NOTHING ELSE MAY WIDEN WITH IT.
//
// The receipt (memory: next-16-renames-middleware-to-proxy): widening proxy.js's
// matcher once widened the ADMIN GATE, because the gate's scope was "whatever
// reached the function". The age clause adds two matcher entries that run
// proxy() on EVERY signed-in page request. This test proves that, on a path the
// OLD matcher never covered, the function can now do exactly two things:
//
//   (a) the age redirect (307 -> /age/check?next=..., nothing else attached), or
//   (b) the same bare pass-through Next would have given without a proxy:
//       NextResponse.next(), no added header, no Set-Cookie, no auth challenge.
//
// None of the other branches - the admin gate, 3.1.1 /membership, the shell
// cookie, the /sim start URL, retired 301s, scoreboard 308s - may newly fire.
//
// HOW proxy() IS RUN FOR REAL. proxy.js imports '@/lib/...' (a bundler alias)
// and 'next/server' (an extensionless subpath node will not resolve), so it
// cannot be imported as-is - proxyConfig.test.mjs says so and checks source
// instead. Here the SOURCE is copied into test-tmp/ (stubPath) with exactly
// those two specifiers rewritten to absolute paths, and the copy is imported:
// the function under test is the file's own text, byte for byte otherwise.
//
// THE OLD MATCHER IS NOT RE-TYPED HERE. It is the live `config.matcher` minus
// the two entries keyed on the session cookies, evaluated by a small matcher
// that implements just the forms that list uses (literal, '/x/:path*',
// '(regex)' sources, has/missing on query, cookie, header).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stubPath } from '../testing/stubDir.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SESSION = 'authjs.session-token';
const SECURE_SESSION = '__Secure-authjs.session-token';

let proxy, config, NextResponse, NextRequest, ageCookieValue;
const COPY = stubPath('__proxy_copy.mjs');

before(async () => {
  const abs = (r) => pathToFileURL(path.join(REPO, r)).href;
  let src = readFileSync(path.join(REPO, 'proxy.js'), 'utf8');
  const rewrites = [
    [`from 'next/server'`, `from '${abs('node_modules/next/server.js')}'`],
    [`from '@/lib/shell/constants'`, `from '${abs('lib/shell/constants.js')}'`],
  ];
  for (const [a, b] of rewrites) { assert.ok(src.includes(a), `proxy.js no longer imports ${a}`); src = src.replace(a, b); }
  src = src.replace(/from '\.\/(lib\/[^']+)'/g, (_, r) => `from '${abs(r)}'`);
  assert.doesNotMatch(src, /from '(\.\/|@\/)/, 'every relative/alias import was rewritten');
  writeFileSync(COPY, src);
  ({ proxy, config } = await import(pathToFileURL(COPY).href));
  ({ NextResponse, NextRequest } = await import(abs('node_modules/next/server.js')));
  ({ ageCookieValue } = await import(abs('lib/auth/ageCookie.js')));
});
after(() => { try { unlinkSync(COPY); } catch { /* already gone */ } });

// ---------------------------------------------------------------------------
// The matcher, evaluated.
// ---------------------------------------------------------------------------
function sourceMatches(source, pathname) {
  if (source.endsWith('/:path*')) {
    const base = source.slice(0, -'/:path*'.length);
    return base === '' ? true : pathname === base || pathname.startsWith(`${base}/`);
  }
  if (source.startsWith('/(')) return new RegExp(`^${source}$`).test(pathname);
  return pathname === source;
}
function condHolds(c, req) {
  let v;
  if (c.type === 'query') v = req.nextUrl.searchParams.get(c.key);
  else if (c.type === 'cookie') v = req.cookies.get(c.key)?.value;
  else if (c.type === 'header') v = req.headers.get(c.key);
  if (v == null) return false;
  if (c.value == null) return true;
  return new RegExp(`^${c.value}$`).test(v);
}
function entryMatches(entry, req) {
  const e = typeof entry === 'string' ? { source: entry } : entry;
  if (!sourceMatches(e.source, req.nextUrl.pathname)) return false;
  if ((e.has ?? []).some((c) => !condHolds(c, req))) return false;
  if ((e.missing ?? []).some((c) => condHolds(c, req))) return false;
  return true;
}
const isAgeEntry = (e) => typeof e === 'object' && (e.has ?? []).some((c) => c.type === 'cookie' && [SESSION, SECURE_SESSION].includes(c.key));
const oldMatcher = () => config.matcher.filter((e) => !isAgeEntry(e));
const covered = (entries, req) => entries.some((e) => entryMatches(e, req));

// ---------------------------------------------------------------------------
// Requests.
// ---------------------------------------------------------------------------
const TOKEN = 'proxy-scope-session-token';
function req(pathname, { method = 'GET', cookies = {}, ua = 'Mozilla/5.0', cookieName = SESSION, passed = true } = {}) {
  const jar = { [cookieName]: TOKEN, ...(passed ? { sv_age: ageCookieValue(TOKEN) } : {}), ...cookies };
  const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  return new NextRequest(`http://localhost:3000${pathname}`, { method, headers: { cookie, 'user-agent': ua } });
}
const headerList = (res) => [...res.headers.entries()].sort();
const BASELINE = () => headerList(NextResponse.next());

// Paths the OLD matcher did not cover, across the product.
const NEWLY_REACHED = ['/', '/games', '/scores', '/scores?sport=nfl', '/nfl/game/x', '/leagues/1', '/pickem/nfl',
  '/draft', '/six', '/you', '/results', '/run', '/october', '/weekly', '/daily', '/survivor', '/epl', '/ucl/standings',
  '/match/x', '/team/x', '/player/x', '/j/abc', '/join/ABC', '/sim/draft/1', '/rankings', '/market'];

// The variants a signed-in reader actually arrives with. Each is a request the
// OLD matcher did not cover on these paths (the shell entries only match while
// the sv_shell cookie is MISSING, and these carry it).
const VARIANTS = {
  'web, signed in': {},
  'web, https cookie name': { cookieName: SECURE_SESSION },
  'shell cookie + container UA': { cookies: { sv_shell: 'sim-app' }, ua: 'Mozilla/5.0 SportsvynApp/1' },
  'shell cookie + param': { cookies: { sv_shell: 'sim-app' }, query: '?shell=sim-app' },
  HEAD: { method: 'HEAD' },
};
const withQuery = (p, q) => (q ? `${p}${p.includes('?') ? '&' : '?'}${q.slice(1)}` : p);

test('the representative paths were NOT covered by the old matcher and ARE covered now (signed in)', () => {
  for (const p of NEWLY_REACHED) {
    for (const [name, v] of Object.entries(VARIANTS)) {
      const r = req(withQuery(p, v.query), v);
      assert.equal(covered(oldMatcher(), r), false, `${p} [${name}] was already covered - pick another path`);
      if (v.method !== 'HEAD') assert.equal(covered(config.matcher, r), true, `${p} [${name}] must reach the age clause`);
    }
    // And signed out, the new entries do not run the proxy at all.
    const out = new NextRequest(`http://localhost:3000${p}`);
    assert.equal(covered(config.matcher, out), false, `${p} signed out must not invoke the proxy`);
  }
});

test('(b) PASSED: on every newly-reached path the response is NextResponse.next(), unchanged', async () => {
  const base = BASELINE();
  for (const p of NEWLY_REACHED) {
    for (const [name, v] of Object.entries(VARIANTS)) {
      const res = await proxy(req(withQuery(p, v.query), v));
      assert.equal(res.status, 200, `${p} [${name}] status`);
      assert.deepEqual(headerList(res), base, `${p} [${name}] must add no header and no cookie`);
      assert.equal(res.cookies.getAll().length, 0, `${p} [${name}] sets no cookie`);
    }
  }
});

test('(a) NOT PASSED: the only thing that fires is the age redirect, with nothing else attached', async () => {
  for (const p of NEWLY_REACHED) {
    for (const [name, v] of Object.entries(VARIANTS)) {
      const url = withQuery(p, v.query);
      const res = await proxy(req(url, { ...v, passed: false }));
      assert.equal(res.status, 307, `${p} [${name}]`);
      const loc = new URL(res.headers.get('location'));
      assert.equal(loc.pathname, '/age/check', `${p} [${name}] goes to the age check`);
      assert.equal(loc.searchParams.get('next'), url, `${p} [${name}] carries its own path`);
      assert.equal(res.cookies.getAll().length, 0, `${p} [${name}] sets no cookie`);
      assert.equal(res.headers.get('www-authenticate'), null, 'no admin challenge');
      const extra = headerList(res).map(([k]) => k).filter((k) => !['location', 'x-middleware-rewrite'].includes(k));
      assert.deepEqual(extra, [], `${p} [${name}] carries no other header`);
    }
    // A wrong marker (another session's) is the same as none.
    const other = await proxy(req(p, { cookies: { sv_age: ageCookieValue('someone-else') } }));
    assert.equal(other.status, 307);
  }
});

test('a server action (POST to a page path) is never redirected and passes through untouched', async () => {
  const base = BASELINE();
  for (const p of NEWLY_REACHED) {
    for (const passed of [true, false]) {
      const res = await proxy(req(p, { method: 'POST', passed }));
      assert.equal(res.status, 200, `${p} POST passed=${passed}`);
      assert.deepEqual(headerList(res), base);
    }
  }
});

test('the OLD paths behave exactly as before for a signed-in, unanswered reader', async () => {
  // Admin is still the admin gate (500 when unconfigured, 401 when configured)
  // - never an age redirect, never a pass-through.
  for (const p of ['/admin', '/admin/x', '/api/admin/x']) {
    const res = await proxy(req(p, { passed: false }));
    assert.ok([401, 500].includes(res.status), `${p} stays behind the admin gate (got ${res.status})`);
  }
  // A retired route is still its 301, before the age clause.
  const retired = await proxy(req('/today', { passed: false }));
  assert.equal(retired.status, 301);
  // The scoreboard 308 still fires first.
  const sb = await proxy(req('/nfl/scores', { passed: false }));
  assert.equal(sb.status, 308);
  // The native start URL is still its 307 to /games, not to the age check.
  const start = await proxy(req('/sim?shell=sim-app', { passed: false }));
  assert.equal(new URL(start.headers.get('location')).pathname, '/games');
  // sun-16 D: /my and /account 308 to /you BEFORE the age clause (one hop,
  // not two - /you then meets the age screen itself), query kept.
  for (const [p, want] of [['/my', '/you'], ['/account?from=email', '/you?from=email'], ['/my/anything', '/you']]) {
    const r = await proxy(req(p, { passed: false }));
    assert.equal(r.status, 308, `${p} is permanent`);
    const loc = new URL(r.headers.get('location'));
    assert.equal(`${loc.pathname}${loc.search}`, want, p);
  }
  // 3.1.1: /membership in the shell still bounces to /sim.
  const mem = await proxy(req('/membership', { passed: false, cookies: { sv_shell: 'sim-app' } }));
  assert.equal(new URL(mem.headers.get('location')).pathname, '/sim');
});

test('every non-age matcher entry is unchanged in count: the age clause added exactly two', () => {
  assert.equal(config.matcher.filter(isAgeEntry).length, 2);
  for (const e of config.matcher.filter(isAgeEntry)) {
    assert.equal(e.missing, undefined, 'an age entry carries no other condition');
    assert.equal(e.has.length, 1, 'keyed on the session cookie and nothing else');
  }
});
