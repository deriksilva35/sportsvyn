// lib/daily/shareRoute.test.mjs - the Daily share's three routes (relay mon-19),
// and the guard that none of them is chosen by sniffing the user agent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runShare, withLink } from './shareRoute.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = { name: 'sportsvyn-daily-2026-10-05.png', type: 'image/png' };
const TEXT = 'The Daily · Oct 5 · 2021\n1,900 pts 🔥2\nCan you beat it? sportsvyn.com/daily';
const URL_ = 'https://sportsvyn.com/daily';

function rig({ canShare = null, share = null, bridge = false } = {}) {
  const calls = { canShare: [], share: [], bridge: [], fallback: 0 };
  const nav = {};
  if (canShare) nav.canShare = (p) => { calls.canShare.push(p); return canShare(p); };
  if (share) nav.share = async (p) => { calls.share.push(p); return share(p); };
  const sendShare = (m) => { calls.bridge.push(m); return bridge; };
  const fallback = async () => { calls.fallback += 1; };
  return { calls, args: { file: FILE, text: TEXT, url: URL_, nav, sendShare, fallback } };
}

test('canShare(files) TRUE -> navigator.share with the file and the text (link inside it, no url field); nothing else runs', async () => {
  const { calls, args } = rig({ canShare: () => true, share: () => undefined, bridge: true });
  assert.equal(await runShare(args), 'share');
  assert.deepEqual(calls.canShare[0], { files: [FILE], text: TEXT }, 'feature-tested with the real payload');
  assert.deepEqual(calls.share, [{ files: [FILE], text: TEXT }]);
  assert.equal('url' in calls.share[0], false, 'mon-21: a url beside files posts the link twice on iOS');
  assert.equal(calls.bridge.length, 0);
  assert.equal(calls.fallback, 0);
});

test('withLink: the link appears in the text exactly once', () => {
  assert.equal(withLink(TEXT, URL_), TEXT, 'bare sportsvyn.com/daily already in the text: unchanged');
  assert.equal(withLink('1,900 pts', URL_), `1,900 pts\n${URL_}`, 'missing: appended on its own line');
  assert.equal(withLink(`x ${URL_}`, URL_), `x ${URL_}`, 'https form already present: unchanged');
  assert.equal(withLink('', URL_), URL_);
  assert.equal(withLink('x', ''), 'x');
});

test('canShare FALSE + the shell bridge present -> postMessage { type: share } via sendShare, url + text', async () => {
  const { calls, args } = rig({ canShare: () => false, share: () => undefined, bridge: true });
  assert.equal(await runShare(args), 'bridge');
  assert.equal(calls.share.length, 0, 'no share() when canShare said no');
  assert.deepEqual(calls.bridge, [{ url: URL_, title: TEXT }], "the bridge's own shape: url + title");
  assert.equal(calls.fallback, 0);
});

test('NEITHER (desktop: no canShare, no shell) -> download + copy', async () => {
  const { calls, args } = rig({ bridge: false });
  assert.equal(await runShare(args), 'fallback');
  assert.equal(calls.bridge.length, 1, 'the bridge was asked and declined');
  assert.equal(calls.fallback, 1);
});

test('a cancel is the answer; a refused share falls through so the tap never does nothing', async () => {
  const abort = rig({ canShare: () => true, share: () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } });
  assert.equal(await runShare(abort.args), 'cancelled');
  assert.equal(abort.calls.fallback, 0);
  const refused = rig({ canShare: () => true, share: () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); } });
  assert.equal(await runShare(refused.args), 'fallback');
});

test('no file yet (the card fetch failed) -> canShare is not asked about files; bridge or fallback', async () => {
  const { calls, args } = rig({ canShare: () => true, share: () => undefined, bridge: false });
  assert.equal(await runShare({ ...args, file: null }), 'fallback');
  assert.equal(calls.canShare.length, 0);
  assert.equal(calls.share.length, 0);
});

test('NO UA SNIFFING: the share code never reads the user agent or the app token', () => {
  for (const rel of ['lib/daily/shareRoute.js', 'components/daily/season/DailyShare.js', 'lib/shell/bridge.js']) {
    const code = readFileSync(path.join(REPO, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /userAgent/i, `${rel} reads the user agent`);
    assert.doesNotMatch(code, /SportsvynApp/, `${rel} checks the app UA token`);
    assert.doesNotMatch(code, /APP_UA|appendUserAgent/, `${rel} reaches for the UA constant`);
  }
  const btn = readFileSync(path.join(REPO, 'components/daily/season/DailyShare.js'), 'utf8');
  assert.match(btn, /import \{ sendShare \} from '@\/lib\/shell\/bridge'/, 'the bridge is the existing one, not a second channel');
});
