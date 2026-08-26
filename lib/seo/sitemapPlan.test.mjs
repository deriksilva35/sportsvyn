// lib/seo/sitemapPlan.test.mjs - the split, and the things a split can break.
//
// A sitemap index fails quietly. A dropped URL is not an error, it is just a
// page that stops being advertised; a URL in two children is not an error
// either, it just misreports coverage. So the tests here are about
// CONSERVATION - every URL lands in exactly one file - rather than about the
// files looking right.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SITEMAP_MAX_URLS, SITEMAP_CHUNK_URLS, SITEMAP_SURFACES, SITEMAP_SURFACE_KEYS,
  partsFor, planSitemaps, parseSitemapId, windowFor,
} from './sitemapPlan.js';
import { renderUrlset, renderIndex, xmlEscape } from './sitemapData.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

// The real shape at the time of the split.
const LIVE = { static: 18, articles: 129, teams: 452, matches: 5771, players: 30969 };
const LIVE_TOTAL = 37339;

test('COUNT CONSERVATION: the windows tile the surface exactly', () => {
  // Sum of what every child can hold == the surface's URL count. This is the
  // property that makes "37,339 in, 37,339 out" hold, and it is checked per
  // surface so a shortfall names the surface rather than the total.
  let grand = 0;
  for (const [key, count] of Object.entries(LIVE)) {
    let covered = 0;
    for (let p = 0; p < partsFor(count); p++) {
      const { limit, offset } = windowFor(p);
      covered += Math.max(0, Math.min(limit, count - offset));
    }
    assert.equal(covered, count, `${key}: ${covered} covered of ${count}`);
    grand += covered;
  }
  assert.equal(grand, LIVE_TOTAL, 'every URL in the pre-split file is still covered');
});

test('NO OVERLAP: consecutive windows meet, never straddle', () => {
  for (let p = 0; p < 6; p++) {
    const a = windowFor(p), b = windowFor(p + 1);
    assert.equal(a.offset + a.limit, b.offset, `part ${p} must end where ${p + 1} begins`);
  }
});

test('the live shape produces the six children actually served', () => {
  assert.deepEqual(planSitemaps(LIVE),
    ['static-0', 'articles-0', 'teams-0', 'matches-0', 'players-0', 'players-1']);
});

test('a surface emits a file even at zero rows', () => {
  // An id the index advertises must resolve. Emitting nothing for an empty
  // surface would put a 404 in the index the first time articles is empty.
  const ids = planSitemaps({ static: 0, articles: 0, teams: 0, matches: 0, players: 0 });
  assert.deepEqual(ids, SITEMAP_SURFACE_KEYS.map((k) => `${k}-0`));
  assert.equal(partsFor(0), 1);
  assert.equal(partsFor(null), 1);
});

test('growth adds a file rather than overflowing one', () => {
  // The point of chunking. A second CFB roster season roughly doubles players.
  assert.equal(partsFor(SITEMAP_CHUNK_URLS), 1, 'exactly full is still one file');
  assert.equal(partsFor(SITEMAP_CHUNK_URLS + 1), 2);
  assert.equal(partsFor(60_000), 3);
  // And no chunk can reach the ceiling that caused the split.
  assert.ok(SITEMAP_CHUNK_URLS < SITEMAP_MAX_URLS,
    'a chunk sized at the cap means the first file to cross it fails');
});

test('every surface writes under a DISTINCT prefix', () => {
  // This is what makes cross-child duplication impossible by construction, and
  // it is why dedupe is only ever needed within a surface.
  const prefixes = SITEMAP_SURFACES.map((s) => s.prefix).filter(Boolean);
  assert.equal(new Set(prefixes).size, prefixes.length, 'two surfaces share a prefix');
  for (const a of prefixes) {
    for (const b of prefixes) {
      if (a !== b) assert.ok(!a.startsWith(`${b}/`), `${a} nests under ${b}`);
    }
  }
});

test('ids round-trip, and junk does not parse', () => {
  assert.deepEqual(
    (({ key, part }) => ({ key, part }))(parseSitemapId('players-1')), { key: 'players', part: 1 });
  for (const bad of ['bogus-0', 'players', 'players-', '-0', '', null, undefined,
                     'players-0.xml', '../etc', 'PLAYERS-0']) {
    assert.equal(parseSitemapId(bad), null, `${JSON.stringify(bad)} must not parse`);
  }
});

