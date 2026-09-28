// components/shell/splashReady.test.mjs - the native splash hides AFTER the
// first paint, once, in the shell only, on /games and on /signin alike.
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { install } from '../../lib/testing/nextResolve.mjs';

install();
let React; let act; let createRoot; let SplashReady; let _reset; let dom; let frames; let calls;

function load(url, { shell }) {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  if (shell) dom.window.document.cookie = 'sv_shell=sim-app; path=/';
  frames = []; calls = [];
  dom.window.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
  dom.window.Capacitor = { Plugins: { SplashScreen: { hide: (opts) => { calls.push(opts); } } } };
  _reset();
}
const flushFrame = () => { const q = frames.splice(0); for (const cb of q) cb(0); };
function mount() {
  const root = createRoot(document.getElementById('root'));
  act(() => root.render(React.createElement(SplashReady)));
  return root;
}

before(async () => {
  React = await import('react');
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  const mod = await import('./SplashReady.js');
  SplashReady = mod.default; _reset = mod._resetSplashReady;
});
afterEach(() => { try { dom?.window.close(); } catch { /* gone */ } });

for (const path of ['/games', '/signin']) {
  test(`SHELL ${path}: fires once, and only after two animation frames`, () => {
    load(`https://sportsvyn.com${path}`, { shell: true });
    const root = mount();
    assert.equal(calls.length, 0, 'not on mount - the page has not painted');
    flushFrame();
    assert.equal(calls.length, 0, 'not on the first frame - that callback runs before its paint');
    flushFrame();
    assert.deepEqual(calls, [{ fadeOutDuration: 200 }], 'after the painted frame, once');
    act(() => root.unmount());
    mount(); flushFrame(); flushFrame();
    assert.equal(calls.length, 1, 'a client navigation re-mount does not call it again');
  });
}

test('WEB: never fires, with or without a Capacitor object', () => {
  load('https://sportsvyn.com/games', { shell: false });
  mount(); flushFrame(); flushFrame();
  assert.equal(calls.length, 0);
  assert.equal(frames.length, 0, 'it does not even schedule');
});

test('A BINARY WITHOUT THE PLUGIN is a no-op, not a throw (1.4(1))', () => {
  load('https://sportsvyn.com/games', { shell: true });
  delete dom.window.Capacitor.Plugins.SplashScreen;
  mount();
  assert.doesNotThrow(() => { flushFrame(); flushFrame(); });
});

test('MOUNTED IN THE ROOT LAYOUT, beside ResumeManager - every page, /signin included', () => {
  const layout = readFileSync(new URL('../../app/layout.js', import.meta.url), 'utf8');
  assert.match(layout, /import SplashReady from '@\/components\/shell\/SplashReady';/);
  assert.match(layout, /<ResumeManager \/>[\s\S]{0,200}<SplashReady \/>/);
  const src = readFileSync(new URL('./SplashReady.js', import.meta.url), 'utf8');
  assert.match(src, /Capacitor\?\.Plugins\?\.SplashScreen\?\.hide\?\.\(\{ fadeOutDuration: 200 \}\)/);
  assert.doesNotMatch(src, /from '@capacitor\//, 'no npm dependency');
});
