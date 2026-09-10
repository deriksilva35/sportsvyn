// scripts/monogram-trace.mjs - trace the Ȳ in the 1024 app icon to vertices.
//
// The icon (ios/.../AppIcon-512@2x.png) is the only standalone monogram asset
// and it is a raster. The mark is flat and straight-edged - a bar and a Y -
// so its vertices can be read off the pixels exactly. This prints them, and
// the disagreement between the traced polygon and the PNG mask, so the
// constants in lib/brand/monogram.js can be checked against the raster any
// time the icon changes. Re-run: node scripts/monogram-trace.mjs
//
// Coordinates are PIXEL EDGES: pixel (x,y) covers [x,x+1) x [y,y+1), so a run
// s..e on row y has its left edge at s and its right edge at e+1.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import path from 'node:path';

export const ICON = 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png';

export function decodePng(buf) {
  let p = 8; let W, H, ct; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const type = buf.toString('ascii', p + 4, p + 8); const d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { W = d.readUInt32BE(0); H = d.readUInt32BE(4); ct = d[9]; }
    if (type === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  const C = ct === 6 ? 4 : ct === 2 ? 3 : ct === 4 ? 2 : 1;
  const raw = inflateSync(Buffer.concat(idat)); const stride = W * C; const out = Buffer.alloc(H * stride);
  for (let y = 0; y < H; y++) {
    const ft = raw[y * (stride + 1)]; const src = y * (stride + 1) + 1; const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i]; const a = i >= C ? out[dst + i - C] : 0; const b = y > 0 ? out[dst - stride + i] : 0; const c = (y > 0 && i >= C) ? out[dst - stride + i - C] : 0;
      let v;
      switch (ft) {
        case 0: v = x; break; case 1: v = x + a; break; case 2: v = x + b; break; case 3: v = x + ((a + b) >> 1); break;
        case 4: { const pp = a + b - c; const pa = Math.abs(pp - a); const pb = Math.abs(pp - b); const pc = Math.abs(pp - c); v = x + ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)); break; }
        default: throw new Error(`png filter ${ft}`);
      }
      out[dst + i] = v & 255;
    }
  }
  return { W, H, C, data: out };
}

/** Ink mask of the icon: volt pixels (green channel over half). */
export function iconMask(png) {
  const { W, H, C, data } = png; const m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) m[i] = data[i * C + 1] > 128 ? 1 : 0;
  return { W, H, m };
}

const runsAt = ({ W, m }, y) => { const r = []; let s = -1; for (let x = 0; x < W; x++) { if (m[y * W + x]) { if (s < 0) s = x; } else if (s >= 0) { r.push([s, x - 1]); s = -1; } } if (s >= 0) r.push([s, W - 1]); return r; };

/** Ramer-Douglas-Peucker on a chain of points, tolerance in px. */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]]; let maxD = 0; let idx = 0;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]; const d = L === 0 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= tol) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)];
}

/** Trace the bar (rect) and the Y (polygon) off the mask. */
export function trace(mask, { tol = 1.25 } = {}) {
  const { H } = mask;
  const rowsWithInk = []; for (let y = 0; y < H; y++) if (runsAt(mask, y).length) rowsWithInk.push(y);
  const bands = []; let cur = null;
  for (const y of rowsWithInk) { if (cur && y === cur[1] + 1) cur[1] = y; else { cur = [y, y]; bands.push(cur); } }
  if (bands.length !== 2) throw new Error(`expected 2 row bands (bar, Y), got ${bands.length}`);
  const [barRows, yRows] = bands;
  const barRun = runsAt(mask, barRows[0])[0];
  const bar = { x: barRun[0], y: barRows[0], width: barRun[1] + 1 - barRun[0], height: barRows[1] + 1 - barRows[0] };
  // the Y: two runs per row until the arms merge, one run after
  let merge = null; for (let y = yRows[0]; y <= yRows[1]; y++) if (runsAt(mask, y).length === 1) { merge = y; break; }
  const outerL = []; const outerR = []; const innerL = []; const innerR = [];
  for (let y = yRows[0]; y <= yRows[1]; y++) {
    const r = runsAt(mask, y);
    outerL.push([r[0][0], y]); outerR.push([r[r.length - 1][1] + 1, y]);
    if (r.length === 2) { innerL.push([r[0][1] + 1, y]); innerR.push([r[1][0], y]); }
  }
  // close each edge at pixel bottoms so the chains meet at pixel edges
  const y0 = yRows[0]; const y1 = yRows[1] + 1;
  const ol = simplify([[outerL[0][0], y0], ...outerL.slice(1).map(([x, y]) => [x, y]), [outerL[outerL.length - 1][0], y1]], tol);
  const or = simplify([[outerR[0][0], y0], ...outerR.slice(1), [outerR[outerR.length - 1][0], y1]], tol);
  const il = simplify([[innerL[0][0], y0], ...innerL.slice(1), [innerL[innerL.length - 1][0], merge]], tol);
  const ir = simplify([[innerR[0][0], y0], ...innerR.slice(1), [innerR[innerR.length - 1][0], merge]], tol);
  // clockwise: outer-left top -> inner-left top, down the inner-left edge to the
  // notch, up the inner-right edge, across to outer-right top, down the outer
  // right edge, along the bottom, back up the outer left edge.
  const poly = [...il, ...ir.slice().reverse().slice(1), ...or, ...ol.slice().reverse()];
  const dedup = poly.filter((p, i) => i === 0 || p[0] !== poly[i - 1][0] || p[1] !== poly[i - 1][1]);
  if (dedup.length > 1 && dedup[0][0] === dedup[dedup.length - 1][0] && dedup[0][1] === dedup[dedup.length - 1][1]) dedup.pop();
  return { bar, y: dedup, merge, yRows };
}

/** Even-odd scanline fill at pixel centres, like a renderer without AA. */
export function rasterize(W, H, bar, poly) {
  const m = new Uint8Array(W * H);
  for (let y = bar.y; y < bar.y + bar.height; y++) for (let x = bar.x; x < bar.x + bar.width; x++) m[y * W + x] = 1;
  for (let y = 0; y < H; y++) {
    const cy = y + 0.5; const xs = [];
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i]; const [x2, y2] = poly[(i + 1) % poly.length];
      if ((y1 <= cy && y2 > cy) || (y2 <= cy && y1 > cy)) xs.push(x1 + (cy - y1) * (x2 - x1) / (y2 - y1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k] - 0.5); x + 0.5 < xs[k + 1]; x++) if (x >= 0 && x < W) m[y * W + x] = 1;
  }
  return m;
}

export function diffCount(a, b) { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; }

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const png = decodePng(readFileSync(ICON)); const mask = iconMask(png);
  const t = trace(mask);
  console.log('bar   :', JSON.stringify(t.bar));
  console.log('Y     :', t.y.map((p) => p.join(',')).join(' '), `(${t.y.length} vertices, arms merge at row ${t.merge})`);
  const r = rasterize(mask.W, mask.H, t.bar, t.y); const d = diffCount(r, mask.m);
  console.log(`diff  : ${d} of ${mask.W * mask.H} px disagree = ${(100 * d / (mask.W * mask.H)).toFixed(4)}%`);
}
