// lib/shell/laDeepLink.test.mjs - the widget's "Follow on Lock Screen" link (sun-24).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wantsLaPrompt, withoutLaParams, laDeepLinkPath } from './laDeepLink.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIVE = { url: 'https://sportsvyn.com/nfl/game/x', state: {}, final: false, live: true };
const base = { search: '?sv_la=1&sv_match=42', matchId: 42, canBridge: true, liveActivity: LIVE, supported: true };

test('opens: shell + this game + live', () => {
  assert.equal(wantsLaPrompt(base), true);
  assert.equal(wantsLaPrompt({ ...base, search: 'sv_match=42&x=1&sv_la=1' }), true);
});

test('ignored: outside the shell, another game, not live, final, unsupported, bad params', () => {
  assert.equal(wantsLaPrompt({ ...base, canBridge: false }), false, 'outside the shell');
  assert.equal(wantsLaPrompt({ ...base, matchId: 43 }), false, 'the id is not this page\'s game');
  assert.equal(wantsLaPrompt({ ...base, liveActivity: { ...LIVE, live: false } }), false, 'not live (pre-game)');
  assert.equal(wantsLaPrompt({ ...base, liveActivity: { ...LIVE, final: true } }), false, 'final');
  assert.equal(wantsLaPrompt({ ...base, liveActivity: null }), false);
  assert.equal(wantsLaPrompt({ ...base, supported: false }), false, 'basketball has no Activity yet');
  for (const search of ['', '?sv_la=0&sv_match=42', '?sv_la=1', '?sv_la=1&sv_match=42x', '?sv_la=true&sv_match=42']) {
    assert.equal(wantsLaPrompt({ ...base, search }), false, search);
  }
});

test('the params are dropped after, and the widget builds the link one way', () => {
  assert.equal(withoutLaParams('?sv_la=1&sv_match=42'), '');
  assert.equal(withoutLaParams('?a=1&sv_la=1&sv_match=42'), '?a=1');
  assert.equal(laDeepLinkPath('/nfl/game/nyj-at-buf', 9101), '/nfl/game/nyj-at-buf?sv_la=1&sv_match=9101');
  assert.equal(laDeepLinkPath('https://x', 1), null);
});

test('wired: the bell reads it and never starts on its own; every page says whether the game is live', () => {
  const bell = readFileSync(path.join(REPO, 'components/alerts/AlertBell.js'), 'utf8');
  assert.match(bell, /wantsLaPrompt\(\{ search, matchId: match\?\.id, canBridge, liveActivity/);
  const effect = bell.slice(bell.indexOf('wantsLaPrompt({'), bell.indexOf('const toggleLive'));
  assert.doesNotMatch(effect, /startLiveActivity|toggleLive\(/, 'opening the sheet is all it does');
  for (const f of ['app/nfl/game/[slug]/page.js', 'app/cfb/game/[slug]/page.js', 'app/mlb/game/[slug]/page.js', 'lib/gridiron/gamePageAlerts.js']) {
    assert.match(readFileSync(path.join(REPO, f), 'utf8'), /live: (game|g)\.status === 'live'/, f);
  }
});
