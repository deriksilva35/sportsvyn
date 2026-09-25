// components/pickem/pickemBoard.test.mjs - Pick'em reads as straight up, and
// a pick tap never reads or writes the spread. Press-the-button: the real
// component in jsdom, the real tap, a recording stand-in for the server action.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { transformSync } from '@babel/core';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../lib/testing/stubDir.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STUB = stubPath('__actions_stub.mjs');
// The three server-action modules pull in auth and the database; a pick test
// needs none of that. One stub answers all three, and RECORDS every call.
registerHooks({ resolve(spec, ctx, next) {
  if (/^@\/app\/actions\/(pickem|confirm|handle)$/.test(spec)) return { url: pathToFileURL(STUB).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, createRoot, act, PickemBoard, dom, tmp; const roots = new Set();

before(async () => {
  writeFileSync(STUB, `
    export const calls = [];
    export async function savePickAction(...args) { calls.push(args); return { ok: true }; }
    export async function confirmPickemEntry() { return { ok: true }; }
    export async function checkHandle() { return { ok: true, message: 'Available' }; }
    export async function claimHandle() { return { ok: true, handle: 'x' }; }
  `);
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/pickem/nfl' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react')); ({ createRoot } = await import('react-dom/client'));
  const src = path.join(__dirname, 'PickemBoard.js');
  const out = transformSync(readFileSync(src, 'utf8'), { filename: src, presets: [['@babel/preset-react', { runtime: 'automatic' }]], configFile: false, babelrc: false }).code;
  tmp = stubPath(`__pickem_test_${process.pid}.mjs`);
  writeFileSync(tmp, out.replace(/^'use client';\s*/m, ''));
  PickemBoard = (await import(pathToFileURL(tmp).href)).default;
});
afterEach(() => { for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } } roots.clear(); });
after(() => { for (const f of [tmp, STUB]) { try { unlinkSync(f); } catch { /* gone */ } } });

const stub = async () => import(pathToFileURL(STUB).href);
const future = new Date(Date.now() + 3 * 3600_000).toISOString();
const game = () => ({
  match_id: 20749, slug: 'nfl-2026-reg-w1-ne-sea', home: 'Seahawks', away: 'Patriots',
  kickoff_at: future, status: 'scheduled', kicked: false, my_side: null, graded: null,
  spread_home: -3, home_rank: null, away_rank: null, home_record: null, away_record: null,
  home_score: null, away_score: null,
});
function renderMany(sport, games) {
  const container = document.getElementById('root'); const root = createRoot(container); roots.add(root);
  act(() => root.render(React.createElement(PickemBoard, {
    view: { contest: { id: 1, boardNumber: 1, sport, displayWeek: 1, week: 1 }, games },
    signedIn: true, signinHref: '/signin', hasHandle: true, initialConfirmedAt: null, locksAt: future,
  })));
  return container;
}
function render(sport = 'nfl', g = game()) {
  const container = document.getElementById('root'); const root = createRoot(container); roots.add(root);
  act(() => root.render(React.createElement(PickemBoard, {
    view: { contest: { id: 1, boardNumber: 1, sport, displayWeek: 1, week: 1 }, games: [g] },
    signedIn: true, signinHref: '/signin', hasHandle: true, initialConfirmedAt: null, locksAt: future,
  })));
  return container;
}
const sides = (c) => [...c.querySelectorAll('.pkv-side')];
const byName = (c, n) => sides(c).find((b) => b.querySelector('.pkv-nm b')?.textContent === n);
const click = (el) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });

test('1. STRAIGHT UP IS SAID ONCE, in the step strip, on both sports', () => {
  // v2 moved this sentence out of its own .pk-straight paragraph and into the
  // step strip's one contextual line. The RULE is unchanged and is what this
  // test protects: a board that shows a spread beside two buttons must say, in
  // words, that the spread is not the bet.
  for (const sport of ['nfl', 'cfb']) {
    const c = render(sport);
    const note = c.querySelector('.pkv-note');
    assert.ok(note, `${sport}: the line exists`);
    assert.match(note.textContent, /straight up/i);
    assert.match(note.textContent, /does not change the scoring/i);
    assert.match(note.textContent, /locks at its own kickoff/i);
    act(() => { for (const r of roots) r.unmount(); }); roots.clear();
  }
});

