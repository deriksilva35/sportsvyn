// components/you/you.test.mjs - the You tab, pressed. Every block, its empty
// state, and both signed-in and signed-out.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const L = path.join(__dirname, '__l_yu.mjs');
const N = path.join(__dirname, '__n_yu.mjs');
const C = path.join(__dirname, '__c_yu.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/link') return { url: pathToFileURL(L).href, shortCircuit: true };
  if (spec === 'next/navigation') return { url: pathToFileURL(N).href, shortCircuit: true };
  if (spec.endsWith('.css')) return { url: pathToFileURL(C).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, render, You;
before(async () => {
  writeFileSync(L, "import React from 'react'; export default function Link({ href, children, ...rest }) { return React.createElement('a', { ...rest, href: String(href) }, children); }\n");
  writeFileSync(N, "export function usePathname(){ return '/you'; }\n");
  writeFileSync(C, 'export default {};\n');
  React = await import('react');
  ({ renderToStaticMarkup: render } = await import('react-dom/server'));
  You = (await import('./You.js')).default;
});
after(() => { for (const f of [L, N, C]) { try { unlinkSync(f); } catch { /* gone */ } } });

const dots = (spec) => spec.split('').map((c, i) => ({
  day: `2026-09-${String(i + 1).padStart(2, '0')}`,
  letter: 'MTWTFSS'[i % 7],
  state: c === 'p' ? 'played' : c === 'd' ? 'dnf' : 'unplayed',
}));
const base = (over = {}) => ({
  signedIn: true, build: 'abc1234',
  me: { handle: 'sportsvyn_og', display: '@sportsvyn_og', initial: 'S', since: 'June 2026', zone: 'Pacific', handleChanged: true, emailMasked: 'd***@gmail.com' },
  daily: { dots: dots('ppdpuppppppppu'), days: 14, dnf: 1, playedInWindow: 11, boards: 44, best: 1868.9, streak: 12, bestStreak: 31 },
  season: [
    { key: 'daily', glyph: 'D', title: 'The Daily', sub: '44 boards', rank: 18, of: 1204, note: null, href: '/rankings?view=people&game=daily' },
    { key: 'pickem', glyph: 'P', title: "Pick'em", sub: 'NFL 1-1 · CFB 7-0', rank: 1, of: 3, value: '94.7%', note: null, href: '/rankings?view=people&game=pickem' },
    { key: 'draft', glyph: '12', title: 'The Draft', sub: '1 room', rank: null, of: null, note: 'ranks after 2', href: '/rankings?view=people&game=draft' },
  ],
  follows: { teams: [{ id: 1, slug: 'ole-miss', name: 'Ole Miss', fullName: 'Ole Miss', abbreviation: 'MISS', colors: {}, leagueSlug: 'cfb', leagueName: 'CFB' }], cap: 5, counts: [{ league: 'cfb', label: 'CFB', n: 1 }], capLine: '2 of 5 NFL, 1 of 5 CFB' },
  alerts: { push: { choice: 'enabled', on: true, devices: 1, where: 'ios' }, games: { count: 4, sends: ['kickoff', 'score', 'final'], sendLine: 'kickoff, score, final' }, email: { optedOut: false } },
  membership: { member: true, kind: 'pass', verb: 'Through', date: 'Feb 16, 2027' },
  ...over,
});
const html = (v, props = {}) => render(React.createElement(You, { v, ...props }));
const sections = (h) => [...h.matchAll(/data-section="(\w+)"/g)].map((m) => m[1]);

test('SIGNED IN: every block, in the mock order', () => {
  const h = html(base());
  assert.deepEqual(sections(h), ['identity', 'streak', 'dots', 'season', 'teams', 'alerts', 'membership', 'settings']);
  assert.match(h, /data-signed-in="1"/);
});

test('SIGNED OUT: the pitch, the promises, and no personal block', () => {
  const h = html({ signedIn: false }, { signinHref: '/signin?callbackUrl=%2Fyou' });
  assert.deepEqual(sections(h), ['signedout', 'promises']);
  assert.match(h, /data-signed-in="0"/);
  assert.match(h, /<h2>You<\/h2>/);
  assert.match(h, /All of it starts with a handle/);
  assert.equal((h.match(/href="\/signin\?callbackUrl=%2Fyou"/g) ?? []).length, 2, 'both CTAs go to sign-in');
  assert.match(h, /A rank in four games/);
  // Not a redirect and not an empty shell: a stranger sees what it is for.
  for (const s of ['identity', 'streak', 'dots', 'season', 'teams', 'alerts', 'membership', 'settings']) {
    assert.equal(h.includes(`data-section="${s}"`), false, `${s} must not render signed out`);
  }
});

test('IDENTITY: the zone is the device\'s, and member-since only when known', () => {
  assert.match(html(base()), /<div class="yu-sub">Member since June 2026 · Pacific<\/div>/);
  // users.created_at is null for the accounts predating migration 058 - the
  // line drops the clause rather than inventing a date.
  const noSince = html(base({ me: { ...base().me, since: null } }));
  assert.match(noSince, /<div class="yu-sub">Pacific<\/div>/);
  assert.equal(/Member since/.test(noSince), false);
  // Neither known: no sub-line at all.
  assert.equal(/yu-sub/.test(html(base({ me: { ...base().me, since: null, zone: null } }))), false);
  assert.match(html(base()), /from this device/, 'and the settings row says whose zone it is');
});

test('STREAK: three boxes, and the hot ring only on a live streak', () => {
  const h = html(base());
  assert.match(h, /<div class="yu-box hot"><b class="yu-n">12<\/b><span>Day streak<\/span><\/div>/);
  assert.match(h, /<b class="yu-n">31<\/b><span>Best<\/span>/);
  assert.match(h, /<b class="yu-n">44<\/b><span>Boards<\/span>/);
  const cold = html(base({ daily: { ...base().daily, streak: 0 } }));
  assert.equal(/yu-box hot/.test(cold), false, 'a broken streak is not lit');
  assert.match(cold, /<b class="yu-n">0<\/b><span>Day streak<\/span>/, 'and it still says zero');
});

test('DOTS: fourteen, three states, and the DNF count only when there is one', () => {
  const h = html(base());
  const st = [...h.matchAll(/data-state="(\w+)"/g)].map((m) => m[1]);
  assert.equal(st.length, 14);
  assert.deepEqual([...new Set(st)].sort(), ['dnf', 'played', 'unplayed']);
  assert.match(h, /Last 14 days · 1 DNF/);
  assert.match(h, /Best <b class="yu-n">1,868\.9<\/b>/);
  const clean = html(base({ daily: { ...base().daily, dots: dots('pppppppppppppp'), dnf: 0 } }));
  assert.match(clean, /Last 14 days<\/span>/, 'no DNF, no DNF clause');
  // No runs at all: no best score line, but the dots still draw.
  const none = html(base({ daily: { ...base().daily, dots: dots('uuuuuuuuuuuuuu'), dnf: 0, best: null } }));
  assert.equal(/Best </.test(none), false);
  assert.equal((none.match(/data-state="unplayed"/g) ?? []).length, 14);
});

test('SEASON: the row renders ranked or not, and unranked states the distance (R5, R7)', () => {
  const h = html(base());
  const games = [...h.matchAll(/data-game="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(games, ['daily', 'pickem', 'draft']);
  assert.match(h, /<b class="yu-n">#18<\/b><span>of 1,204<\/span>/, 'ranked shows rank and field');
  // R5: unranked shows a dash AND the distance, never a hidden row.
  const draft = h.slice(h.indexOf('data-game="draft"'));
  assert.match(draft, /<b class="yu-n">–<\/b><span>ranks after 2<\/span>/);
  assert.equal(sections(html(base({ season: [] }))).includes('season'), false, 'no games, no module');
});

test('TEAMS: the cap is on the control, so a sixth follow is never a surprise (R4)', () => {
  const h = html(base());
  assert.match(h, /Follow a team · 2 of 5 NFL, 1 of 5 CFB/);
  assert.match(h, /data-team-id="1"/);
  assert.match(h, /<span class="yu-lg">CFB<\/span>/);
  const none = html(base({ follows: { teams: [], cap: 5, counts: [], capLine: null } }));
  assert.match(none, /No teams yet/);
  assert.match(none, />Follow a team<\/a>/, 'and the control still offers the first one');
});

test('ALERTS: read and link only - every row points somewhere and none writes (R3)', () => {
  const h = html(base());
  const rows = [...h.matchAll(/data-row="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(rows, ['push', 'games', 'email', 'tz', 'handle', 'signout']);
  assert.match(h, /Push notifications<small>ios<\/small><\/span><span class="yu-v on">On/);
  assert.match(h, /4 games subscribed<\/small><\/span><span class="yu-v">kickoff, score, final/);
  assert.match(h, /Email<small>d\*\*\*@gmail\.com<\/small><\/span><span class="yu-v on">On/);
  // BOARD REMINDERS ARE NOT HERE. No column, no scope, nothing to read (Q2).
  assert.equal(/[Bb]oard reminder/.test(h), false);
  // Nothing in this component is a control.
  const c = src('components/you/You.js');
  assert.equal(/<button|onClick|'use client'/.test(c), false, 'the You tab writes nothing');
});

test('ALERTS: the off and unsubscribed states, and no game row at zero', () => {
  const h = html(base({ alerts: { push: { choice: 'disabled', on: false, devices: 0, where: '0 devices' }, games: { count: 0, sends: [], sendLine: null }, email: { optedOut: true } } }));
  assert.match(h, /Push notifications<small>0 devices<\/small><\/span><span class="yu-v">Off/);
  assert.match(h, /<span class="yu-v">Unsubscribed<\/span>/);
  assert.equal(/data-row="games"/.test(h), false, 'no subscriptions, no row');
});

test('MEMBERSHIP: a pass runs THROUGH, a subscription RENEWS, and neither shows a price (Q4)', () => {
  assert.match(html(base()), /<div class="yu-ms">Through Feb 16, 2027<\/div>/);
  assert.match(html(base({ membership: { member: true, kind: 'subscription', verb: 'Renews', date: 'Jun 12, 2027' } })), /Renews Jun 12, 2027/);
  const h = html(base());
  assert.equal(/\$/.test(h), false, 'no price anywhere on the tab');
  // A member with no date still gets the badge; a non-member gets no module.
  assert.match(html(base({ membership: { member: true, kind: null, verb: 'Renews', date: null } })), /data-section="membership"/);
  assert.equal(sections(html(base({ membership: { member: false } }))).includes('membership'), false);
});

test('NO CLASS COLLIDES WITH gridiron.css', () => {
  // /you loads gridiron.css, which owns bare `.rk` and `.nm`. Naming a page
  // container `.rk` is what turned the Rankings tab into a volt block.
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
  const classesIn = (css) => new Set([...strip(css).matchAll(/(?:^|[\s,{}>+~])\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
  const mine = classesIn(src('components/you/you.css'));
  const clash = [...mine].filter((c) => classesIn(src('components/gridiron/gridiron.css')).has(c));
  assert.deepEqual(clash, [], `you.css reuses gridiron.css selectors: ${clash}`);
  for (const c of mine) assert.match(c, /^yu(-|$)/, `${c} is not yu- prefixed`);
});

test('R1: the tab reads no live game state', () => {
  const reader = src('lib/you/reads.js');
  for (const banned of ['liveState', 'live_state', "status = 'live'", 'myLiveNow', 'liveElseNext']) {
    assert.equal(reader.includes(banned), false, `the You reader reaches for ${banned}`);
  }
});

test('no em dash in the tab or its reader', () => {
  for (const f of ['components/you/You.js', 'components/you/you.css', 'lib/you/reads.js', 'app/you/page.js']) {
    assert.equal(/—/.test(src(f)), false, `${f} carries an em dash`);
  }
});
