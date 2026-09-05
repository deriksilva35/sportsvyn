// lib/testing/renderJsx.mjs - compile one JSX component export and render it
// to a real HTML string, for a test that must see RENDERED OUTPUT rather
// than JSX source text (relay 2c item 1's own distinction: a source-level
// grep passed on components/games/preOpenLine.js's old, buggy version
// because the space genuinely was in the source - the bug only exists once
// the JSX is actually rendered).
//
// DELIBERATELY NARROW. It refuses a source file that imports anything but
// 'react': any other import is either a Next-only alias ('@/...') that does
// not resolve outside Next's own build, or a real module this helper has no
// business dragging into a unit test. A component with a real dependency is
// not what this helper is for - keep the tested component down to plain
// JSX and props, the way components/games/preOpenLine.js is.
//
// A REAL TEMP FILE, NOT A data: IMPORT. Node cannot resolve a bare
// specifier like "react" from inside a data: URL module (no base path to
// resolve node_modules against) - confirmed empirically before writing
// this. Compiling to a file under the project root, where the ordinary
// node_modules resolution algorithm already applies, is what actually
// works; it is written under the caller's directory and removed in a
// `finally` either way.
//
// NOTE ON COVERAGE: this uses @babel/preset-react's classic-runtime
// transform plus react-dom/server's renderToStaticMarkup - NOT the RSC
// "Flight" pipeline app-router server components actually render through.
// A hand test against a real Vercel preview is what caught relay 2c's
// glued-middot bug in the first place, and remains the authority for
// whether a fix actually lands; this test guards the general JSX
// whitespace-collapse footgun (a text child starting right after a closing
// tag, continuing onto the next source line, loses its own leading space),
// which is real and independently worth pinning regardless of engine.

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { transformSync } from '@babel/core';

let seq = 0;

export async function renderJsxExport(filePath, exportName, props = {}) {
  const src = readFileSync(filePath, 'utf8');
  const imports = [...src.matchAll(/^import .*$/gm)].map((m) => m[0]);
  const foreign = imports.filter((l) => !/from ['"]react['"]/.test(l));
  if (foreign.length) {
    throw new Error(`renderJsxExport: ${filePath} imports more than react - ${foreign.join(' | ')}`);
  }

  const { code } = transformSync(src, {
    filename: filePath,
    presets: [['@babel/preset-react', { runtime: 'classic' }]],
  });

  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.tmp-renderjsx-${process.pid}-${seq++}.mjs`);
  writeFileSync(tmp, code);
  try {
    const mod = await import(`${path.resolve(tmp)}?t=${Date.now()}`);
    const Component = mod[exportName];
    if (!Component) throw new Error(`renderJsxExport: ${filePath} has no export '${exportName}'`);
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');
    return renderToStaticMarkup(createElement(Component, props));
  } finally {
    unlinkSync(tmp);
  }
}
