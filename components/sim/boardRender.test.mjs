// components/sim/boardRender.test.mjs — the draft-room board render paths.
//
// WHY THIS FILE EXISTS. A module-scope component in TrackerRoom.js called a
// helper declared INSIDE the component (isRookieId, a useCallback). That is a
// ReferenceError the instant any real pick renders, and it took the tracker
// board down in production for every reader with at least one pick logged.
//
// Everything that was supposed to catch it did not: the build compiled, the
// 585-test suite passed, and the source-assertion tests I had written all
// checked the FILTER and the UNDO path, never the board render. The one tool
// that could have seen it was lint, and no-undef was off.
//
// So the first test here runs ESLint for real rather than reading the source
// for a pattern. A grep can be satisfied by a comment; a linter cannot.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const ROOMS = ['components/sim/TrackerRoom.js', 'components/sim/DraftRoom.js'];

test('no room component reaches for an identifier it cannot see', { timeout: 120000 }, async () => {
  // The real check, not a proxy for it. If a module-scope component ever again
  // calls something declared inside the component function, no-undef fails here.
  const eslint = new ESLint({ cwd: REPO });
  const results = await eslint.lintFiles(ROOMS);
  const undef = results.flatMap((r) => r.messages
    .filter((m) => m.ruleId === 'no-undef')
    .map((m) => `${path.relative(REPO, r.filePath)}:${m.line}:${m.column} ${m.message}`));
  assert.deepEqual(undef, [], `undefined reference in a room render path:\n${undef.join('\n')}`);
});

test('the no-undef rule stays switched on for the app source', () => {
  // Pins the systemic guard itself. Turning this off would silently re-open the
  // exact hole - the repo is JavaScript, so nothing else is checking.
  //
  // LINE comments only here. The generic stripper also removes /* ... */, and a
  // glob like 'app/**/*.js' contains `/*` followed by `*/` - stripping block
  // comments silently rewrites it to 'app.js' and the assertion fails against a
  // config that is perfectly correct. Cost me a red test to notice.
  const cfg = src('eslint.config.mjs').replace(/^\s*\/\/.*$/gm, '');
  assert.match(cfg, /'no-undef':\s*'error'/, 'no-undef must remain an error');
  for (const glob of ['app/**/*.js', 'components/**/*.js', 'lib/**/*.js']) {
    assert.ok(cfg.includes(glob), `no-undef must still cover ${glob}`);
  }
});

test('the board list takes its rookie set as a PROP, never from component scope', () => {
  const code = stripComments(src('components/sim/TrackerRoom.js'));
  // The component is declared at module scope...
  assert.match(code, /^function BoardList\(\{/m, 'BoardList is module-scope');
  // ...so the set it renders chips from must arrive through its signature.
  const sig = code.slice(code.indexOf('function BoardList({'), code.indexOf(') {', code.indexOf('function BoardList({')));
  assert.ok(sig.includes('rookieIds'), 'rookieIds must be a declared prop');
  // ...and it must actually be passed at the call site.
  assert.match(code, /<BoardList[\s\S]{0,400}rookieIds=\{rookieIds\}/, 'the room must pass rookieIds down');
  // The exact reach that broke production must not come back.
  const body = code.slice(code.indexOf('function BoardList({'));
  assert.ok(!body.includes('isRookieId('),
    'BoardList must not call isRookieId - it is declared inside TrackerRoom and is not in scope here');
});

test('an unrenderable row degrades to a dash instead of taking the board down', () => {
  const code = stripComments(src('components/sim/TrackerRoom.js'));
  // The row build is wrapped, so one bad pick costs one row.
  assert.match(code, /try\s*\{[\s\S]{0,200}buildBoardRow\(/,
    'row construction must be guarded');
  assert.match(code, /catch[\s\S]{0,120}<UnrenderableRow/,
    'a throwing row must fall back to the dash row, not propagate');
  // And the fallback must say something rather than render blank: a silent gap
  // reads as "nobody picked here", which is a different and wrong claim.
  const fallback = code.slice(code.indexOf('function UnrenderableRow'));
  assert.ok(fallback.includes('—'), 'the fallback row must show the absence marker');
});
