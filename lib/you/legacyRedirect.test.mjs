// lib/you/legacyRedirect.test.mjs - /my and /account are 308s to /you
// (sun-16 D). The proxy cannot be imported under node without rewriting its
// imports (lib/auth/ageProxyScope.test.mjs does that and asserts the live
// 308s); this file pins the pure destination, the matcher literals, the
// fallback pages and that nothing in the tree still links into a redirect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { youRedirect, youRedirectFromParams, LEGACY_YOU_ROOTS, YOU_PATH } from './legacyRedirect.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (r) => readFileSync(path.join(REPO, r), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('/my and /account, and everything under them, go to /you', () => {
  assert.equal(YOU_PATH, '/you');
  assert.deepEqual([...LEGACY_YOU_ROOTS], ['/my', '/account']);
  for (const p of ['/my', '/my/', '/my/anything', '/my/a/b', '/account', '/account/', '/account/settings']) {
    assert.equal(youRedirect(p, ''), '/you', p);
  }
});

test('THE QUERY RIDES ALONG - deep links keep their parameters', () => {
  assert.equal(youRedirect('/account', '?from=email&tab=push'), '/you?from=email&tab=push');
  assert.equal(youRedirect('/my', 'x=1'), '/you?x=1');
  assert.equal(new URL(youRedirect('/account', '?shell=sim-app'), 'https://x').searchParams.get('shell'), 'sim-app');
  assert.equal(youRedirectFromParams('/account', { from: 'email', t: ['a', 'b'] }), '/you?from=email&t=a&t=b');
  assert.equal(youRedirectFromParams('/my', {}), '/you');
});

test('every other path is not ours - /sim/account (deletion, 5.1.1(v)) above all', () => {
  for (const p of ['/you', '/sim/account', '/mystery', '/myteam', '/accounts', '/accounting', '/', '', null, '/api/account']) {
    assert.equal(youRedirect(p, '?a=1'), null, String(p));
  }
});

test('THE PROXY: matcher literals equal LEGACY_YOU_ROOTS; a 308 before the age clause and the admin gate', () => {
  const t = strip(src('proxy.js'));
  const m = t.match(/matcher:\s*\[([\s\S]*?)\n  \],/);
  assert.ok(m, 'matcher block');
  for (const r of LEGACY_YOU_ROOTS) {
    assert.ok(m[1].includes(`'${r}'`), `matcher names ${r}`);
    assert.ok(m[1].includes(`'${r}/:path*'`), `matcher names ${r}/:path*`);
  }
  assert.match(t, /import \{ youRedirect \} from '\.\/lib\/you\/legacyRedirect\.js'/);
  const call = t.indexOf('youRedirect(pathname, request.nextUrl.search)');
  assert.ok(call > 0);
  assert.match(t.slice(call, call + 200), /NextResponse\.redirect\(new URL\(you, request\.url\), 308\)/);
  assert.ok(call < t.indexOf('sessionTokenFrom('), 'before the age clause');
  assert.ok(call < t.indexOf('const isAdminPath'), 'before the admin gate');
});

test('THE FALLBACK PAGES redirect too, permanently, with the query', () => {
  for (const [f, p] of [['app/my/page.js', '/my'], ['app/account/page.js', '/account']]) {
    const s = strip(src(f));
    assert.match(s, /import \{ permanentRedirect \} from 'next\/navigation'/, f);
    assert.ok(s.includes(`permanentRedirect(youRedirectFromParams('${p}', (await searchParams) ?? {}))`), f);
    assert.doesNotMatch(s, /auth\(\)|sql`/, `${f} renders nothing of its own`);
  }
});

test('NOTHING IN THE TREE LINKS INTO THE REDIRECTS', () => {
  // Every href, push url and redirect target that named /my or /account now
  // names /you. Counted over the tracked source, comments stripped; tests,
  // docs and the redirect's own files are excluded.
  const files = execFileSync('git', ['ls-files', '*.js', '*.mjs', '*.jsx'], { cwd: REPO, encoding: 'utf8' })
    .split('\n').filter((f) => f && !f.endsWith('.test.mjs') && !f.startsWith('docs/') && !f.startsWith('scripts/')
      && !['lib/you/legacyRedirect.js', 'proxy.js', 'app/my/page.js', 'app/account/page.js'].includes(f));
  const LINK = /(href=|href:|url:|redirect\(|push\(|callbackUrl=)\s*[{`'"(]*\s*['"`]\/(my|account)(['"`?/#])/;
  const hits = [];
  for (const f of files) {
    let s;
    try { s = strip(src(f)); } catch { continue; }
    if (LINK.test(s)) hits.push(f);
  }
  assert.deepEqual(hits, [], `still linking /my or /account: ${hits.join(', ')}`);
});