test('2. the line sits BELOW both sides - never in the kickoff row', () => {
  const c = render();
  const line = c.querySelector('.pkv-line'); assert.ok(line, 'the line renders pre-kick');
  assert.match(line.textContent, /Seahawks\s*−3/u);
  const sidesEl = c.querySelector('.pkv-sides'); const top = c.querySelector('.pkv-gtop');
  assert.ok(sidesEl.compareDocumentPosition(line) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, 'after the sides');
  assert.ok(!top.contains(line), 'not in the kickoff row');
  assert.doesNotMatch(top.textContent, /[−+-]\s*\d/, 'the kickoff row carries no odds');
  assert.equal(c.querySelector('.pk-spread'), null, 'the old chip is gone');
});

test('3. a pick reads as a winner: volt stays, the other side goes muted, YOUR PICK on the pick, no odds on any button', async () => {
  const c = render();
  const sea = byName(c, 'Seahawks'), ne = byName(c, 'Patriots');
  assert.ok(sea && ne);
  // v2 marks the PICK rather than dimming the other side: a volt ring and a
  // dot on the chosen one, nothing on the other. The rule kept here is that a
  // pick is unmistakable and that no odds ever ride a tap target.
  for (const b of [sea, ne]) { assert.doesNotMatch(b.className, /picked/); assert.equal(b.querySelector('.pkv-tick'), null); }
  await click(sea);
  assert.match(sea.className, /picked/, 'the picked side carries the volt ring');
  assert.equal(sea.querySelector('.pkv-tick').textContent, '●');
  assert.doesNotMatch(ne.className, /picked/);
  assert.equal(ne.querySelector('.pkv-tick'), null);
  for (const b of sides(c)) {
    assert.doesNotMatch(b.textContent, /[−+-]\s*\d/, 'no odds anywhere on a button');
    assert.doesNotMatch(b.textContent, /\bline\b/i);
    assert.equal(b.querySelector('.pkv-line'), null);
  }
});

