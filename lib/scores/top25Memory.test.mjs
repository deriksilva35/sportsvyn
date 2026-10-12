import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wantTop25, top25CookieString, TOP25_COOKIE } from './top25Memory.js';
import { parseV4 } from './v4.js';

test('the URL wins; the cookie speaks only when the URL is silent', () => {
  assert.equal(wantTop25('1', '0'), true);
  assert.equal(wantTop25('0', '1'), false);
  assert.equal(wantTop25(undefined, '1'), true);
  assert.equal(wantTop25(undefined, null), false);
  assert.equal(wantTop25(undefined, '0'), false);
});

test('parseV4 carries the remembered choice, and the round trip is unchanged without one', () => {
  assert.equal(parseV4({}, '1').top25, true);
  assert.equal(parseV4({ top25: '0' }, '1').top25, false);
  assert.equal(parseV4({}).top25, false);
  assert.equal(parseV4({ top25: '1' }).top25, true);
});

test('the cookie string is site-wide and a year long', () => {
  assert.equal(top25CookieString(true), `${TOP25_COOKIE}=1; Path=/; Max-Age=31536000; SameSite=Lax`);
  assert.match(top25CookieString(false), /^sv_top25=0;/);
});

test('both Scores surfaces use the remembering link, and the page reads the cookie', () => {
  const v4 = readFileSync(new URL('../../components/scores/ScoreboardV4.js', import.meta.url), 'utf8');
  const v2 = readFileSync(new URL('../../components/scores/ScoresV2.js', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../../app/scores/page.js', import.meta.url), 'utf8');
  assert.match(v4, /<Top25Link next=\{!v\.top25\}[^>]*data-chip="top25"/);
  assert.match(v2, /<Top25Link next=\{!v\.top25\}/);
  assert.match(page, /parseV4\(sp, rememberedTop25\)/);
  assert.match(page, /wantTop25\(one\(sp\.top25\), rememberedTop25\)/);
});

test('the front page CFB band hands AP ranks to the slate rows; badge only when ranked', () => {
  const row = readFileSync(new URL('../../components/slate/SlateRow.js', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../../app/page.js', import.meta.url), 'utf8');
  assert.match(row, /ranks\.get\(t\.id\) \?\? null/);
  assert.match(row, /!= null \? <span className="rk">/);
  assert.match(page, /ranks=\{isCfb \? cfbRanks : null\}/);
  assert.match(page, /currentApRanks/);
});
