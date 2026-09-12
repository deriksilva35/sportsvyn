// components/games/lobbyStrip.test.mjs - the Tonight strip, rendered.
// ONE DERIVED ABBREVIATION ACROSS BOTH SURFACES (relay addendum): a side with
// no abbreviation reads the same three letters on the lobby strip as on a
// Scores card, on the mark and in the 44px column.
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
const LINK = path.join(__dirname, '__link_stub_strip.mjs');
const NAV = path.join(__dirname, '__nav_stub_strip.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/link') return { url: pathToFileURL(LINK).href, shortCircuit: true };
  if (spec === 'next/navigation') return { url: pathToFileURL(NAV).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, renderToStaticMarkup, LobbyV2;
before(async () => {
  writeFileSync(LINK, "import React from 'react'; export default function Link({ href, children, ...rest }) { return React.createElement('a', { ...rest, href: String(href) }, children); }\n");
  writeFileSync(NAV, "export function useRouter() { return { refresh() {}, push() {} }; }\n");
  React = await import('react');
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  LobbyV2 = (await import('./LobbyV2.js')).default;
});
after(() => { for (const f of [LINK, NAV]) { try { unlinkSync(f); } catch { /* gone */ } } });

// Sacred Heart at Massachusetts: the visitor carries no abbreviation and no
// colours, which is the real FCS row this came from.
const strip = (over = {}) => ({
  id: 1, slug: 'cfb-2026-reg-w2-sacred-heart-massachusetts', leagueSlug: 'cfb', week: 2,
  status: 'scheduled', kickoffAt: '2026-09-13T17:00:00Z',
  home: { name: 'Massachusetts', shortName: 'Massachusetts', abbreviation: 'MASS', colors: { primary: '#881C1C', secondary: '#FFFFFF' }, score: null },
  away: { name: 'Sacred Heart', shortName: 'Sacred Heart', abbreviation: null, colors: null, score: null },
  liveLabel: null, network: null, spreadHome: null, myPick: null, href: '/cfb/game/x', ...over,
});
const v = (over = {}) => ({
  now: '2026-09-12T20:00:00Z', week: 2, streak: 0, handle: null,
  intro: { open: 'One board open.', lock: null, live: 0 },
  daily: { key: 'daily', tag: 'Daily', title: 'The Daily', href: '/daily/board', description: 'd', edition: 'Edition 1', closesAt: null, state: 'play', cta: 'Play', stats: [], timeLeft: null },
  weekly: { key: 'weekly', tag: 'Weekly', title: 'The Weekly', href: '/weekly', description: 'w', state: 'unset', sub: 'Week 1', cta: 'Set your six', stats: [], locksAt: null },
  pickem: { key: 'pickem', title: "Pick'em", glyph: '✓', href: '/pickem/cfb', lines: [], pill: null },
  draft: { key: 'draft', title: 'The Draft', glyph: '12', href: '/draft', lines: [], pill: null },
  tonight: [strip()], read: null, ...over,
});
const html = (props = {}) => renderToStaticMarkup(React.createElement(LobbyV2, { v: v(), signedIn: false, isShell: false, leagues: [], ...props }));

test('a side with no abbreviation renders the DERIVED three letters on the strip, on the mark and in the column', () => {
  const h = html();
  const rows = h.split('<div class="lv-team').slice(1);
  assert.equal(rows.length, 2, 'two team rows');
  // away first for a gridiron game; the visitor is the one with no abbreviation
  assert.match(rows[0], /<span class="ab">SAC<\/span>/, 'the column carries the derived abbr');
  assert.doesNotMatch(rows[0], /<span class="ab">Sacred Heart<\/span>/, 'never the full name in the abbr slot');
  assert.match(rows[0], /data-teammark="abbr"[^>]*aria-label="Sacred Heart"[^>]*>SAC</, 'the mark carries it too');
  // the name itself still reads in full, beside the column
  assert.match(rows[0], /<\/span><span>Sacred Heart<\/span>/);
  // a side that HAS one is untouched
  assert.match(rows[1], /<span class="ab">MASS<\/span>/);
  assert.match(rows[1], /data-teammark="circle"/, 'a coloured side still draws the split circle');
});

test('the derived abbr is at most three characters, so the 44px column cannot wrap the row', () => {
  const h = html();
  const abbrs = [...h.matchAll(/<span class="ab">([^<]*)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(abbrs, ['SAC', 'MASS']);
  for (const a of abbrs) assert.ok(a.length <= 4, `${a} is short enough for the column`);
  // the derived one specifically is three letters, uppercase
  assert.match(abbrs[0], /^[A-Z]{3}$/);
  // and the column is the fixed-width mono slot it has always been
  const css = readFileSync(path.join(REPO, 'app/games/lobbyV2.css'), 'utf8');
  assert.match(css, /\.lv-team \.ab \{ font: 700 12px var\(--font-mono\); color: var\(--muted\); width: 44px; \}/);
});

test('BOTH SURFACES DERIVE THE SAME LETTERS - one helper, no second rule', () => {
  const lobby = readFileSync(path.join(REPO, 'components/games/LobbyV2.js'), 'utf8');
  const scores = readFileSync(path.join(REPO, 'components/scores/ScoresV2.js'), 'utf8');
  for (const [name, t] of [['LobbyV2', lobby], ['ScoresV2', scores]]) {
    assert.match(t, /abbrOf/, `${name} must derive through the helper`);
    assert.match(t, /from '@\/lib\/gridiron\/scoresV2Shape'/, `${name} must import it from the one place`);
  }
  // the lobby reader hands over the RAW abbreviation, nulls included, so the
  // helper - not the SQL - decides what a missing one becomes
  const reader = readFileSync(path.join(REPO, 'lib/games/lobbyV2.js'), 'utf8');
  assert.match(reader, /abbreviation: r\.home_abbr \?\? null/);
  assert.match(reader, /abbreviation: r\.away_abbr \?\? null/);
  assert.doesNotMatch(reader, /abbr: r\.home_abbr \?\? \(r\.home_short/, 'the old name-into-the-abbr-slot fallback is gone');
});

// ---------------------------------------------------------------------------
// TOP 25 (relay Part B). The AP number reaches the strip from the same reader
// the Scores tab uses, and reaches nothing else.
// ---------------------------------------------------------------------------
test('a ranked CFB side wears its AP number on the strip, an unranked one wears nothing', () => {
  const g = strip({
    home: { name: 'Massachusetts', shortName: 'Massachusetts', abbreviation: 'MASS', colors: { primary: '#881C1C', secondary: '#FFFFFF' }, score: null, rank: null },
    away: { name: 'Sacred Heart', shortName: 'Sacred Heart', abbreviation: null, colors: null, score: null, rank: 14 },
  });
  const rows = html({ v: v({ tonight: [g] }) }).split('<div class="lv-team').slice(1);
  assert.match(rows[0], /<span><span class="rk">14<\/span>Sacred Heart<\/span>/, 'the badge leads the name');
  assert.doesNotMatch(rows[1], /class="rk"/, 'the unranked side has no badge');
});

test('ties keep their number: two sides both at 14 both read 14 (R2)', () => {
  const g = strip({
    home: { name: 'Massachusetts', shortName: 'Massachusetts', abbreviation: 'MASS', colors: null, score: null, rank: 14 },
    away: { name: 'Sacred Heart', shortName: 'Sacred Heart', abbreviation: null, colors: null, score: null, rank: 14 },
  });
  const nums = [...html({ v: v({ tonight: [g] }) }).matchAll(/<span class="rk">(\d+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(nums, ['14', '14'], 'no de-duplication, no 14a/14b');
});

test('an NFL game on the strip never carries a badge', () => {
  const g = strip({
    leagueSlug: 'nfl',
    home: { name: 'Titans', shortName: 'Titans', abbreviation: 'TEN', colors: null, score: null, rank: null },
    away: { name: 'Broncos', shortName: 'Broncos', abbreviation: 'DEN', colors: null, score: null, rank: null },
  });
  assert.doesNotMatch(html({ v: v({ tonight: [g] }) }), /class="rk"/);
});

test('the strip badge has a rule of its own - /games does not load gridiron.css', () => {
  const css = readFileSync(path.join(REPO, 'app/games/lobbyV2.css'), 'utf8');
  assert.match(css, /\.lv-team \.rk \{/, 'the badge is styled on this surface');
  assert.match(css, /background: var\(--volt\)/);
  const page = readFileSync(path.join(REPO, 'app/games/page.js'), 'utf8');
  assert.equal(/gridiron\.css/.test(page), false, 'which is why the rule cannot be borrowed');
});
