// components/appstore/appBanner.test.mjs — the get-the-app banner.
//
// Three things must hold, and only one of them is a style question:
//
//   1. FLAG-GATING. APP_STORE_URL is empty in Vercel until Apple approves
//      Draftvyn. Until then this feature must be invisible everywhere, and a
//      malformed value must fail closed rather than ship a bad outbound link.
//   2. SHELL-NEVER. The app must not advertise itself. This is the same class of
//      rule as shellPurchase.test.mjs guards for 3.1.1, and it fails the same
//      way: a host page that forgets to pass `shell` renders a store link inside
//      the container, and nobody notices until a reviewer taps it.
//   3. DISMISS. It persists, and a browser that refuses localStorage does not
//      take the page down with it.
//
// TWO LAYERS, as with shellPurchase.test.mjs: the pure decision module is
// exercised directly, and the wiring - which is JSX, and cannot be rendered under
// node --test because of the @/ alias - is read as source. Layer 2 is blunt, and
// it is the layer that catches the failure that actually happens: a new /sim page
// that mounts the banner and forgets the prop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_STORE_URL_ENV, APP_BANNER_DISMISS_KEY, APP_BANNER_DISMISSED,
  normalizeAppStoreUrl, appStoreUrl, shouldShowAppBanner,
} from '../../lib/appBanner.js';
import { APP_BANNER } from './appBannerCopy.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const REAL_URL = 'https://apps.apple.com/us/app/draftvyn/id6740000000';

// Drop comments so source assertions read CODE, not prose. Line comments are
// matched only at the start of a line (after whitespace) on purpose: a blanket
// `//` strip would eat the rest of any line containing an https:// literal, which
// is exactly what these tests are looking for.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Every .js under app/ and components/ — used to prove no surface mounts the
// banner without a shell gate, including ones added after this suite was written.
function walk(dir, out = []) {
  for (const entry of readdirSync(path.join(REPO, dir))) {
    const rel = path.posix.join(dir, entry);
    if (statSync(path.join(REPO, rel)).isDirectory()) walk(rel, out);
    else if (entry.endsWith('.js')) out.push(rel);
  }
  return out;
}
const SOURCE_FILES = [...walk('app'), ...walk('components')];

// ---------------------------------------------------------------------------
// 1. FLAG-GATING — APP_STORE_URL
// ---------------------------------------------------------------------------

test('the flag ships DARK: no env value means no banner anywhere', () => {
  for (const env of [{}, { [APP_STORE_URL_ENV]: '' }, { [APP_STORE_URL_ENV]: '   ' }]) {
    assert.equal(appStoreUrl(env), null, `env ${JSON.stringify(env)} produced a URL`);
    assert.equal(shouldShowAppBanner({ shell: false, url: appStoreUrl(env) }), false);
  }
  // undefined env object must not throw - a server render with no env at all is
  // a "no banner", not a 500 on the homepage.
  assert.equal(appStoreUrl(undefined), null);
});

test('a real App Store listing turns it on', () => {
  assert.equal(appStoreUrl({ [APP_STORE_URL_ENV]: REAL_URL }), REAL_URL);
  assert.equal(shouldShowAppBanner({ shell: false, url: REAL_URL }), true);
  // Surrounding whitespace is the single likeliest paste error; it should work.
  assert.equal(appStoreUrl({ [APP_STORE_URL_ENV]: `  ${REAL_URL}\n` }), REAL_URL);
});

test('a malformed or off-host value fails CLOSED, never to a wrong link', () => {
  const BAD = [
    'apps.apple.com/us/app/draftvyn/id1',   // no scheme
    'http://apps.apple.com/us/app/x/id1',   // not https
    'https://example.com/draftvyn',         // not Apple
    'https://apps.apple.com.evil.test/x',   // lookalike host
    'https://play.google.com/store/apps',   // right idea, wrong store
    'TODO', 'null', 'undefined', 'true',    // placeholder values people type
    '/sim',                                 // a relative path is not a listing
  ];
  for (const raw of BAD) {
    assert.equal(normalizeAppStoreUrl(raw), null, `accepted bad value: ${raw}`);
    assert.equal(shouldShowAppBanner({ shell: false, url: raw }), false, `showed for: ${raw}`);
  }
  // Non-strings (a mis-typed env shim) must not throw either.
  for (const raw of [null, undefined, 42, {}, []]) {
    assert.equal(normalizeAppStoreUrl(raw), null);
  }
});

test('the legacy itunes.apple.com host still resolves', () => {
  // Apple 301s these to apps.apple.com; an older listing URL should not be
  // treated as a typo and silently dropped.
  assert.ok(normalizeAppStoreUrl('https://itunes.apple.com/us/app/draftvyn/id1'));
});