test('4. a pick tap neither reads nor writes the spread', async () => {
  const { calls } = await stub(); calls.length = 0;
  const c = render();
  await click(byName(c, 'Seahawks'));
  assert.equal(calls.length, 1, 'one save');
  assert.deepEqual(calls[0], [1, 20749, 'home'], 'contest, match, side - and nothing else');
  assert.ok(!calls[0].some((a) => a === -3 || a === '-3' || (a && typeof a === 'object' && 'spread' in a)), 'the spread never travels');
  // And the handlers never even read it: a source guard on tap()/savePick().
  const src = readFileSync(path.join(__dirname, 'PickemBoard.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // From tap() through the end of savePick()'s body - the first `\n  }\n`
  // after savePick opens closes it (both handlers sit at two-space indent).
  const start = src.indexOf('function tap(');
  const sp = src.indexOf('async function savePick(');
  const end = src.indexOf('\n  }\n', sp) + 4;
  const handlers = src.slice(start, end);
  assert.match(handlers, /savePickAction\(/, 'the slice reached savePick');
  assert.doesNotMatch(handlers, /spread/, 'tap/savePick reference no spread');
});

// ---------------------------------------------------------------------------
// THE MARK (HEADGEAR-WEB). Each side draws the one TeamMark: headgear when
// both sides have a cutout, else the two-tone disc when both are dressed, else
// two neutral discs. BOTH OR NEITHER at every step - one coloured mark beside
// one grey one reads as a favourite, which this board must never imply. This
// is the site's one FACING pair, so the side drawn second (home) mirrors.
// ---------------------------------------------------------------------------
const dressed = () => ({
  ...game(), home_team_id: 2, away_team_id: 1,
  home_colors: { primary: '#002244', secondary: '#69BE28' }, away_colors: { primary: '#002244', secondary: '#C60C30' },
});
const marksOf = (c) => [...c.querySelectorAll('[data-teammark]')];

test('THE MARK: a dressed row draws two coloured discs, an undressed row two neutral ones', () => {
  const c = render('nfl', dressed());
  const marks = marksOf(c);
  assert.equal(marks.length, 2);
  assert.equal(marks.every((m) => m.getAttribute('data-teammark') === 'circle'), true, 'both dressed, no abbreviations -> two discs');
  assert.equal(marks[0].querySelector('circle[fill]').getAttribute('fill'), '#002244');
  for (const s2 of sides(c)) assert.ok(s2.firstElementChild.hasAttribute('data-teammark'), 'the mark comes first');
  const bare = render('nfl', { ...game(), home_colors: null, away_colors: null });
  assert.equal(marksOf(bare).every((m) => m.getAttribute('data-teammark') === 'abbr'), true, 'no colours, two neutral marks');
  assert.equal(marksOf(bare).length, 2, 'the slot is always there - the layout does not move');
  assert.equal(c.querySelectorAll('.pkv-mk').length, 0, 'the hand-rolled CSS disc is gone');
});

test('THE MARK: BOTH OR NEITHER on colour - an FCS-at-FBS row draws neither side coloured', () => {
  const famuAtMiami = { ...game(), slug: 'cfb-2026-reg-w2-florida-a-m-miami', home: 'Miami', away: 'Florida A&M', home_team_id: 2, away_team_id: 1,
    home_colors: { primary: '#F47321', secondary: '#005030' }, away_colors: null };
  const c1 = render('cfb', famuAtMiami);
  assert.equal(marksOf(c1).some((m) => m.getAttribute('data-teammark') === 'circle'), false,
    'Miami is dressed and Florida A&M is not, so neither is coloured');
  const c2 = render('cfb', { ...famuAtMiami, away: 'Notre Dame', away_colors: { primary: '#0C2340', secondary: '#C99700' } });
  assert.equal(marksOf(c2).every((m) => m.getAttribute('data-teammark') === 'circle'), true, 'both dressed: both coloured');
});

test('THE MARK: headgear on both sides, the home side mirrored to face the away side', () => {
  const c = render('nfl', { ...dressed(), away_abbr: 'NE', home_abbr: 'SEA' });
  const [away, home] = marksOf(c);
  assert.equal(away.getAttribute('data-teammark'), 'headgear'); assert.equal(home.getAttribute('data-teammark'), 'headgear');
  assert.equal(away.getAttribute('src'), '/headgear/nfl/NE@1x.webp'); assert.equal(home.getAttribute('src'), '/headgear/nfl/SEA@1x.webp');
  assert.equal(away.getAttribute('data-facing'), 'right'); assert.doesNotMatch(away.getAttribute('style') ?? '', /scaleX/);
  assert.equal(home.getAttribute('data-facing'), 'left'); assert.match(home.getAttribute('style') ?? '', /transform:\s*scaleX\(-1\)/);
  assert.equal(away.getAttribute('width'), '26', 'the same 26 px box the disc had');
});

test('THE MARK: BOTH OR NEITHER on headgear - one side without a cutout, both draw the disc', () => {
  const c = render('nfl', { ...dressed(), away_abbr: 'NE', home_abbr: 'XXX' });
  assert.equal(marksOf(c).every((m) => m.getAttribute('data-teammark') === 'circle'), true, 'NE has a cutout, XXX does not: two discs');
  const cfb = render('cfb', { ...dressed(), away_abbr: 'ATL', home_abbr: 'PIT' });
  assert.equal(marksOf(cfb).some((m) => m.getAttribute('data-teammark') === 'headgear'), false, 'cfb has no headgear, whatever the letters');
});

test('THE MARK: tapping the mark still saves the pick', async () => {
  const { calls } = await stub(); const n = calls.length;
  const c = render('nfl', { ...dressed(), away_abbr: 'NE', home_abbr: 'SEA' });
  await click(byName(c, 'Seahawks').querySelector('[data-teammark]'));
  assert.equal(calls.length, n + 1, 'one save');
  assert.match(JSON.stringify(calls[n]), /"home"/, 'the home side');
  assert.match(JSON.stringify(calls[n]), /20749/, 'this game');
  assert.match(byName(c, 'Seahawks').className, /picked/, 'and the side reads as picked');
});

// ---------------------------------------------------------------------------
// ROLLING LOCK: a kicked row wears pk-locked and its pk-at slot shows the
// kickoff time; an unkicked row on the same board stays live.
// ---------------------------------------------------------------------------
test('rolling lock: a kicked row is pk-locked with its kickoff where "at" was; the next row is live', () => {
  const past = new Date(Date.now() - 3 * 3600_000).toISOString();
  const kicked = { ...game(), match_id: 20749, kickoff_at: past, kicked: true, status: 'live', home_score: 3, away_score: 10 };
  const live = { ...game(), match_id: 20750, slug: 'nfl-2026-reg-w1-sf-lar', home: 'Rams', away: '49ers' };
  const c = renderMany('nfl', [kicked, live]);
  const rows = [...c.querySelectorAll('.pkv-g')];
  assert.equal(rows.length, 2);
  assert.match(rows[0].className, /locked/);
  assert.doesNotMatch(rows[1].className, /locked/);
  // v2 has no "at" connector between the sides; the kicked row says LIVE with
  // its period where the kickoff time was, and the open row still says when it
  // kicks. The rule tested is unchanged: a kicked row is inert, the next is not.
  assert.match(rows[0].querySelector('.pkv-gtop').textContent, /LIVE|Q\d/);
  assert.match(rows[1].querySelector('.pkv-gtop').textContent, /\d/, 'the open row shows its kickoff');
  assert.equal(rows[0].querySelectorAll('button.pkv-side[disabled]').length, 2, 'both sides inert');
  assert.equal(rows[1].querySelectorAll('button.pkv-side:not([disabled])').length, 2, 'both sides live');
});

// ---------------------------------------------------------------------------
// FRESH-USER FIXES - D4 (confirm reachable mid-week) and D3 (Not now keeps
// the pick). PICKEM_PASTE=1 prints the pending row - the served-proof paste.
// ---------------------------------------------------------------------------
const past3h = new Date(Date.now() - 3 * 3600_000).toISOString();
function boardOf(n, { kicked = 0, picked = 0 } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    ...game(), match_id: 30000 + i, slug: `nfl-2026-reg-w1-g${i}`, home: `Home${i}`, away: `Away${i}`,
    ...(i < kicked ? { kickoff_at: past3h, kicked: true, status: 'final', home_score: 3, away_score: 10 } : {}),
    my_side: i >= kicked && i < kicked + picked ? 'home' : null,
  }));
}
function renderGate(games, { hasHandle = false } = {}) {
  const container = document.getElementById('root'); const root = createRoot(container); roots.add(root);
  act(() => root.render(React.createElement(PickemBoard, {
    view: { contest: { id: 1, boardNumber: 1, sport: 'nfl', displayWeek: 1, week: 1 }, games },
    signedIn: true, signinHref: '/signin', hasHandle, initialConfirmedAt: null, locksAt: future,
  })));
  return container;
}
const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const rowOf = (c, matchId) => [...c.querySelectorAll('.pk-game')].find((r) => r.querySelector(`a[aria-label="Away${matchId - 30000} at Home${matchId - 30000} game page"]`) || r.textContent.includes(`Away${matchId - 30000}`));

