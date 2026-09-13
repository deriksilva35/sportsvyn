// components/games/pickemSplit.test.mjs - the Pick'em split, rendered
// (LOBBY PICK'EM SPLIT relay item 5). Two boards side by side, each with its
// own href, counts and pill; one board keeps the old full-width row; none
// omits the section. The Draft row below is never touched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const LINK = path.join(__dirname, '__link_stub_split.mjs');
const NAV = path.join(__dirname, '__nav_stub_split.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/link') return { url: pathToFileURL(LINK).href, shortCircuit: true };
  if (spec === 'next/navigation') return { url: pathToFileURL(NAV).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, renderToStaticMarkup, LobbyV2, pickemRow;
before(async () => {
  writeFileSync(LINK, "import React from 'react'; export default function Link({ href, children, ...rest }) { return React.createElement('a', { ...rest, href: String(href) }, children); }\n");
  writeFileSync(NAV, "export function useRouter() { return { refresh() {}, push() {} }; }\n");
  React = await import('react');
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  LobbyV2 = (await import('./LobbyV2.js')).default;
  ({ pickemRow } = await import('../../lib/games/lobbyV2Shape.js'));
});
after(() => { for (const f of [LINK, NAV]) { try { unlinkSync(f); } catch { /* gone */ } } });

// NFL: all sixteen picked, two kicked -> Done. CFB: nothing picked, fifteen
// kicked -> Pick. The two boards disagree, which is the point.
const NFL = { sport: 'nfl', total: 16, pickable: 14, pickedOpen: 14, picked: 16, nextKickoff: '2026-09-13T17:00:00Z' };
const CFB = { sport: 'cfb', total: 24, pickable: 9, pickedOpen: 0, picked: 0, nextKickoff: '2026-09-12T23:00:00Z' };

const v = (pk) => ({
  now: '2026-09-12T20:00:00Z', week: 2, streak: 0, handle: null,
  intro: { open: 'One board open.', lock: null, live: 0 },
  daily: { key: 'daily', tag: 'Daily', title: 'The Daily', href: '/daily/board', description: 'd', edition: 'Edition 1', closesAt: null, state: 'play', cta: 'Play', stats: [], timeLeft: null },
  weekly: { key: 'weekly', tag: 'Weekly', title: 'The Weekly', href: '/weekly', description: 'w', state: 'unset', sub: 'Week 1', cta: 'Set your six', stats: [], locksAt: null },
  pickem: pk,
  draft: { key: 'draft', title: 'The Draft', glyph: '12', href: '/draft', lines: [{ text: 'Mock rooms open', at: null }], pill: { label: 'Open', tone: 'volt' } },
  tonight: [], read: null,
});
const html = (pk, props = {}) => renderToStaticMarkup(React.createElement(LobbyV2, { v: v(pk), signedIn: true, isShell: false, leagues: [], ...props }));
const tiles = (h) => [...h.matchAll(/<a class="lv-ptile"[^>]*data-sport="(\w+)"[^>]*>([\s\S]*?)<\/a>/g)];

test('two boards render two half-width tiles, each pointing at its own board', () => {
  const h = html(pickemRow({ nfl: NFL, cfb: CFB, uid: 1 }));
  const sec = h.match(/<div class="lv-duo lv-pickem" data-section="pickem">([\s\S]*?)<\/div><a class="lv-mini"/);
  assert.ok(sec, 'the section renders as the duo grid');
  const t = tiles(h);
  assert.equal(t.length, 2, 'two tiles');
  assert.deepEqual(t.map((m) => m[1]), ['nfl', 'cfb']);
  const hrefs = [...h.matchAll(/<a class="lv-ptile"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ['/pickem/nfl', '/pickem/cfb'], 'left NFL, right CFB');
  assert.match(t[0][2], /<strong>NFL<\/strong>/); assert.match(t[1][2], /<strong>CFB<\/strong>/);
});

test('each tile carries its OWN pill: NFL Done, CFB Pick, never one pill for both', () => {
  const t = tiles(html(pickemRow({ nfl: NFL, cfb: CFB, uid: 1 })));
  assert.match(t[0][2], /<span class="st done">Done<\/span>/, 'the finished board says Done');
  assert.match(t[1][2], /<span class="st go">Pick<\/span>/, 'the open board says Pick');
  assert.equal(t[0][2].includes('Pick'), false, 'and neither borrows the other\'s state');
});

test('each tile carries its own counts and its own lock', () => {
  const t = tiles(html(pickemRow({ nfl: NFL, cfb: CFB, uid: 1 })));
  assert.match(t[0][2], /16 of 16 · 14 still open/); assert.match(t[0][2], /next lock/);
  assert.match(t[1][2], /0 of 24 · 9 still open/);
  assert.equal(/0 of 24/.test(t[0][2]), false, 'the NFL tile knows nothing of the CFB board');
});

test('one board renders ONE full-width row in the old shape, naming that board', () => {
  const h = html(pickemRow({ nfl: null, cfb: CFB, uid: 1 }));
  assert.equal(tiles(h).length, 0, 'no split');
  const row = h.match(/<a class="lv-mini"[^>]*data-row="pickem"[^>]*>([\s\S]*?)<\/a>/);
  assert.ok(row, 'the old row is back');
  assert.match(row[1], /CFB 0 of 24 · 9 still open/);
  assert.match(h, /<a class="lv-mini" href="\/pickem\/cfb"/);
  assert.equal(/no board yet/.test(row[1]), false, 'and it does not mention the sport that has no board');
});

test('no board at all omits the section entirely, and the Draft row survives it', () => {
  const h = html(pickemRow({ nfl: null, cfb: null, uid: 1 }));
  assert.equal(/data-section="pickem"/.test(h), false, 'no section');
  assert.equal(/data-row="pickem"/.test(h), false, 'no row either');
  assert.match(h, /<a class="lv-mini"[^>]*data-row="draft"/, 'the Draft row is untouched');
});

test('the Draft row stays full width below the split, in the old shape', () => {
  const h = html(pickemRow({ nfl: NFL, cfb: CFB, uid: 1 }));
  const iPk = h.indexOf('data-section="pickem"'); const iDr = h.indexOf('data-row="draft"');
  assert.ok(iPk > -1 && iDr > iPk, 'the Draft row sits below the split');
  assert.match(h, /<a class="lv-mini" href="\/draft" data-row="draft">/, 'and is still an lv-mini, not a tile');
});

test('signed out: both tiles route through the sign-in gate and show no pill', () => {
  const h = html(pickemRow({ nfl: NFL, cfb: CFB, uid: null }), { signedIn: false });
  const hrefs = [...h.matchAll(/<a class="lv-ptile"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(hrefs.length, 2);
  for (const x of hrefs) assert.match(x, /^\/signin\?callbackUrl=/);
  assert.match(hrefs[0], /%2Fpickem%2Fnfl/); assert.match(hrefs[1], /%2Fpickem%2Fcfb/);
  assert.equal(/class="st/.test(h.slice(h.indexOf('lv-pickem'), h.indexOf('data-row="draft"'))), false, 'no pill for a stranger');
});

test('the tiles use the Draft room duo grid, and are not held to its 56px floor', () => {
  const css = readFileSync(path.join(REPO, 'app/games/lobbyV2.css'), 'utf8');
  assert.match(css, /\.lv-duo \{ display: grid; grid-template-columns: 1fr 1fr; gap: 8px; \}/, 'the same grid');
  assert.match(css, /\.lv-duo\.lv-pickem \.lv-ptile \{ min-height: 0; \}/, 'height comes from the two lines');
});

test('the disc is the game mark, and the board name is the label under it', () => {
  const t = tiles(html(pickemRow({ nfl: NFL, cfb: CFB, uid: 1 })));
  for (const [, sport, body] of t) {
    assert.match(body, /<span class="lv-ico">✓<\/span>/, `${sport}: the Pick'em mark, not the board name`);
    assert.equal(/<span class="lv-ico">(NFL|CFB)<\/span>/.test(body), false, 'the name is not said twice');
  }
  assert.match(t[0][2], /<strong>NFL<\/strong>/); assert.match(t[1][2], /<strong>CFB<\/strong>/);
});
