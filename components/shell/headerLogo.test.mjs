// components/shell/headerLogo.test.mjs - sun-14: the wordmark LEFT on the
// content edge, 1.4x, in BOTH shared headers (web GlobalHeader, app AppHeader);
// the avatar right with the @handle gone below 430px; SIGN IN on the right when
// signed out; the status-bar inset kept in the app.
//
// Source-level, like the rest of the chrome guards: the geometry is CSS, and
// the shots in the relay are the rendered proof. The content edge is DERIVED
// from the /games stylesheets, never re-typed here, so the header and the PLAY
// title cannot drift apart while this stays green.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (p) => readFileSync(path.join(REPO, p), 'utf8');
const css = (p) => src(p).replace(/\/\*[\s\S]*?\*\//g, '');
const code = (p) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const ruleBody = (sheet, sel) => {
  const re = new RegExp(`(?:^|[}\\s])${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm');
  const m = sheet.match(re);
  assert.ok(m, `no rule for ${sel}`);
  return m[1];
};
const decl = (body, prop) => body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`))?.[1].trim();

const globals = css('app/globals.css');
const rootBlock = globals.match(/:root\s*\{([^}]*--sv-header-left[^}]*)\}/)?.[1] ?? '';

test('THE 1.4x TOKEN, and both headers size the mark from it', () => {
  assert.equal(decl(rootBlock, '--sv-wordmark-scale'), '1.4', 'the scale Derik asked for');
  const chrome = css('components/site-chrome.css');
  // desktop and the collapse - the old 22px and 19px, each times the scale
  assert.equal(decl(ruleBody(chrome, '.gh .wordmark'), 'font-size'), 'calc(22px * var(--sv-wordmark-scale))');
  const collapse = chrome.slice(chrome.indexOf('@media (max-width: 1140px)'));
  assert.equal(decl(ruleBody(collapse, '.gh .wordmark'), 'font-size'), 'calc(19px * var(--sv-wordmark-scale))');
  const app = css('components/shell/apptab.css');
  assert.equal(decl(ruleBody(app, '.gh--app'), 'font-size'), 'calc(17px * var(--sv-wordmark-scale))');
  // A SCALE, NOT A REDRAW: the mark's em height and assets are untouched.
  const hw = code('components/brand/HeaderWordmark.js');
  assert.match(hw, /WORDMARK_EM = 1\.36/);
  assert.match(hw, /padding: tight \? 0 : `\$\{PAD_EM\}em 0`/, 'tight drops only the lockup box');
  assert.match(code('components/GlobalHeader.js'), /<Wordmark href="\/" tight \/>/);
  assert.match(code('components/shell/AppHeader.js'), /<HeaderWordmark display="block" tight \/>/);
});

test('THE LEFT EDGE IS THE PLAY TITLE\'S, derived from the /games sheets', () => {
  // .lob: max-width + horizontal padding; .pl-top: its own horizontal padding.
  const lob = ruleBody(css('app/games/games.css'), '.lob');
  const max = decl(lob, 'max-width');
  const lobPad = Number(decl(lob, 'padding').split(/\s+/)[1].replace('px', ''));
  const plPad = Number(decl(ruleBody(css('components/games/play.css'), '.pl-top'), 'padding').split(/\s+/)[1].replace('px', ''));
  assert.equal(decl(rootBlock, '--sv-content-max'), max, 'the header column is the lobby column');
  assert.equal(decl(rootBlock, '--sv-content-inset'), `${lobPad + plPad}px`, 'and the inset is where PLAY stands');
  assert.equal(decl(rootBlock, '--sv-header-left'),
    'max(var(--sv-content-inset), calc((100% - var(--sv-content-max)) / 2 + var(--sv-content-inset)))');
  // both headers stand on it, at a specificity no chunk order can undo
  const chrome = css('components/site-chrome.css');
  assert.equal(decl(ruleBody(chrome, 'header.gh'), 'padding-left'), 'var(--sv-header-left)');
  const app = css('components/shell/apptab.css');
  assert.equal(decl(ruleBody(app, '.gh.gh--app'), 'padding-left'), 'var(--sv-header-left)');
});

test('THE APP MARK IS LEFT, NOT CENTRED: space-between, the chip in the flow', () => {
  const app = css('components/shell/apptab.css');
  assert.equal(decl(ruleBody(app, '.gh--app'), 'justify-content'), 'space-between');
  const me = ruleBody(app, '.gh-app-me');
  assert.equal(decl(me, 'position'), undefined, 'no absolute chip - nothing has to stay centred now');
  assert.equal(decl(me, 'transform'), undefined);
  // order in the markup: mark first, the right edge after it
  const s = code('components/shell/AppHeader.js');
  const mark = s.indexOf('className="gh-app-mark"');
  assert.ok(mark > -1 && mark < s.indexOf('className="gh-app-me"') && mark < s.indexOf('className="gh-app-signin"'));
});

test('THE STATUS-BAR INSET SURVIVES the web sheet\'s phone padding', () => {
  // site-chrome's `.gh { padding: 12px 16px }` (0,1,0) loaded after apptab.css on
  // /games and replaced the inset with 12px - the mark sat under the clock.
  const app = css('components/shell/apptab.css');
  assert.equal(decl(ruleBody(app, '.gh.gh--app'), 'padding-top'), 'calc(10px + env(safe-area-inset-top))');
});

test('BELOW 430px THE @HANDLE GOES, the avatar stays', () => {
  const app = css('components/shell/apptab.css');
  const m = app.match(/@media \(max-width: 429px\)\s*\{([\s\S]*?\})\s*\}/);
  assert.ok(m, 'a <430px block in apptab.css');
  assert.equal(decl(ruleBody(m[1], '.gh--app .gh-app-me .hn'), 'display'), 'none');
  assert.ok(!/\.gh-app-me \.in[^{]*\{[^}]*display:\s*none/.test(app), 'the avatar is never hidden');
});

test('SIGNED OUT: SIGN IN on the right, from a /api/me that says who is signed in', () => {
  const s = code('components/shell/AppHeader.js');
  assert.match(s, /\{me && !me\.signedIn && !onSignin && \(\s*<Link href=\{shellSigninHref\(pathname, true\)\} className="gh-app-signin">Sign in<\/Link>/);
  assert.match(s, /\{me\?\.signedIn && \(\s*<Link href="\/account" className="gh-app-me"/);
  const app = css('components/shell/apptab.css');
  const btn = ruleBody(app, '.gh-app-signin');
  assert.equal(decl(btn, 'background'), 'var(--tok-action)', 'the action fill, a token in both themes');
  assert.equal(decl(btn, 'color'), 'var(--tok-on-action)');
  const me = code('app/api/me/route.js');
  assert.match(me, /Response\.json\(\{ signedIn: false, handle: null \}\)/);
  assert.match(me, /Response\.json\(\{ signedIn: true, handle: row\?\.handle \?\? null \}\)/);
  // the web header's signed-out SIGN IN stays on the right of its cluster, after the CTA
  const gh = code('components/GlobalHeader.js');
  const right = gh.slice(gh.indexOf('className="gi-head-right gh-right"'));
  assert.ok(right.indexOf('className="gh-cta"') < right.indexOf('className="gh-signin"'));
});
