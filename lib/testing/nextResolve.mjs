// lib/testing/nextResolve.mjs - a Node module-resolution hook that makes a
// Next.js CLIENT COMPONENT importable from a plain `node --test` process.
//
// WHY THIS EXISTS. lib/testing/renderJsx.mjs deliberately refuses any
// component that imports more than 'react', and that is the right rule for
// what it does - compile one small JSX export and render it to a string. But
// it cannot reach a component like components/daily/season/SeasonBoard.js,
// which imports '@/lib/...' aliases, './seasonBoard.css' and 'next/link'.
// Those are the components with BEHAVIOUR, and behaviour is exactly what a
// module-level test cannot see: /api/daily/board/run had zero callers at
// every commit it existed for, the whole submit path was dead, and every
// module test still passed because they called submitRun() directly.
//
// TWO HOOKS, NOTHING CLEVER:
//   '@/x'    -> <repo>/x, trying the extensions Next resolves
//   '*.css'  -> an empty module, because Next's build swallows CSS imports
//               and Node cannot parse them
// Everything else falls through to normal resolution, so 'react',
// 'react-dom' and 'next/link' load from node_modules as they already do.
//
// registerHooks(), NOT register(). register() runs hooks on a SEPARATE
// THREAD, where babel's resolveSync() is not implemented - every attempt to
// transform JSX there dies with ERR_METHOD_NOT_IMPLEMENTED, whether the
// preset is named, resolved to an absolute path, or reduced to the leaf JSX
// plugin. registerHooks() (node >= 22.15) runs them SYNCHRONOUSLY on the main
// thread, where babel works normally.
//
// CALL install() FROM INSIDE THE TEST, not on the command line: the suite runs
// as `node --test $(find . -name '*.test.mjs')` with no extra flags, so a test
// that needs this imports install(), calls it, and then dynamic-imports the
// component. See components/daily/season/seasonBoardSubmit.test.mjs.

import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { transformSync } from '@babel/core';
import { createRequire, registerHooks } from 'node:module';

// THE JSX PLUGIN DIRECTLY, BY ABSOLUTE PATH, AND NOT THE PRESET. Module hooks
// run on their own thread, where babel's resolveSync() is not implemented, so
// anything that resolves by NAME throws ERR_METHOD_NOT_IMPLEMENTED. Naming the
// preset by absolute path is not enough either - preset-react then resolves
// its own sub-plugins the same way and fails identically. The leaf plugin
// resolves nothing, so it is the one that works here.
const PLUGIN_JSX = createRequire(import.meta.url).resolve('@babel/plugin-transform-react-jsx');

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const EXTS = ['', '.js', '.jsx', '.mjs', '/index.js'];

function resolveHook(specifier, context, next) {
  if (specifier.endsWith('.css')) {
    return { url: pathToFileURL(path.join(REPO, 'lib/testing/emptyCss.mjs')).href, shortCircuit: true };
  }
  if (specifier.startsWith('@/')) {
    const base = path.join(REPO, specifier.slice(2));
    for (const ext of EXTS) {
      if (existsSync(base + ext)) {
        return { url: pathToFileURL(base + ext).href, shortCircuit: true };
      }
    }
    throw new Error(`nextResolve: cannot resolve ${specifier} under ${REPO}`);
  }
  // next/link and friends are CJS files that Next's own bundler resolves
  // extensionlessly; plain ESM resolution needs the '.js'. Try the bare
  // specifier first so anything with a proper exports map still wins.
  if (/^next\/[a-z-]+$/.test(specifier)) {
    try {
      return next(specifier, context);
    } catch {
      return next(`${specifier}.js`, context);
    }
  }
  return next(specifier, context);
}

// A LOAD HOOK TOO, because resolving is only half of it: SeasonBoard imports
// other components (StandaloneTime, and whatever they import) whose sources
// are also JSX, and Node parses them raw -> "Unexpected token '<'". Anything
// under the repo but outside node_modules gets the same preset-react
// transform the test applies to the component under test.
const NODE_MODULES = `${path.sep}node_modules${path.sep}`;

function loadHook(url, context, next) {
  if (!url.startsWith('file:')) return next(url, context);
  const file = fileURLToPath(url);
  if (!file.startsWith(REPO) || file.includes(NODE_MODULES)) return next(url, context);
  if (!/\.(js|jsx|mjs)$/.test(file)) return next(url, context);

  const src = readFileSync(file, 'utf8');
  // Cheap gate: only pay for babel on files that actually carry JSX or the
  // 'use client' banner Node would otherwise treat as a stray expression.
  if (!/<[A-Za-z/]/.test(src) && !src.startsWith("'use client'")) return next(url, context);

  const code = transformSync(src, {
    filename: file,
    plugins: [[PLUGIN_JSX, { runtime: 'automatic' }]],
    configFile: false, babelrc: false, sourceType: 'module',
  }).code.replace(/^'use client';\s*/m, '');
  return { format: 'module', source: code, shortCircuit: true };
}

let installed = false;
export function install() {
  if (installed) return;
  registerHooks({ resolve: resolveHook, load: loadHook });
  installed = true;
}
