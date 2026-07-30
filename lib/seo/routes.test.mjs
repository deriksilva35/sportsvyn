// lib/seo/routes.test.mjs — indexability policy vs. what the pages actually declare.
//
// Same shape as lib/pollers/cronWiring.test.mjs: page files cannot be imported under
// node --test (the @/ alias is a Next build concern), so this walks app/**/page.js
// and reads them as text. Blunt, and it catches the failures that actually happen —
// a private surface shipped without noindex (this is how /signin and
// /admin/signups ended up publicly indexable), or a stale noindex left behind on a
// page the launch gate was supposed to open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  NOINDEX_PREFIXES, isNoindexRoute, STATIC_ROUTES, siteOrigin, absolute, dedupeByUrl,
} from './routes.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(REPO, 'app');

// Map every page.js to the route it serves. Route groups ((group)) and private
// folders (_folder) do not appear in the URL; neither is used here, but strip them
// so this keeps working if they are introduced.
function routeFor(fileRel) {
  const segs = path.dirname(fileRel).split(path.sep)
    .filter((s) => s !== '.' && !(s.startsWith('(') && s.endsWith(')')) && !s.startsWith('_'));
  return `/${segs.join('/')}` === '/' ? '/' : `/${segs.join('/')}`;
}

function pages(dir = '', acc = []) {
  for (const d of readdirSync(path.join(APP, dir), { withFileTypes: true })) {
    const rel = dir ? path.join(dir, d.name) : d.name;
    if (d.isDirectory()) { pages(rel, acc); continue; }
    if (d.name !== 'page.js') continue;
    acc.push({ rel, route: routeFor(rel), src: readFileSync(path.join(APP, rel), 'utf8') });
  }
  return acc;
}

// A page is noindexed either by its own declaration or by an ancestor layout's.
// /app/* is the live case: app/app/layout.js carries it for the whole shell.
const layoutNoindex = (() => {
  const out = [];
  const walk = (dir = '') => {
    for (const d of readdirSync(path.join(APP, dir), { withFileTypes: true })) {
      const rel = dir ? path.join(dir, d.name) : d.name;
      if (d.isDirectory()) { walk(rel); continue; }
      if (d.name !== 'layout.js') continue;
      if (/robots:\s*\{[^}]*index:\s*false/.test(readFileSync(path.join(APP, rel), 'utf8'))) {
        out.push(routeFor(rel));
      }
    }
  };
  walk();
  return out;
})();

const declaresNoindex = (p) =>
  /robots:\s*\{[^}]*index:\s*false/.test(p.src)
  || layoutNoindex.some((l) => p.route === l || p.route.startsWith(`${l === '/' ? '' : l}/`));

const ALL = pages();

test('the app has pages to check (the walker actually found them)', () => {
  assert.ok(ALL.length > 25, `only found ${ALL.length} pages — walker is broken`);
});

test('every private route declares noindex', () => {
  const missing = ALL.filter((p) => isNoindexRoute(p.route) && !declaresNoindex(p));
  assert.deepEqual(missing.map((p) => p.route), [],
    `private route(s) crawlable: ${missing.map((p) => p.rel).join(', ')}`);
});

test('no public route still carries a stale noindex', () => {
  const stale = ALL.filter((p) => !isNoindexRoute(p.route) && declaresNoindex(p));
  assert.deepEqual(stale.map((p) => p.route), [],
    `public route(s) still noindexed: ${stale.map((p) => p.rel).join(', ')}`);
});

test('every static sitemap route resolves to a real page file', () => {
  // Guards the other direction: a sitemap advertising a route that does not exist
  // feeds crawlers 404s. Dynamic segments are excluded — STATIC_ROUTES is static
  // by definition.
  const routes = new Set(ALL.map((p) => p.route));
  const orphans = STATIC_ROUTES.map((r) => r.path).filter((p) => !routes.has(p));
  assert.deepEqual(orphans, [], `sitemap lists non-existent route(s): ${orphans.join(', ')}`);
});

test('no static sitemap route is also a noindex route', () => {
  // The contradiction that silently wastes crawl budget: advertised in the sitemap,
  // refused by robots.txt.
  const conflicts = STATIC_ROUTES.map((r) => r.path).filter(isNoindexRoute);
  assert.deepEqual(conflicts, []);
});

test('STATIC_ROUTES entries are well-formed and unique', () => {
  const seen = new Set();
  const FREQ = ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'];
  for (const r of STATIC_ROUTES) {
    assert.ok(r.path.startsWith('/'), `${r.path}: must be root-relative`);
    assert.ok(!r.path.endsWith('/') || r.path === '/', `${r.path}: no trailing slash`);
    assert.ok(FREQ.includes(r.changeFrequency), `${r.path}: bad changeFrequency`);
    assert.ok(r.priority > 0 && r.priority <= 1, `${r.path}: priority out of range`);
    assert.ok(!seen.has(r.path), `${r.path}: duplicate`);
    seen.add(r.path);
  }
});

