// app/voltContrast.test.mjs - VOLT IS NEVER TEXT ON WHITE (volt grammar, 28 Sep).
//
// Volt on #FFFFFF is 1.1:1. On the arcade page volt is a FILL (with navy ink on
// it) or an accent (a dot, a rule, the wash) - never the colour of words on a
// light ground. Every stylesheet is resolved the way the arcade page resolves it
// (the arcade role values, arcade-scoped rules applied over base rules), and any
// rule whose text colour comes out volt must give that same element a dark
// background. A rule with no background of its own sits on the page: white.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rules, resolve, darkGlobals } from '../lib/brand/darkParity.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(REPO, f), 'utf8');
const decls = (b) => [...b.matchAll(/(?:^|;)\s*([-a-zA-Z0-9_]+)\s*:\s*([^;]+)/g)].map((m) => [m[1], m[2].trim()]);
const ARC = /:where\(:root\[data-theme="arcade"\]\)\s*|:root\[data-theme="arcade"\]\s*/g;

function arcadeGlobals(css) {
  const g = darkGlobals(css);
  for (const { sel, body } of rules(css)) {
    if (/^:root\[data-theme="arcade"\]( \[data-surface\])?$/.test(sel)) for (const [k, v] of decls(body)) if (k.startsWith('--')) g[k] = v;
  }
  return g;
}
const lum = (hex) => {
  let h = hex.replace('#', ''); if (h.length === 3) h = [...h].map((x) => x + x).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const isVolt = (v) => /#d4ff00\b|rgb\(212,\s*255,\s*0\)/i.test(v);
const darkBg = (v) => { const m = /#([0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(v ?? ''); return !!m && lum(m[0]) < 0.2; };

// TEXT THAT SITS ON A NAVY ANCESTOR, not on the page. Each entry names the
// ancestor, and the check below proves that ancestor's own background resolves
// dark on the arcade page - so an entry cannot quietly outlive its navy card.

// ARCADE CUSTOM PROPERTIES BY SPECIFICITY. A :root[data-theme="arcade"] block
// out-ranks a :where(:root[data-theme="arcade"]) one whatever the order, so a
// "last wins" read would believe a :where() re-mapping the browser ignores.
// Base values first, then :where(arcade), then :root[data-theme=arcade].
function localVars(css) {
  const base = {}; const soft = {}; const hard = {};
  for (const { sel, body } of rules(css)) {
    const bucket = /:root\[data-theme="arcade"\]/.test(sel.replace(/:where\([^)]*\)/g, '')) ? hard : (/data-theme="arcade"/.test(sel) ? soft : base);
    for (const [k, v] of decls(body)) if (k.startsWith('--') && (bucket !== base || !(k in base))) bucket[k] = v;
  }
  return { ...base, ...soft, ...hard };
}

export const ON_DARK_ANCESTOR = Object.freeze({
  '.gv-now-l': '.gv-now', // the Tonight card's kicker (volt grammar: navy card, volt kicker)
  // scores-v4: the live card is navy; its leader's score, the stake result and
  // the win read are volt marks on it (mock A, the Marquee).
  '.sv4-card.live .sv4-team.lead .sc': '.sv4-card.live',
  '.sv4-card.live .sv4-stake b': '.sv4-card.live',
  '.sv4-card.live .sv4-foot .wp': '.sv4-card.live',
  // step 2: the drawer's scoring plays and its game-page link, on the same navy card.
  '.sv4-card.live .sv4-xs li.sc .tx': '.sv4-card.live',
  '.sv4-card.live .sv4-xgo': '.sv4-card.live',
});

export function voltOnLight(css, g) {
  const rs = rules(css).filter((r) => !/data-theme="(?!arcade)/.test(r.sel))
    .map((r) => ({ sel: r.sel.replace(ARC, ''), body: r.body }));
  const scope = { ...g, ...localVars(css) };
  const bySel = new Map();
  for (const { sel, body } of rs) {
    const cur = bySel.get(sel) ?? {};
    for (const [k, v] of decls(body)) if (!k.startsWith('--')) { cur[k] = resolve(v, scope); if (k === 'color') cur.__raw = v; }
    bySel.set(sel, cur);
  }
  const bad = [];
  for (const [sel, d] of bySel) {
    if (!d.color || !isVolt(d.color)) continue;
    // THE RULE IS ABOUT THE ROLES: text that READS --tok-action / --tok-accent.
    // A literal #D4FF00 in a file the rebrand has not swept yet is batch-2 work,
    // listed by the relay, not this guard's.
    if (!/var\(--tok-(action|accent)\)/.test(d.__raw ?? '')) continue;
    const anc = ON_DARK_ANCESTOR[sel];
    if (anc) {
      const a = bySel.get(anc);
      const abg = a && (a.background ?? a['background-color']);
      if (darkBg(abg)) continue;
      bad.push(`${sel} names ${anc} as its dark ground, but ${anc} resolves to ${abg ?? 'nothing'}`);
      continue;
    }
    const bg = d.background ?? d['background-color'];
    if (!darkBg(bg)) bad.push(`${sel} { color: ${d.color.trim()} } on ${bg ? bg.trim() : 'the page'}`);
  }
  return bad;
}

test('the checker catches volt text on white and passes volt text on navy', () => {
  const g = { '--tok-action': '#D4FF00', '--tok-accent': '#D4FF00', '--tok-primary': '#1A1650' };
  assert.equal(voltOnLight('.a { color: var(--tok-action); }', g).length, 1, 'no background -> the page');
  assert.equal(voltOnLight('.a { color: var(--tok-action); background: #FFFFFF; }', g).length, 1);
  assert.equal(voltOnLight('.a { color: var(--tok-action); background: var(--tok-primary); }', g).length, 0, 'volt on navy is fine');
  assert.equal(voltOnLight(':where(:root[data-theme="arcade"]) .a { color: var(--tok-accent); }', g).length, 1, 'arcade rules are read');
  assert.equal(voltOnLight('.a { color: #D4FF00; }', g).length, 0, 'a literal is not the roles\' rule');
});

test('NO --tok-action / --tok-accent TEXT ON A LIGHT GROUND on the arcade page', () => {
  const g = arcadeGlobals(read('app/globals.css'));
  const files = execFileSync('git', ['-C', REPO, 'ls-files', '*.css'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const bad = files.flatMap((f) => voltOnLight(read(f), g).map((b) => `${f}: ${b}`));
  assert.equal(bad.length, 0, `${bad.length} rule(s) put volt text on a light ground:\n${bad.join('\n')}`);
});

// NAVY IS NEVER A FILLED BUTTON OR A SELECTED STATE (volt grammar, step 3).
// Scope: the seven step-3 surfaces, the lobby and the header. A rule whose name
// says button / CTA / selected and whose arcade background resolves to navy
// fails. Structure (a lock badge, a card, the done tile) is allowed navy.
const STEP3 = ['app/weekly/weekly.css', 'app/daily/daily.css', 'app/pickem/pickem.css', 'components/sim/sim.css',
  'components/games/grade.css', 'app/leagues/leagues.css', 'components/onboarding/onboarding.css',
  'app/games/lobbyV3.css', 'components/site-chrome.css',
  // batch 2 (mon-15): the scores and gridiron sheets
  'app/scores/scoresV2.css', 'components/gridiron/gridiron.css', 'components/gridiron/drivestrip.css',
  'components/gridiron/pollboard.css', 'app/schedule/schedule.css', 'app/app/app-shell.css',
  // mon-19: the sign-in buttons
  'app/signin/signin.css'];
// The lock BUTTONS are named explicitly (.expo-lock and .pcard .lock are badges -
// structure); "you" is the reader's own selected row or column.
const BUTTONISH = /(btn|cta|button|\.on\b|\.active\b|\.sel\b|\.pick\b|signin|start|primary|confirm|\.draft\b|\.play\b|-go\b|\.(wkv|pkv)-lock\b|--you\b|\.you\b|\.gg-cy\b)/;

export function navyFills(css, g) {
  const rs = rules(css).filter((r) => !/data-theme="(?!arcade)/.test(r.sel)).map((r) => ({ sel: r.sel.replace(ARC, ''), body: r.body }));
  const scope = { ...g, ...localVars(css) }; const by = new Map();
  // A comma list applies to EACH selector in it: key them one by one.
  for (const { sel, body } of rs) for (const one of sel.split(',').map((x) => x.trim())) { const c = by.get(one) ?? {}; for (const [k, v] of decls(body)) if (!k.startsWith('--')) c[k] = resolve(v, scope); by.set(one, c); }
  // The hamburger's lines are the icon itself - structure, not a fill.
  // :not(.on) names the UNSELECTED state, so it is not read as a selected one.
  // The AUTO toggle's knob is navy by ruling (a knob, not a fill).
  return [...by].filter(([sel, d]) => BUTTONISH.test(sel.replace(/:not\([^)]*\)/g, '')) && !/hamburger-btn[^ ]* span/.test(sel) && !/\.sw::after$/.test(sel) && /#1a1650/i.test(`${d.background ?? ''} ${d['background-color'] ?? ''}`)).map(([sel]) => sel);
}

test('NO NAVY-FILLED BUTTON OR SELECTED STATE on the step-3 surfaces', () => {
  const g = arcadeGlobals(read('app/globals.css'));
  const bad = STEP3.flatMap((f) => navyFills(read(f), g).map((s) => `${f}: ${s}`));
  assert.equal(bad.length, 0, `${bad.length} navy-filled button/selected rule(s):\n${bad.join('\n')}`);
});

// A VOLT FILL CARRIES DARK INK. The mirror of the rule above: volt as a
// background needs navy (or any dark) text on it - white on volt is 1.1:1, and
// it is what a base rule reading --tok-page for its text produces here.
export function lightOnVolt(css, g) {
  const rs = rules(css).filter((r) => !/data-theme="(?!arcade)/.test(r.sel)).map((r) => ({ sel: r.sel.replace(ARC, ''), body: r.body }));
  const scope = { ...g, ...localVars(css) }; const by = new Map();
  // A comma list applies to EACH selector in it: key them one by one.
  for (const { sel, body } of rs) for (const one of sel.split(',').map((x) => x.trim())) { const c = by.get(one) ?? {}; for (const [k, v] of decls(body)) if (!k.startsWith('--')) c[k] = resolve(v, scope); by.set(one, c); }
  return [...by].filter(([, d]) => isVolt(`${d.background ?? ''} ${d['background-color'] ?? ''}`)
    // inherit/currentColor take the element's ink (navy on this page): only a
    // colour that resolves to a LIGHT hex is flagged.
    && d.color && /#[0-9a-f]{3,6}\b/i.test(d.color) && !darkBg(d.color)).map(([sel, d]) => `${sel} { color: ${d.color.trim()} } on volt`);
}

test('EVERY VOLT FILL CARRIES DARK INK on the step-3 surfaces', () => {
  const g = arcadeGlobals(read('app/globals.css'));
  const bad = STEP3.flatMap((f) => lightOnVolt(read(f), g).map((s) => `${f}: ${s}`));
  assert.equal(bad.length, 0, `${bad.length} light-on-volt rule(s):\n${bad.join('\n')}`);
});

// THE SIGN-IN BUTTONS WEAR THE CLASS THE GUARD READS (mon-19). The CSS checks
// above prove .si-cta is a volt fill with dark ink; this proves both of the
// page's submit buttons carry it - a third button added without it is caught.
test('both sign-in submit buttons are .si-cta (volt fill, navy ink under arcade)', () => {
  const src = read('app/signin/SignInForm.js');
  // THE SUBMIT BUTTONS: the third <button> is the "use a different email" text link.
  const buttons = [...src.matchAll(/<button\s+type="submit"[\s\S]*?className="([^"]*)"/g)].map((m) => m[1]);
  assert.equal(buttons.length, 2, 'Email me a code, Verify code');
  for (const c of buttons) assert.match(c, /(^|\s)si-cta(\s|$)/);
  assert.match(src, /import '\.\/signin\.css'/);
  const css = read('app/signin/signin.css');
  assert.match(css, /\.si-cta \{ background: var\(--tok-action\); color: var\(--tok-on-action\); \}/);
});

// TEXT ON NAVY RESOLVES LIGHT (mon-18). --tok-on-primary is the ink role for
// the navy primary, and on the arcade page it resolved VOLT: every word a
// component wrote in that role on a navy card came out volt (the first
// scores-v4 preview drew every team name that way). Two checks:
//   1. the role itself resolves to a light colour that is NOT volt - volt on
//      navy is --tok-accent (a mark) or --tok-action (a button), by name;
//   2. every rule, in every stylesheet, whose arcade background resolves to
//      the navy primary and which sets a text colour, sets a light one.
const NAVY = /#1a1650\b/i;
export function darkOnNavy(css, g) {
  const rs = rules(css).filter((r) => !/data-theme="(?!arcade)/.test(r.sel)).map((r) => ({ sel: r.sel.replace(ARC, ''), body: r.body }));
  const scope = { ...g, ...localVars(css) }; const by = new Map();
  for (const { sel, body } of rs) for (const one of sel.split(',').map((x) => x.trim())) { const c = by.get(one) ?? {}; for (const [k, v] of decls(body)) if (!k.startsWith('--')) c[k] = resolve(v, scope); by.set(one, c); }
  // A SOLID NAVY GROUND, not a tint: color-mix(navy 7%, transparent) is a
  // wash over the page, and the page's ink is right on it.
  const solid = (v) => NAVY.test(v ?? '') && !/color-mix|gradient|rgba/i.test(v ?? '');
  return [...by].filter(([, d]) => (solid(d.background) || solid(d['background-color']))
    && d.color && /#[0-9a-f]{3,6}\b/i.test(d.color) && lum(/#[0-9a-f]{6}|#[0-9a-f]{3}/i.exec(d.color)[0]) < 0.5)
    .map(([sel, d]) => `${sel} { color: ${d.color.trim()} } on navy`);
}

test('the checker catches dark text on navy and passes light', () => {
  const g = { '--tok-primary': '#1A1650', '--tok-on-primary': '#FFFFFF', '--tok-ink': '#0E0B2B' };
  assert.equal(darkOnNavy('.a { background: var(--tok-primary); color: var(--tok-ink); }', g).length, 1);
  assert.equal(darkOnNavy('.a { background: var(--tok-primary); color: var(--tok-on-primary); }', g).length, 0);
  assert.equal(darkOnNavy('.a { background: var(--tok-primary); }', g).length, 0, 'no colour of its own: inherits');
  assert.equal(darkOnNavy('.a { background: color-mix(in srgb, var(--tok-primary) 7%, transparent); color: var(--tok-primary); }', g).length, 0, 'a tint is not a navy ground');
});

test('--tok-on-primary resolves LIGHT and is not volt on the arcade page', () => {
  const g = arcadeGlobals(read('app/globals.css'));
  const v = resolve('var(--tok-on-primary)', g);
  const hex = /#[0-9a-f]{6}|#[0-9a-f]{3}/i.exec(v)?.[0];
  assert.ok(hex, `--tok-on-primary resolves to a colour (got ${v})`);
  assert.ok(lum(hex) > 0.5, `--tok-on-primary is light on navy (got ${hex})`);
  assert.ok(!isVolt(hex), 'volt on navy is --tok-accent or --tok-action, never the ink role');
});

test('NO DARK TEXT ON A NAVY GROUND on the arcade page, in any stylesheet', () => {
  const g = arcadeGlobals(read('app/globals.css'));
  const files = execFileSync('git', ['-C', REPO, 'ls-files', '*.css'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const bad = files.flatMap((f) => darkOnNavy(read(f), g).map((b) => `${f}: ${b}`));
  assert.equal(bad.length, 0, `${bad.length} rule(s) put dark text on navy:\n${bad.join('\n')}`);
});

// THE DIAMOND GAMES CARRY NO BLUE (tue-1). October and The Run: the ARM/P chip
// is navy and the BAT/B chip green on the arcade page; --tok-chip (the blue
// role) had painted the ARM label and the P chip.
test('October and The Run use no --tok-chip (blue) on the arcade page', () => {
  for (const f of ['app/october/october.css', 'app/run/run.css']) {
    const arcadeRules = rules(read(f)).filter((r) => /data-theme="arcade"/.test(r.sel));
    const blue = arcadeRules.filter((r) => /--tok-chip/.test(r.body)).map((r) => r.sel);
    assert.deepEqual(blue, [], `${f}: ${blue.join(', ')}`);
  }
});
