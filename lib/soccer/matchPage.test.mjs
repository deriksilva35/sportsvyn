// lib/soccer/matchPage.test.mjs - the match page after the World Cup.
//
// Every pin here exists because a tournament-shaped assumption survived into
// a league season and rendered as a confident lie: a crumb naming the wrong
// competition, a stage strip calling a Premier League fixture a friendly, and
// panels promising copy that a gated league can never receive.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const PAGE = 'app/match/[slug]/page.js';

test('THE CRUMB IS DERIVED - no hardcoded competition survives', () => {
  const t = src(PAGE);
  const crumb = t.slice(t.indexOf('<div className="breadcrumb">'), t.indexOf('<KickoffWatcher'));
  assert.ok(!/FIFA World Cup/.test(crumb), 'the hardcoded tournament is gone');
  assert.match(crumb, /\{match\.league_name \?\? 'Football'\}/, 'the league names itself');
  assert.match(crumb, /href=\{leagueHref\}/);
  // The query has to actually carry the name, or the crumb renders the
  // fallback for every match on the platform.
  assert.match(t, /l\.name\s+AS league_name/);
  assert.match(t, /const LEAGUE_INDEX = \{/);
  assert.match(t, /epl: '\/epl\/standings'/);
  assert.match(t, /\?\? '\/scores'/, 'a league with no index still has a destination');
});

test("a league season has MATCHWEEKS - 'Friendly' stops being the default", () => {
  const t = src('components/match/MatchMetaStrip.js');
  assert.match(t, /match\?\.week != null \? `Matchweek \$\{match\.week\}` : 'Friendly'/);
  // and the page must pass the week through, or the strip falls back forever
  assert.match(src(PAGE), /m\.week\s+AS week/);
});

test('GATED = ABSENT, EMPTY = HONEST EMPTY STATE - the distinction, pinned', () => {
  const t = src(PAGE);
  assert.match(t, /const aiAllowed = contentAllowedForLeague\(match\.league_slug\)/);
  // The three model-fed panels vanish entirely on a gated league.
  for (const panel of ['PreviewLeft', 'WatchScoreVertical', 'EdgePick']) {
    const re = new RegExp(`aiAllowed \\? <${panel}[^>]*\\/> : null`);
    assert.match(t, re, `${panel} must be ABSENT when the model is gated, not empty`);
  }
  // WhereToWatch is fed by a provider read that is NOT gated - it keeps its
  // honest empty state and must not be hidden.
  // Slice between markers that exist ONLY in the body - '<PowerRankingsCompare'
  // with its bracket, not the bare name, which also matches the import above.
  const preview = t.slice(t.indexOf('preview-twocol-right'), t.indexOf('<PowerRankingsCompare'));
  assert.ok(preview.length > 0 && preview.length < 2000, 'the slice found the panel, not the file');
  assert.match(preview, /<WhereToWatch broadcasters=\{broadcasters\} \/>/);
  assert.ok(!/aiAllowed \? <WhereToWatch/.test(t), 'an empty provider read is not a gated one');
});

test('the promise strings only exist inside panels that can be gated away', () => {
  // If any of these moved into an always-rendered component, a gated league
  // would start promising again - so the strings are pinned to their homes.
  assert.match(src('components/match/PreviewLeft.js'), /analyst pass runs/);
  assert.match(src('components/match/WatchScoreVertical.js'), /analyst pass runs/);
  // ...and the Key Moments marker follows its gloss (yesterday's fix).
  assert.match(src('components/match/KeyMoments.js'), /rows\.some\(\(r\) => r\.gloss\) &&/);
});

test('the tab row keeps its scroll and gains the affordance it lacked', () => {
  const css = src('app/match/[slug]/match.css');
  // The scroll behaviour is untouched - the iOS handling above it is
  // load-bearing and this relay must not have traded it for ellipsis.
  assert.match(css, /\.tab-bar \{[\s\S]*overflow-x: auto;/);
  assert.match(css, /-webkit-overflow-scrolling: touch;/);
  // The fade tells the reader there is more to the right; no label is
  // truncated, so every tab stays fully readable once scrolled to.
  assert.match(css, /@media \(max-width: 720px\) \{\s*\.tab-bar \{\s*-webkit-mask-image: linear-gradient\(to right/);
});

test('NO OTHER WORLD CUP HARDCODE renders on a match page', () => {
  const t = src(PAGE);
  // Comments may discuss the tournament; rendered strings and hrefs may not.
  const hrefs = [...t.matchAll(/href=["'{]([^"'}]+)/g)].map((m) => m[1]);
  assert.ok(!hrefs.some((h) => h.includes('world-cup')), 'no WC href in the page');
  const strings = [...t.matchAll(/>([^<>{}\n]*(?:World Cup|FIFA|Tournament)[^<>{}\n]*)</g)];
  assert.equal(strings.length, 0, `rendered WC language: ${strings.map((m) => m[1]).join(' | ')}`);
});
