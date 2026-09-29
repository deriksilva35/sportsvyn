// lib/brand/shellFlip.test.mjs - the app flip (tue-0): ARCADE_SHELL puts the arcade
// palette on the native app only; the web stays dark.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { arcadeOn, arcadeShellOn, arcadeFor, themeColorFor, shellThemeScript, dataTheme, firstPaintColor, THEME_COLOR } from './theme.js';
import { SHELL_COOKIE, SHELL_VALUE } from '../shell/constants.js';

const SHELL = { ARCADE_SHELL: 'on' };
const BOTH = { ARCADE_THEME: 'on', ARCADE_SHELL: 'on' };

test('arcadeOn(req): web + ARCADE_SHELL only -> dark; shell -> arcade; neither -> dark', () => {
  assert.equal(arcadeFor(false, SHELL), false, 'a web request with only ARCADE_SHELL is DARK');
  assert.equal(arcadeFor(true, SHELL), true, 'a shell request with ARCADE_SHELL is ARCADE');
  assert.equal(arcadeFor(true, {}), false, 'neither flag: the shell is dark too');
  assert.equal(arcadeFor(false, {}), false, 'neither flag: the web is dark');
  assert.equal(arcadeFor(false, BOTH), true, 'ARCADE_THEME still flips everything');
  assert.equal(arcadeFor(false, { ARCADE_THEME: 'on' }), true);
  assert.equal(arcadeShellOn({ ARCADE_SHELL: ' ON ' }), true);
  assert.equal(arcadeShellOn({ ARCADE_SHELL: 'yes' }), false, 'only "on" turns it on');
});

test('the deployment-wide values do NOT move with ARCADE_SHELL: <html> is server-rendered dark for everyone', () => {
  assert.equal(arcadeOn(SHELL), false);
  assert.equal(dataTheme(SHELL), undefined);
  assert.equal(firstPaintColor(SHELL), THEME_COLOR.dark);
});

test('the shell bar tint follows the request', () => {
  assert.equal(themeColorFor(true, SHELL), THEME_COLOR.arcade);
  assert.equal(themeColorFor(false, SHELL), THEME_COLOR.dark);
  assert.equal(themeColorFor(true, {}), THEME_COLOR.dark);
});

test('no script at all unless ARCADE_SHELL is on and ARCADE_THEME is not (flag off -> byte-identical HTML)', () => {
  assert.equal(shellThemeScript({}), null);
  assert.equal(shellThemeScript({ ARCADE_THEME: 'on' }), null);
  assert.equal(shellThemeScript(BOTH), null, 'the whole deployment is already arcade');
  assert.equal(typeof shellThemeScript(SHELL), 'string');
});

function runScript(cookie) {
  const dom = new JSDOM('<!doctype html><html style="background-color:#0A0A0A"><head></head><body></body></html>', { url: 'https://sportsvyn.com/games', runScripts: 'outside-only' });
  // One assignment sets ONE cookie; a jar is built cookie by cookie.
  if (cookie) for (const c of cookie.split(/;\s*/)) dom.window.document.cookie = c;
  dom.window.eval(shellThemeScript(SHELL, { cookie: SHELL_COOKIE, value: SHELL_VALUE }));
  const h = dom.window.document.documentElement;
  return { theme: h.getAttribute('data-theme'), bg: h.style.backgroundColor };
}

test('the script: with the shell cookie, data-theme AND the white ground in the same run; without it, nothing', () => {
  assert.deepEqual(runScript(`${SHELL_COOKIE}=${SHELL_VALUE}`), { theme: 'arcade', bg: 'rgb(255, 255, 255)' });
  assert.deepEqual(runScript(`other=1; ${SHELL_COOKIE}=${SHELL_VALUE}; x=2`), { theme: 'arcade', bg: 'rgb(255, 255, 255)' }, 'anywhere in the jar');
  assert.deepEqual(runScript(null), { theme: null, bg: 'rgb(10, 10, 10)' }, 'the web: untouched');
  assert.deepEqual(runScript(`${SHELL_COOKIE}=other`), { theme: null, bg: 'rgb(10, 10, 10)' }, 'a different shell value is not the app');
  assert.deepEqual(runScript(`x${SHELL_COOKIE}=${SHELL_VALUE}`), { theme: null, bg: 'rgb(10, 10, 10)' }, 'a cookie whose name only ENDS in sv_shell is not it');
});

test('the root layout puts the script first in <head>, reads the shell constants, and never reads a cookie itself', () => {
  const src = readFileSync(new URL('../../app/layout.js', import.meta.url), 'utf8');
  assert.match(src, /shellThemeScript\(process\.env, \{ cookie: SHELL_COOKIE, value: SHELL_VALUE \}\)/);
  assert.match(src, /\{shellScript \? \(\s*<head>\s*\{\/\*[^*]*\*\/\}\s*<script id="sv-shell-theme" dangerouslySetInnerHTML=\{\{ __html: shellScript \}\} \/>\s*<\/head>\s*\) : null\}/);
  assert.match(src, /suppressHydrationWarning/);
  assert.equal(/\bcookies\(\)|\bheaders\(\)|resolveShellMode/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), false, 'the root layout stays static');
});

test('/scores asks per request (V4 for the shell under ARCADE_SHELL); /app and the shell viewport tint follow the shell', () => {
  const scores = readFileSync(new URL('../../app/scores/page.js', import.meta.url), 'utf8');
  assert.match(scores, /const arcade = arcadeFor\(isShell\);\s*if \(arcade\) \{/);
  assert.match(scores, /arcade=\{arcade\}/);
  assert.match(readFileSync(new URL('../shell/shell.js', import.meta.url), 'utf8'), /themeColor: themeColorFor\(true\)/);
  assert.match(readFileSync(new URL('../../app/app/layout.js', import.meta.url), 'utf8'), /themeColor: themeColorFor\(true\)/);
});