test('isNoindexRoute matches on path segments, not name prefixes', () => {
  assert.equal(isNoindexRoute('/sim'), true);
  assert.equal(isNoindexRoute('/sim/history'), true);
  assert.equal(isNoindexRoute('/sim/draft/abc'), true);
  assert.equal(isNoindexRoute('/my'), true);
  assert.equal(isNoindexRoute('/admin/signups'), true);
  assert.equal(isNoindexRoute('/signin/check-email'), true);
  assert.equal(isNoindexRoute('/app'), true);

  assert.equal(isNoindexRoute('/'), false);
  assert.equal(isNoindexRoute('/nfl'), false);
  assert.equal(isNoindexRoute('/market'), false);
  // The trap: these START with a noindex prefix's letters but are different routes.
  assert.equal(isNoindexRoute('/simulator'), false);
  assert.equal(isNoindexRoute('/mystery'), false);
  assert.equal(isNoindexRoute('/apple'), false);
  assert.equal(isNoindexRoute('/articles'), false);
});

test('siteOrigin never emits a malformed host, and never a trailing slash', () => {
  const saved = { base: process.env.NEXT_PUBLIC_BASE_URL, vercel: process.env.VERCEL_URL };
  try {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://sportsvyn.com/';
    assert.equal(siteOrigin(), 'https://sportsvyn.com');
    assert.equal(absolute('/sitemap.xml'), 'https://sportsvyn.com/sitemap.xml');

    delete process.env.NEXT_PUBLIC_BASE_URL;
    process.env.VERCEL_URL = 'sportsvyn-abc123.vercel.app';
    assert.equal(siteOrigin(), 'https://sportsvyn-abc123.vercel.app');

    // Both absent -> the literal fallback, NOT "https://undefined".
    delete process.env.VERCEL_URL;
    assert.equal(siteOrigin(), 'https://sportsvyn.com');
    assert.ok(!siteOrigin().includes('undefined'));
  } finally {
    if (saved.base === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
    else process.env.NEXT_PUBLIC_BASE_URL = saved.base;
    if (saved.vercel === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = saved.vercel;
  }
});

test('dedupeByUrl: one entry per URL, newest lastModified wins', () => {
  // The real case: `teams` holds one row per national team PER COMPETITION, so
  // /team/senegal is emitted three times from three rows with three timestamps.
  const out = dedupeByUrl([
    { url: '/team/senegal', lastModified: '2026-01-01', priority: 0.6 },
    { url: '/team/senegal', lastModified: '2026-07-20', priority: 0.6 },
    { url: '/team/senegal', lastModified: '2026-03-05', priority: 0.6 },
    { url: '/team/japan', lastModified: '2026-02-02', priority: 0.6 },
  ]);
  assert.equal(out.length, 2);
  const senegal = out.find((e) => e.url === '/team/senegal');
  assert.equal(senegal.lastModified, '2026-07-20', 'must keep the newest, not the last seen');
  assert.equal(senegal.priority, 0.6, 'other fields survive the merge');
});

test('dedupeByUrl: preserves first-appearance order (stable, diffable output)', () => {
  const out = dedupeByUrl([
    { url: '/a', lastModified: '2026-01-01' },
    { url: '/b', lastModified: '2026-01-01' },
    { url: '/a', lastModified: '2026-06-01' },
    { url: '/c', lastModified: '2026-01-01' },
  ]);
  assert.deepEqual(out.map((e) => e.url), ['/a', '/b', '/c']);
});

test('dedupeByUrl: tolerates an unparseable lastModified without dropping the URL', () => {
  const out = dedupeByUrl([
    { url: '/a', lastModified: 'not-a-date' },
    { url: '/a', lastModified: '2026-06-01' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].lastModified, '2026-06-01', 'a real date beats an unparseable one');

  const both = dedupeByUrl([
    { url: '/b', lastModified: 'nope' },
    { url: '/b', lastModified: 'also-nope' },
  ]);
  assert.equal(both.length, 1, 'still exactly one entry');
});

test('dedupeByUrl: empty and single-entry inputs', () => {
  assert.deepEqual(dedupeByUrl([]), []);
  assert.equal(dedupeByUrl([{ url: '/x', lastModified: '2026-01-01' }]).length, 1);
});

test('robots.js disallows exactly the noindex prefixes', async () => {
  // Reads the source rather than importing (the route uses the @/ alias).
  const src = readFileSync(path.join(APP, 'robots.js'), 'utf8');
  assert.match(src, /NOINDEX_PREFIXES/, 'robots.js must derive Disallow from the policy');
  assert.match(src, /sitemap:/, 'robots.js must reference the sitemap');
  assert.ok(NOINDEX_PREFIXES.length > 0);
});
