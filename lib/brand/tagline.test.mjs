// lib/brand/tagline.test.mjs - THE TAGLINE IS "The arcade of sports." (mon-15).
//
// The old line ("... sports games.") is retired EVERYWHERE in this repo. The
// guard asks git for every tracked file that still says it, case-insensitive,
// so a file nobody thought to look in is the file it finds. The only
// exemptions are named below, each with its reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TAGLINE, TAGLINE_CAPS, emailLockupHtml } from './tagline.js';
import { buildWelcomeEmail } from '../emails/welcome.js';
import { buildMagicLinkEmail } from '../emails/magicLink.js';
import { buildConfirmationEmail } from '../emails/confirmation.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// THE EXEMPTIONS. This file (it has to spell the retired line to look for it).
// The App Store subtitle and search keywords are NOT in this repo (App Store
// Connect / the Mac's native repo) and were left untouched by instruction; if
// that metadata is ever checked in here, its path goes in this list - it is the
// one place the old line may stay.
const SELF = 'lib/brand/tagline.test.mjs';
const APP_STORE_EXEMPT = Object.freeze([]);
const RETIRED = ['arcade of sports', 'games'].join(' ');

test('the line, verbatim, and its caps form derived from it', () => {
  assert.equal(TAGLINE, 'The arcade of sports.');
  assert.equal(TAGLINE_CAPS, 'THE ARCADE OF SPORTS');
});

test('THE OLD TAGLINE APPEARS NOWHERE, save the named exemptions', () => {
  let hits = [];
  try {
    hits = execFileSync('git', ['-C', REPO, 'grep', '-l', '-i', '-F', RETIRED], { encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch (e) {
    if (e.status !== 1) throw e; // 1 = no match, which is the pass
  }
  const left = hits.filter((f) => f !== SELF && !APP_STORE_EXEMPT.includes(f));
  assert.deepEqual(left, [], `the retired tagline is still in: ${left.join(', ')}`);
});

test('the site\'s default meta description is the tagline', () => {
  const layout = readFileSync(path.join(REPO, 'app/layout.js'), 'utf8');
  assert.match(layout, /import \{ TAGLINE \} from '@\/lib\/brand\/tagline';/);
  assert.match(layout, /^\s*description: TAGLINE,$/m);
});

test('THE EMAIL LOCKUP: the mark, then the caps line, in every template', () => {
  const lock = emailLockupHtml({ wordmarkUrl: 'https://x.test/wordmark-email.png' });
  assert.ok(lock.indexOf('<img src="https://x.test/wordmark-email.png"') < lock.indexOf(TAGLINE_CAPS));
  assert.match(lock, /font-size:9px;line-height:1;letter-spacing:0\.22em;/);
  assert.match(lock, /font-family:'Rubik Mono One'/);
  const mails = [
    buildWelcomeEmail({ baseUrl: 'https://x.test', unsubscribeUrl: 'https://x.test/u' }).html,
    buildMagicLinkEmail({ url: 'https://x.test/cb', identifier: 'a@example.invalid', code: '123456' }).html,
    buildConfirmationEmail({ confirmUrl: 'https://x.test/c' }).html,
  ];
  for (const html of mails) {
    assert.ok(html.includes(lock), 'the template draws the shared lockup');
    assert.equal(html.split(TAGLINE_CAPS).length - 1, 1, 'once, under the mark');
  }
});

test('THE FOOTERS draw the lockup, not a sentence', () => {
  const f = 'components/SiteFooter.js';
  const s = readFileSync(path.join(REPO, f), 'utf8');
  assert.match(s, /<div className="footer-brand sv-lockup">\s*<Wordmark sizeClassName="text-\[28px\]" \/>\s*<p className="sv-lockup-tag">\{TAGLINE_CAPS\}<\/p>/, f);
  assert.match(s, /import '@\/components\/brand\/lockup\.css';/, f);
  // THE TEAM PAGE USES THE STANDARD FOOTER (mon-16), not its own copy.
  const team = readFileSync(path.join(REPO, 'app/team/[slug]/page.js'), 'utf8');
  assert.match(team, /<SiteFooter \/>/);
  assert.doesNotMatch(team, /<footer className="site-footer">/);
  const lockCss = readFileSync(path.join(REPO, 'components/brand/lockup.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const tag = lockCss.match(/\.sv-lockup-tag\s*\{([^}]*)\}/)[1];
  assert.match(tag, /font-family:\s*var\(--font-rubik-mono\)/);
  assert.match(tag, /font-size:\s*9px/);
  assert.match(tag, /letter-spacing:\s*0\.22em/);
  assert.match(tag, /color:\s*var\(--tok-muted\)/);
  assert.doesNotMatch(lockCss, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, 'tokens only');
});
