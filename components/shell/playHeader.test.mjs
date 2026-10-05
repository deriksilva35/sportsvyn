// components/shell/playHeader.test.mjs - THE PLAY LOBBY'S LOCKUP HEADER (mon-15).
//
// /games, and only /games, draws the app header centred: the mark ~34px, the
// caps tagline under it, the avatar (or SIGN IN) pinned right so the mark stays
// centred, the safe-area inset on top. Every other route keeps the slim
// left-aligned header - pinned by headerLogo.test.mjs, which this branch leaves
// untouched, and by the scoping check below: nothing in the play sheet can
// reach a header that is not .gh--play.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPlayHeaderPath } from '../../lib/shell/playHeader.js';
import { TAGLINE_CAPS } from '../../lib/brand/tagline.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (p) => readFileSync(path.join(REPO, p), 'utf8');
const css = (p) => src(p).replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (sheet, sel) => {
  const re = new RegExp(`(?:^|[}\\s])${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm');
  const m = sheet.match(re);
  assert.ok(m, `no rule for ${sel}`);
  return m[1];
};
// HeaderWordmark.js is JSX (no loader under node --test): read its em height from the source.
const WORDMARK_EM = Number(src('components/brand/HeaderWordmark.js').match(/export const WORDMARK_EM = ([\d.]+);/)[1]);
const decl = (body, prop) => body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`))?.[1].trim();

test('ONLY THE PLAY LOBBY gets the lockup header', () => {
  assert.equal(isPlayHeaderPath('/games'), true);
  assert.equal(isPlayHeaderPath('/games/'), true);
  for (const p of ['/', '/rankings', '/scores', '/you', '/games/how-it-works', '/gamesx', '/signin', '', null, undefined]) {
    assert.equal(isPlayHeaderPath(p), false, String(p));
  }
});

test('AppHeader: the play class and the tagline only on the play route; the slim header otherwise', () => {
  const s = src('components/shell/AppHeader.js');
  assert.match(s, /const play = isPlayHeaderPath\(pathname\);/);
  assert.match(s, /<header className=\{play \? 'gh gh--app gh--play' : 'gh gh--app'\}>/);
  assert.match(s, /\{play && <span className="gh-play-tag">\{TAGLINE_CAPS\}<\/span>\}/);
  // mark, then tagline, then the right edge
  const mark = s.indexOf('className="gh-app-mark"');
  const tag = s.indexOf('className="gh-play-tag"');
  assert.ok(mark > -1 && mark < tag && tag < s.indexOf('className="gh-app-me"'));
  assert.equal(TAGLINE_CAPS, 'THE ARCADE OF SPORTS');
});

test('THE GEOMETRY: centred column, ~34px mark, safe-area top, right edge pinned', () => {
  const sheet = css('components/shell/playHeader.css');
  const head = rule(sheet, 'header.gh.gh--app.gh--play');
  assert.equal(decl(head, 'flex-direction'), 'column');
  assert.equal(decl(head, 'align-items'), 'center');
  assert.equal(decl(head, 'position'), 'relative');
  assert.match(decl(head, 'padding'), /^calc\(14px \+ env\(safe-area-inset-top\)\) 64px 12px$/);
  const px = Number(decl(head, 'font-size').replace('px', ''));
  assert.ok(Math.abs(px * WORDMARK_EM - 34) <= 1, `mark is ${px * WORDMARK_EM}px tall`);
  const tag = rule(sheet, '.gh--play .gh-play-tag');
  assert.equal(decl(tag, 'font-family'), 'var(--font-rubik-mono), ui-monospace, monospace');
  assert.equal(decl(tag, 'font-size'), '9px');
  assert.equal(decl(tag, 'letter-spacing'), '0.22em');
  assert.equal(decl(tag, 'color'), 'var(--tok-muted)');
  const right = rule(sheet, '.gh--play .gh-app-signin');
  assert.equal(decl(right, 'position'), 'absolute');
  assert.equal(decl(right, 'right'), '16px');
  assert.equal(decl(right, 'top'), 'calc(50% + env(safe-area-inset-top) / 2)');
  assert.match(sheet, /\.gh--play \.gh-app-me,\s*\.gh--play \.gh-app-signin\s*\{/, 'avatar and SIGN IN share the pin');
  assert.equal(decl(rule(sheet, '.gh--play .gh-app-me .in'), 'width'), '44px');
});

test('THE PLAY SHEET REACHES NO OTHER HEADER: every selector is scoped to .gh--play, tokens only', () => {
  const sheet = css('components/shell/playHeader.css');
  const sels = [...sheet.matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1].split(',').map((x) => x.trim())).filter(Boolean);
  assert.ok(sels.length >= 5);
  for (const sel of sels) assert.match(sel, /\.gh--play\b/, `unscoped selector: ${sel}`);
  assert.doesNotMatch(sheet, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, 'no colour literal');
  assert.match(src('components/shell/AppHeader.js'), /import '\.\/playHeader\.css';/);
});