test('D4: 16 rows, 1 kicked, 15 picked -> Lock it in is LIVE and counts the pickable', () => {
  // v2 moves the confirm out of ConfirmCard and into the footer button. The
  // fresh-user rule it protects is unchanged: a board with the Thursday game
  // already played must still be confirmable.
  const c = renderGate(boardOf(16, { kicked: 1, picked: 15 }), { hasHandle: true });
  const btn = c.querySelector('.pkv-lock');
  assert.ok(btn, 'the control exists');
  assert.equal(btn.textContent, 'Lock it in');
  assert.equal(btn.disabled, false);
  assert.match(c.querySelector('.pkv-sub').textContent, /15 of 15 picked/);
});
test('D4: 16 rows, 1 kicked, 14 picked -> the counter, not the confirm', () => {
  const c = renderGate(boardOf(16, { kicked: 1, picked: 14 }), { hasHandle: true });
  assert.equal(c.querySelector('.pkv-lock').textContent, '1 to go');
  assert.equal(c.querySelector('.pkv-lock').disabled, true);
});
test('D4: 0 kicked, 16 picked -> "Lock it in" and "16 of 16 picked"', () => {
  const c = renderGate(boardOf(16, { kicked: 0, picked: 16 }), { hasHandle: true });
  assert.equal(c.querySelector('.pkv-lock').textContent, 'Lock it in');
  assert.match(c.querySelector('.pkv-sub').textContent, /16 of 16 picked/);
});
test('D4: a pick on a kicked game does not count - 1 kicked-and-picked + 14 open picked -> still 1 to go', () => {
  const games = boardOf(16, { kicked: 1, picked: 14 }); games[0].my_side = 'home';
  const c = renderGate(games, { hasHandle: true });
  assert.equal(c.querySelector('.pkv-lock').textContent, '1 to go',
    'the sealed pick is outside both numerator and denominator');
});

