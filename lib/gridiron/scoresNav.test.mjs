// lib/gridiron/scoresNav.test.mjs - /scores navigation: one URL builder,
// full state on every link, no bare internal anchors left on the page.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoresHref, parseScoresParams } from './scoresNav.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// the builder - full state, omitted defaults, round-trips through the parser
// ---------------------------------------------------------------------------

test('a date change carries the sport and the live flag - fix B, forward', () => {
  assert.equal(scoresHref('2026-09-10', { sport: 'cfb', live: true }),
    '/scores?date=2026-09-10&sport=cfb&live=1');
});

test('defaults are omitted - one page, one URL', () => {
  assert.equal(scoresHref('2026-09-10'), '/scores?date=2026-09-10');
  assert.equal(scoresHref('2026-09-10', { sport: 'all', live: false }), '/scores?date=2026-09-10');
  assert.equal(scoresHref(null), '/scores');
});

test('builder and parser round-trip - a link can never produce state the page cannot read', () => {
  for (const q of [{ sport: 'cfb', live: true }, { sport: 'nfl', live: false }, {}]) {
    const href = scoresHref('2026-09-10', q);
    const sp = Object.fromEntries(new URL(href, 'https://x').searchParams);
    const parsed = parseScoresParams(sp);
    assert.equal(parsed.sport, q.sport ?? 'all', JSON.stringify(q));
    assert.equal(parsed.live, q.live ?? false, JSON.stringify(q));
  }
});

test('the parser refuses junk rather than passing it through', () => {
  assert.deepEqual(parseScoresParams({ sport: 'soccer', live: 'yes' }), { sport: 'all', live: false });
  assert.deepEqual(parseScoresParams({}), { sport: 'all', live: false });
  assert.deepEqual(parseScoresParams({ sport: ['cfb'], live: ['1'] }), { sport: 'cfb', live: true });
});

// ---------------------------------------------------------------------------
// the page and the board - soft nav everywhere, state threaded everywhere
// ---------------------------------------------------------------------------

test('NO BARE INTERNAL <a> remains on /scores or the Scoreboard', () => {
  // A plain anchor is a full WKWebView teardown - the glitch class the
  // segment fix killed and the date rail reintroduced by never converting.
  for (const rel of ['app/scores/page.js', 'components/gridiron/Scoreboard.js',
    'components/gridiron/DateRail.js']) {
    assert.ok(!/<a /.test(stripComments(src(rel))), `${rel} still carries a plain <a>`);
  }
});

test('every /scores link routes through scoresHref - no inline query building', () => {
  for (const rel of ['components/gridiron/Scoreboard.js', 'components/gridiron/DateRail.js']) {
    const t = stripComments(src(rel));
    assert.match(t, /scoresHref\(/, `${rel} must use the one builder`);
    assert.ok(!/href=\{`\/scores\?/.test(t), `${rel} builds a /scores URL by hand`);
  }
});

test('the chips carry the date; the reverse of fix B', () => {
  const t = stripComments(src('components/gridiron/Scoreboard.js'));
  assert.match(t, /scoresHref\(date, \{ sport: want, live \}\)/);
  assert.ok(!/useState\('all'\)/.test(t), 'filter state must live in the URL, not the component');
});

test('the date jump is a native input bounded to the slate range', () => {
  const t = stripComments(src('components/gridiron/DateRail.js'));
  assert.match(t, /type="date"/);
  assert.match(t, /min=\{min\}/);
  assert.match(t, /max=\{max\}/);
  assert.match(t, /router\.push\(scoresHref\(v, q\)\)/, 'the jump must preserve filters too');
});

test('the rail signals pending - same-route param navs never remount loading.js', () => {
  const t = stripComments(src('components/gridiron/DateRail.js'));
  assert.match(t, /useLinkStatus/);
  assert.match(t, /useTransition/);
  assert.match(t, /aria-busy/);
});

// ---------------------------------------------------------------------------
// THE SPORTS-DAY LAW (23 Aug: the board rolled to an empty Sunday at
// midnight ET while DAL@ARI was live in Q4)
// ---------------------------------------------------------------------------

const { defaultScoresDate } = await import('./scoresNav.js');

test('before 06:00 ET the default rolls back a day, live or not', () => {
  // 5:00 AM ET on Sun Aug 23 (EDT) = 09:00Z
  assert.equal(defaultScoresDate(new Date('2026-08-23T09:00:00Z')), '2026-08-22');
  // midnight ET exactly
  assert.equal(defaultScoresDate(new Date('2026-08-23T04:00:00Z')), '2026-08-22');
});

test('06:01 ET with nothing live lands on the current ET date', () => {
  assert.equal(defaultScoresDate(new Date('2026-08-23T10:01:00Z')), '2026-08-23');
});

test('a live prior-date game holds the day, whatever the hour', () => {
  assert.equal(
    defaultScoresDate(new Date('2026-08-23T10:30:00Z'), { priorHasLive: true }),
    '2026-08-22',
    'a marathon straggler keeps Saturday past 6 AM');
});

test('an explicit ?date= never reaches the law - the page branch is pinned', async () => {
  const { readFileSync } = await import('node:fs');
  const t = readFileSync(new URL('../../app/scores/page.js', import.meta.url), 'utf8');
  assert.match(t, /DATE_RE\.test\(sp\.date \?\? ''\) \? sp\.date :/,
    'the explicit-date branch bypasses defaultScoresDate entirely');
  assert.match(t, /defaultScoresDate\(new Date\(\), \{ priorHasLive \}\)/);
});