test('the flag is a SERVER env var, not a NEXT_PUBLIC_ one', () => {
  // NEXT_PUBLIC_ is inlined into the client bundle at build time, which would
  // freeze the on/off state into a build artifact and publish the URL early.
  assert.equal(APP_STORE_URL_ENV, 'APP_STORE_URL');
  assert.ok(!APP_STORE_URL_ENV.startsWith('NEXT_PUBLIC_'));
  // The client island must never reach for the environment itself.
  assert.ok(!stripComments(src('components/appstore/AppBanner.js')).includes('process.env'),
    'the client component reads process.env');
  // ...and the server wrapper must not be a client component, or the env read
  // moves into the browser where it resolves to undefined.
  assert.ok(!/['"]use client['"]/.test(stripComments(src('components/appstore/GetTheAppBanner.js'))),
    'GetTheAppBanner is a client component; the env read must stay on the server');
});

// ---------------------------------------------------------------------------
// 2. SHELL-NEVER — the app must not advertise itself
// ---------------------------------------------------------------------------

test('shell suppresses the banner even with a perfectly valid URL', () => {
  assert.equal(shouldShowAppBanner({ shell: true, url: REAL_URL }), false);
  assert.equal(shouldShowAppBanner({ shell: true, url: null }), false);
  // Truthy non-boolean shell values (a prop threaded as a string or object)
  // must suppress too - failing open here is the expensive direction.
  for (const shell of ['sim-app', 1, {}]) {
    assert.equal(shouldShowAppBanner({ shell, url: REAL_URL }), false, `shell=${String(shell)} rendered`);
  }
  // Defaults: called with nothing at all, it stays dark.
  assert.equal(shouldShowAppBanner(), false);
});

test('the shell check precedes the flag check in the decision', () => {
  const s = src('lib/appBanner.js');
  const fn = s.slice(s.indexOf('export function shouldShowAppBanner'));
  assert.ok(fn.indexOf('if (shell) return false') < fn.indexOf('normalizeAppStoreUrl'),
    'shell must be checked before the URL, so no flag value can enable it in the app');
});

test('the server wrapper renders nothing before handing the URL to the client', () => {
  const s = src('components/appstore/GetTheAppBanner.js');
  assert.match(s, /shouldShowAppBanner/, 'wrapper must use the shared decision');
  assert.ok(s.indexOf('shouldShowAppBanner') < s.indexOf('<AppBanner'),
    'the gate must run before the client island is constructed');
  assert.match(s, /return null/, 'wrapper must have a null path');
});

test('EVERY surface that mounts the banner passes a shell gate', () => {
  const mounts = SOURCE_FILES.filter((rel) => /<GetTheAppBanner/.test(stripComments(src(rel))));
  assert.ok(mounts.length > 0, 'nothing mounts the banner - the wiring was lost');
  for (const rel of mounts) {
    const s = stripComments(src(rel));
    assert.match(s, /resolveShellMode/,
      `${rel} mounts the banner but never resolves shell mode`);
    for (const m of s.matchAll(/<GetTheAppBanner([^>]*)>/g)) {
      assert.match(m[1], /shell=\{/, `${rel} mounts <GetTheAppBanner${m[1]}> with no shell prop`);
    }
  }
});

test('the banner is mounted on the sim surfaces and the homepage promo area', () => {
  const EXPECTED = [
    'app/page.js',                 // homepage, beside SimPromoCard
    'app/sim/page.js',             // the lobby
    'app/sim/tracker/page.js',
    'app/sim/history/page.js',
    'app/sim/account/page.js',
    'app/sim/draft/[id]/page.js',  // results / abandoned only - see below
  ];
  for (const rel of EXPECTED) {
    assert.match(src(rel), /<GetTheAppBanner/, `${rel} lost its banner`);
  }
  // Homepage placement: in the promo card area, not floating elsewhere.
  const home = src('app/page.js');
  assert.ok(Math.abs(home.indexOf('<SimPromoCard') - home.indexOf('<GetTheAppBanner')) < 400,
    'the homepage banner drifted away from the sim promo card area');
});

test('the LIVE draft room gets no banner', () => {
  // A running draft is a locked one-viewport console with a pick clock. The route
  // already suppresses the tab bar there; the banner rides the same predicate.
  const s = src('app/sim/draft/[id]/page.js');
  assert.match(s, /\{showTabBar && <GetTheAppBanner/,
    'the draft route must gate the banner on the same not-in-progress predicate as the tab bar');
  assert.match(s, /const showTabBar = status !== 'in_progress'/,
    'the predicate this depends on changed shape');
  // The live tracker room returns before the shared markup; it must stay clean.
  const trackerRoom = s.slice(s.indexOf("if (status === 'in_progress' && isTrackerDraft)"));
  const afterReturn = trackerRoom.slice(0, trackerRoom.indexOf('let body;'));
  assert.ok(!afterReturn.includes('GetTheAppBanner'), 'the live tracker room renders the banner');
});

test('the native /app wrapper never mounts it', () => {
  // /app is the main Capacitor container. NativeShellCookie marks it as shell, but
  // the cheapest guarantee is that the banner is not in that tree at all.
  for (const rel of SOURCE_FILES.filter((f) => f.startsWith('app/app/'))) {
    assert.ok(!src(rel).includes('GetTheAppBanner'), `${rel} mounts the banner inside the native wrapper`);
  }
});

// ---------------------------------------------------------------------------
// 3. DISMISS
// ---------------------------------------------------------------------------

test('the dismiss key is namespaced and its value is stable', () => {
  // Changing either string silently resurrects the banner for everyone who
  // already dismissed it, so they are pinned.
  assert.equal(APP_BANNER_DISMISS_KEY, 'sv_app_banner');
  assert.equal(APP_BANNER_DISMISSED, 'dismissed');
});

test('dismissal is read on mount, written on click, and never throws', () => {
  const s = src('components/appstore/AppBanner.js');
  assert.match(s, /useSyncExternalStore\(subscribe, isDismissed, isDismissedOnServer\)/,
    'dismissal must be read through the external-store hook, not setState in an effect');
  // The server snapshot must say "dismissed", or the banner lands in the SSR HTML
  // and a reader who dismissed it yesterday watches it flash back in.
  assert.match(s, /const isDismissedOnServer = \(\) => true;/,
    'the server snapshot must render nothing');
  assert.match(s, /getItem\(APP_BANNER_DISMISS_KEY\)/, 'must read the persisted dismissal');
  assert.match(s, /setItem\(APP_BANNER_DISMISS_KEY, APP_BANNER_DISMISSED\)/, 'must persist the dismissal');
  // A same-tab dismiss fires no `storage` event, so the click has to nudge the
  // store itself or the banner stays on screen until navigation.
  assert.match(s, /dispatchEvent\(new Event\(DISMISS_EVENT\)\)/, 'dismiss must notify the store');
  assert.match(s, /addEventListener\('storage'/, 'must react to dismissals in other tabs');
  // Safari private mode THROWS on localStorage access. Both sides need a guard.
  const reads = stripComments(s).split('getItem')[0];
  assert.ok(reads.lastIndexOf('try {') > reads.lastIndexOf('}'), 'the read is not inside a try');
  assert.equal((s.match(/try \{/g) ?? []).length, 2, 'both the read and the write must be guarded');
  // The dismiss control has to be reachable and labelled.
  assert.match(s, /type="button"/, 'dismiss must not submit anything');
  assert.match(s, /aria-label=\{APP_BANNER\.dismissLabel\}/, 'dismiss needs an accessible name');
});

test('the store link opens out and cannot reach back into the page', () => {
  const s = src('components/appstore/AppBanner.js');
  assert.match(s, /rel="noopener noreferrer"/, 'external link needs rel=noopener');
  assert.match(s, /href=\{url\}/, 'the link must use the flag-supplied URL, not a hardcoded one');
  // The URL arrives as a prop from the flag; a literal here would survive the
  // flag being empty and ship a live store link before approval.
  assert.ok(!/apple\.com/.test(stripComments(s)), 'the client component hardcodes a store URL');
});

// ---------------------------------------------------------------------------
// COPY + the mobile-web gate
// ---------------------------------------------------------------------------

test('the copy names the APP, not the publication', () => {
  // The listing is Draftvyn (com.sportsvyn.draftvyn). "Sportsvyn" here would send
  // a reader to the store expecting the site and hand them a draft app.
  assert.match(APP_BANNER.headline, /Draftvyn/);
  assert.ok(!/Sportsvyn/.test(`${APP_BANNER.headline} ${APP_BANNER.line}`));
  assert.match(APP_BANNER.line, /App Store/);
  assert.match(APP_BANNER.line, /Free/);
  assert.equal(APP_BANNER.badgeStore, 'App Store');
});

test('copy uses hyphens only - no em/en dashes (house rule)', () => {
  for (const [k, v] of Object.entries(APP_BANNER)) {
    assert.ok(!/[—–]/.test(v), `em/en dash in APP_BANNER.${k}: ${v}`);
  }
});

test('the banner is mobile-web only, and hidden by DEFAULT', () => {
  const css = src('components/appstore/app-banner.css');
  // Base rule off, media query on - so a lost media query hides it rather than
  // splashing an app-install bar across a desktop editorial page.
  assert.match(css, /\.appbanner \{ display: none; \}/,
    'the base .appbanner rule must be display:none');
  assert.match(css, /@media \(max-width: 767px\)/, 'must switch on below the tablet breakpoint');
  assert.ok(css.indexOf('.appbanner { display: none; }') < css.indexOf('@media'),
    'the off rule must come first');
  // It carries the ink register and the volt accent.
  assert.match(src('components/appstore/AppBanner.js'), /data-surface="ink"/, 'ink register');
  assert.match(css, /border-left: 3px solid var\(--volt\)/, 'volt accent');
});
