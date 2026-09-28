// lib/brand/darkParity.js - what the DARK page resolves to, rule by rule. PURE.
//
// WHY. The rebrand ships behind ARCADE_THEME, which is off in production, so
// a rebrand merge must not move one pixel of the dark page. The R2 sweep broke
// that on 28 Sep: 128 declarations across nine files resolved differently on
// the dark page (the Games lobby's volt chip went #141414 on #141414), every
// suite was green, and production /games shipped dark-on-dark for four
// minutes. Nothing compared what the dark page RESOLVES TO before and after.
//
// This does: every declaration of every rule that is not inside a
// [data-theme] selector is resolved through var() with the dark globals (the
// :root / @theme / [data-surface] custom properties, arcade blocks excluded)
// and the file's own custom properties, then compared by (selector,
// property) against the same resolution of another tree.
//
// THE RULE (droplet-mon-8): a colour may move by at most 1.2% relative
// luminance (the grey-step consolidations); anything else - a colour past
// that, a radius, a border width, a gradient becoming flat, a display, an
// added or removed declaration - is a change. No whitelist.

export const LUMA_TOLERANCE = 0.012;

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

/** Flatten a stylesheet to [{ sel, body }], @-rule contexts prefixed to the selector. */
export function rules(css) {
  const out = [];
  const stack = [];
  let last = 0;
  const src = stripComments(css);
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      const head = src.slice(last, i).split(';').pop().trim();
      stack.push(head);
      last = i + 1;
    } else if (ch === '}') {
      const body = src.slice(last, i);
      const sel = stack.pop();
      if (sel != null && !sel.startsWith('@')) {
        const ctx = stack.filter((s) => s.startsWith('@')).join(' ');
        out.push({ sel: `${ctx} ${sel}`.trim().replace(/\s+/g, ' '), body });
      }
      last = i + 1;
    }
  }
  return out;
}

const decls = (body) => [...body.matchAll(/(?:^|;)\s*([-a-zA-Z0-9_]+)\s*:\s*([^;]+)/g)]
  .map((m) => [m[1].trim(), m[2].trim()]);

/** The dark global custom properties: :root / @theme / :host / [data-surface], no data-theme. */
export function darkGlobals(globalsCss) {
  const out = {};
  for (const { sel, body } of rules(globalsCss)) {
    if (/data-theme/.test(sel) || sel.startsWith('@media')) continue;
    const isSurface = sel.startsWith('[data-surface]');
    if (!(isSurface || /^(:root|@theme|:host)/.test(sel))) continue;
    for (const [k, v] of decls(body)) {
      if (!k.startsWith('--')) continue;
      if (isSurface || !(k in out)) out[k] = v;
    }
  }
  return out;
}

/** Resolve var() through scope; unresolved names become '?--name'. */
export function resolve(value, scope, depth = 0) {
  if (depth > 15) return value;
  return value.replace(/var\((--[\w-]+)(?:\s*,\s*((?:[^()]|\([^()]*\))*))?\)/g, (_, name, fb) => {
    const v = scope[name] ?? (fb != null ? fb.trim() : null);
    return v == null ? `?${name}` : resolve(v, scope, depth + 1);
  });
}

const norm = (v) => v.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').trim().toLowerCase();

/** Every non-custom declaration of every non-[data-theme] rule, resolved: Map key -> value. */
export function resolvedDark(css, globals) {
  const rs = rules(css).filter((r) => !/data-theme/.test(r.sel));
  const local = {};
  for (const { body } of rs) for (const [k, v] of decls(body)) if (k.startsWith('--') && !(k in local)) local[k] = v;
  const scope = { ...globals, ...local };
  const out = new Map();
  for (const { sel, body } of rs) {
    for (const [k, v] of decls(body)) {
      if (k.startsWith('--')) continue;
      out.set(`${sel} { ${k} }`, norm(resolve(v, scope)));
    }
  }
  return out;
}

// ── colours ────────────────────────────────────────────────────────────────
const COLOR_RX = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/g;

function rgbaOf(c) {
  if (c.startsWith('#')) {
    let h = c.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return [r, g, b, a];
  }
  const n = c.replace(/rgba?\(|\)/g, '').split(/[,\s/]+/).filter(Boolean).map(Number);
  return [n[0], n[1], n[2], n[3] ?? 1];
}
function luminance([r, g, b]) {
  const f = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Is candidate value b within tolerance of base value a? Returns null if yes, else the reason. */
export function compareValues(a, b) {
  if (a === b) return null;
  if (a == null) return 'added';
  if (b == null) return 'removed';
  const shapeA = a.replace(COLOR_RX, '<c>');
  const shapeB = b.replace(COLOR_RX, '<c>');
  if (shapeA !== shapeB) return 'shape changed';
  const ca = a.match(COLOR_RX) ?? [];
  const cb = b.match(COLOR_RX) ?? [];
  for (let i = 0; i < ca.length; i++) {
    const x = rgbaOf(ca[i]); const y = rgbaOf(cb[i]);
    if (Math.abs(x[3] - y[3]) > 0.001) return `alpha ${x[3]} -> ${y[3]}`;
    const d = Math.abs(luminance(x) - luminance(y));
    if (d > LUMA_TOLERANCE) return `luminance moved ${(d * 100).toFixed(1)}%`;
  }
  return null;
}

/** Diff two resolved maps: [{ key, before, after, why }]. */
export function diffDark(base, cand) {
  const keys = new Set([...base.keys(), ...cand.keys()]);
  const out = [];
  for (const key of [...keys].sort()) {
    const why = compareValues(base.get(key) ?? null, cand.get(key) ?? null);
    if (why) out.push({ key, before: base.get(key) ?? null, after: cand.get(key) ?? null, why });
  }
  return out;
}