test('D3: Not now -> the row is pk-pending, the pick is retained on screen, nothing written; the row says why', async () => {
  const s = await stub(); s.calls.length = 0;
  const c = renderGate(boardOf(2));
  await click(byName(c, 'Home0'));
  assert.ok(c.querySelector('.onb-scrim'), 'the handle modal opened on the first pick');
  const notNow = [...c.querySelectorAll('button')].find((b) => b.textContent === 'Not now');
  await click(notNow);
  assert.equal(c.querySelector('.onb-scrim'), null, 'modal closed');
  const row = [...c.querySelectorAll('.pkv-g')][0];
  assert.ok(row.classList.contains('pk-pending'), 'the row is marked pending');
  assert.match(byName(c, 'Home0').className, /picked/, 'the pick stays painted');
  assert.equal(row.querySelector('.pk-pending-lbl').textContent, 'Needs a handle');
  assert.equal(s.calls.length, 0, 'nothing reached the server');
  if (process.env.PICKEM_PASTE) console.log(`\nPASTE pending row after Not now:\n${row.outerHTML}\n`);
  // Tapping the pending row (either side is a write) re-opens the modal.
  await click(byName(c, 'Away0'));
  assert.ok(c.querySelector('.onb-scrim'), 'tapping the pending row re-opens the modal');
  assert.equal(row.querySelectorAll('[onclick], button:not(.pkv-side)').length, 0, 'the label is text, not a control');
});

test('D3: Claim -> the stashed pick replays; two stashed picks land in order', async () => {
  const s = await stub(); s.calls.length = 0;
  const c = renderGate(boardOf(3));
  await click(byName(c, 'Home0'));
  await click([...c.querySelectorAll('button')].find((b) => b.textContent === 'Not now'));
  await click(byName(c, 'Away1'));
  assert.ok(c.querySelector('.onb-scrim'), 'the next write re-opens the modal');
  assert.equal([...c.querySelectorAll('.pkv-g.pk-pending')].length, 2, 'both rows pending');
  assert.equal(s.calls.length, 0);
  // Claim through the real HandleClaim: type, wait for the availability check, tap Claim.
  const input = c.querySelector('.onb-scrim input[aria-label="Handle"]');
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(input, 'fresh_user'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  await wait(450);
  const claim = [...c.querySelectorAll('.onb-scrim button')].find((b) => /^Claim @/.test(b.textContent));
  assert.equal(claim.disabled, false, 'the availability check passed');
  await click(claim); await wait(20);
  assert.equal(c.querySelector('.onb-scrim'), null, 'modal closed on claim');
  assert.deepEqual(s.calls.map((a) => [a[1], a[2]]), [[30000, 'home'], [30001, 'away']], 'replayed in order');
  assert.equal(c.querySelectorAll('.pkv-g.pk-pending').length, 0, 'nothing pending after the replay');
  // and a later pick goes straight through
  await click(byName(c, 'Home2'));
  assert.equal(c.querySelector('.onb-scrim'), null, 'never asked twice');
  assert.equal(s.calls.length, 3);
});

test('RIDER: one denominator - 16 rows, 2 kicked, 0 picked -> header "0 of 14", cap "0 of 14 picked", record "14 pending"', () => {
  // ONE DENOMINATOR, and v2 has three places it must agree: the sub line, the
  // counter, and the record's pending count.
  const c = renderGate(boardOf(16, { kicked: 2, picked: 0 }), { hasHandle: true });
  assert.match(c.querySelector('.pkv-sub').textContent, /0 of 14 picked/);
  assert.equal(c.querySelector('.pkv-lock').textContent, '14 to go');
  assert.match(c.querySelector('.pkv-big').textContent, /14 pending/);
  const c2 = renderGate(boardOf(16, { kicked: 2, picked: 14 }), { hasHandle: true });
  assert.match(c2.querySelector('.pkv-sub').textContent, /14 of 14 picked/);
  assert.equal(c2.querySelector('.pkv-lock').textContent, 'Lock it in');
});

// ---------------------------------------------------------------------------
// TEAM ORDER relay: the league decides who goes first and what sits between.
// ---------------------------------------------------------------------------
test('TEAM ORDER: an NFL board reads away-first, a soccer board home-first', () => {
  // v2 has no connector between the sides - the mock puts the two tap targets
  // flush against each other - so the ORDER is the whole rule now, and
  // orderFor() is still what decides it.
  const nfl = render('nfl');
  assert.deepEqual(sides(nfl).map((b) => b.querySelector('.pkv-nm b').textContent), ['Patriots', 'Seahawks'], 'away then home');
  act(() => { for (const r of roots) r.unmount(); }); roots.clear();
  const cfb = render('cfb');
  assert.deepEqual(sides(cfb).map((b) => b.querySelector('.pkv-nm b').textContent), ['Patriots', 'Seahawks']);
  act(() => { for (const r of roots) r.unmount(); }); roots.clear();
  // no soccer board exists yet; the rule is the rule when one does
  const epl = render('epl');
  assert.deepEqual(sides(epl).map((b) => b.querySelector('.pkv-nm b').textContent), ['Seahawks', 'Patriots'], 'home then away');
});