// ------------------------------------------------------- the served files

test('a part PAST THE END is not a file - it must 404, not answer empty', () => {
  // players-2 and players-99 parse fine and returned 200 with an empty urlset,
  // which tells a crawler the surface has no URLs rather than that there is no
  // such file. Found on DEV by probing ids the index does not advertise.
  const d = src('lib/seo/sitemapData.js');
  assert.match(d, /const beyondEnd = \(rows\) => part > 0 && rows\.length === 0;/);
  assert.match(d, /if \(beyondEnd\(slice\)\) return null;/, 'static must be guarded too');
  assert.match(d, /if \(beyondEnd\(rows\)\) return null;/);
  // And the route turns that null into a real 404.
  assert.match(src('app/sitemap/[file]/route.js'),
    /if \(!entries\) return new Response\('Not found', \{ status: 404 \}\);/);
});

test('DEDUPE HAPPENS IN SQL, or chunking can split a group across files', () => {
  // With LIMIT/OFFSET over rows, two rows sharing a slug can straddle a chunk
  // boundary and emit the same <loc> in two children. GROUP BY slug makes a
  // partial group impossible; ORDER BY slug keeps windows stable across builds.
  const d = src('lib/seo/sitemapData.js');
  const pages = d.slice(d.indexOf('const PAGES'), d.indexOf('export async function surfaceCounts'));
  for (const surface of ['articles', 'teams', 'matches', 'players']) {
    const q = pages.slice(pages.indexOf(`${surface}:`));
    assert.match(q.slice(0, 400), /GROUP BY slug ORDER BY slug LIMIT/, `${surface} must group and order`);
  }
  // The count must be built on the same basis as the page, or the last chunk
  // silently comes up short.
  const counts = d.slice(d.indexOf('const COUNTS'), d.indexOf('const PAGES'));
  assert.equal((counts.match(/count\(DISTINCT slug\)/g) ?? []).length, 4);
});

test('draft articles are still excluded - a split must not widen what is crawled', () => {
  const d = src('lib/seo/sitemapData.js');
  assert.equal((d.match(/status = 'published'/g) ?? []).length, 2, 'both the count and the page');
});

test('the index points at the children, and robots points at the index', () => {
  const ids = ['static-0', 'players-0'];
  const xml = renderIndex(ids, new Date('2026-08-26T00:00:00Z'));
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<sitemapindex xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  for (const id of ids) assert.ok(xml.includes(`/sitemap/${id}.xml`), `${id} must be referenced`);
  assert.equal((xml.match(/<sitemap>/g) ?? []).length, ids.length, 'one entry per child, no extras');
  // robots.txt keeps naming /sitemap.xml, which is now the index - that URL is
  // what was submitted to search engines and must not move.
  assert.match(src('app/robots.js'), /sitemap: absolute\('\/sitemap\.xml'\),/);
  assert.match(src('app/sitemap.xml/route.js'), /renderIndex\(await sitemapIds\(\)\)/);
});

test('the urlset is well-formed and escapes what it interpolates', () => {
  const xml = renderUrlset([
    { url: 'https://x/a?b=1&c=2', lastModified: new Date('2026-08-26T00:00:00Z'),
      changeFrequency: 'daily', priority: 0.6 },
  ]);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(xml, /<loc>https:\/\/x\/a\?b=1&amp;c=2<\/loc>/, 'a bare & is malformed XML');
  assert.match(xml, /<lastmod>2026-08-26T00:00:00\.000Z<\/lastmod>/);
  assert.match(xml, /<priority>0\.6<\/priority>/);
  assert.equal(xmlEscape(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&apos;');
  // An unparseable lastModified must not emit "Invalid Date" into the file.
  assert.match(renderUrlset([{ url: 'https://x/', lastModified: 'not a date' }]),
    /<lastmod>\d{4}-\d{2}-\d{2}T/);
});

test('the metadata sitemap file is GONE, or it reclaims /sitemap.xml', () => {
  // Next owns /sitemap.xml whenever app/sitemap.js exists - with
  // generateSitemaps() it serves the 404 page there, and a route handler at the
  // same path fails the build outright with "Conflicting route and metadata".
  let present = true;
  try { src('app/sitemap.js'); } catch { present = false; }
  assert.equal(present, false, 'app/sitemap.js must not exist alongside the index route');
});
