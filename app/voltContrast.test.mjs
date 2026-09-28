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
export const ON_DARK_ANCESTOR = Object.freeze({
  '.gv-now-l': '.gv-now', // the Tonight card's kicker (volt grammar: navy card, volt kicker)
});

export function voltOnLight(css, g) {
  const rs = rules(css).filter((r) => !/data-theme="(?!arcade)/.test(r.sel))
    .map((r) => ({ sel: r.sel.replace(ARC, ''), body: r.body }));
  const local = {}; for (const { body } of rs) for (const [k, v] of decls(body)) if (k.startsWith('--')) local[k] = v;
  const scope = { ...g, ...local };
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
