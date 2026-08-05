// app/sim/draft/errorBoundary.test.mjs — the draft-room error boundary.
//
// IT LIVES ONE DIRECTORY ABOVE THE CODE IT TESTS, deliberately. `node --test`
// resolves its arguments as globs, and `[id]` is a character class - a test file
// inside app/sim/draft/[id]/ is matched by nothing and reports "# tests 0"
// WITHOUT failing. A test suite that silently runs zero tests is the worst
// possible failure mode, so nothing testable goes under a bracketed segment.
// The last assertion in this file enforces that for the whole repo.
//
// The back-route is the part that can genuinely be wrong, and the part that
// matters most: a recovery button pointing at the wrong URL is a dead end
// wearing the costume of an exit. It lives in errorCopy.js precisely so it can
// be executed here rather than grepped for - JSX cannot be rendered under
// node --test in this repo.
//
// The boundary's placement and its logging are asserted on source, because
// getting either wrong is silent: a boundary mounted a segment too high quietly
// swallows the lobby, and one that forgets to log makes failures softer for
// readers AND quieter for us, which is strictly worse than no boundary.
//
// WHAT IS *NOT* ASSERTED HERE, and why. The brief asked to pin "a component that
// throws renders the branded page, not a 500". That is true for a client
// re-render (the board-tab class) and FALSE for a throw during the initial
// server render, which kills the streamed shell before any boundary exists -
// measured in a production build, not guessed. Asserting the general claim would
// be asserting something I know to be untrue for half the cases. Driving a real
// post-hydration re-render needs a browser, which this repo has none of, so that
// half is verified by hand and reported rather than faked here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOM_ERROR, roomHrefFrom } from './[id]/errorCopy.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const BOUNDARY = 'app/sim/draft/[id]/error.js';

// ---------------------------------------------------------------------------
// The back-route
// ---------------------------------------------------------------------------

test('the back-route returns to the room the reader was actually in', () => {
  assert.equal(roomHrefFrom('/sim/draft/22'), '/sim/draft/22');
  assert.equal(roomHrefFrom('/sim/draft/1085'), '/sim/draft/1085');
  // A trailing segment (or slash) still resolves to the room root, which is the
  // entry the resume tests prove rebuilds full state.
  assert.equal(roomHrefFrom('/sim/draft/22/'), '/sim/draft/22');
  assert.equal(roomHrefFrom('/sim/draft/22/card'), '/sim/draft/22');
});

test('a path that is not a room falls back to the lobby rather than guessing', () => {
  for (const p of ['/sim', '/sim/tracker', '/sim/account', '/nfl', '/', '']) {
    assert.equal(roomHrefFrom(p), '/sim', `${p} must fall back to the lobby`);
  }
  // Missing/garbage input must not throw - this runs inside an error screen,
  // and a boundary that throws is no boundary at all.
  assert.equal(roomHrefFrom(null), '/sim');
  assert.equal(roomHrefFrom(undefined), '/sim');
});

test('a non-numeric id is refused, never echoed into a navigation target', () => {
  // The route does Number(id), so these were never real rooms; reflecting an
  // arbitrary path segment straight back into an href is how that class of bug
  // starts.
  for (const p of ['/sim/draft/abc', '/sim/draft/../admin', '/sim/draft/22x', '/sim/draft/']) {
    assert.equal(roomHrefFrom(p), '/sim', `${p} must not become a link target`);
  }
});

// ---------------------------------------------------------------------------
// Placement and blast radius
// ---------------------------------------------------------------------------

test('the boundary sits at the tightest segment covering BOTH rooms', () => {
  assert.ok(existsSync(path.join(REPO, BOUNDARY)), 'the room segment must have an error.js');
  // Both live rooms and both results views render from this one page, so this
  // segment covers them all.
  const page = src('app/sim/draft/[id]/page.js');
  for (const c of ['<TrackerRoom', '<DraftRoom', '<TrackerResults', '<DraftResults']) {
    assert.ok(page.includes(c), `${c} must be inside the guarded segment`);
  }
  // Mounted no higher: the lobby and the other sim routes keep their behaviour.
  assert.ok(!existsSync(path.join(REPO, 'app/sim/error.js')),
    'a /sim boundary would pull the lobby, tracker setup and account into the blast radius');
});

test('IapConfigure stays outside the boundary', () => {
  // Constraint: the boundary must not be able to take down the shell's own
  // machinery. IapConfigure is never mounted in the room, and this fails if a
  // future change puts it there.
  const page = src('app/sim/draft/[id]/page.js');
  assert.ok(!page.includes('<IapConfigure'),
    'IapConfigure must not be mounted inside the guarded segment');
});

// ---------------------------------------------------------------------------
// It must not make failures quieter for us
// ---------------------------------------------------------------------------

test('the caught error is logged in full, and shown in none', () => {
  const code = stripComments(src(BOUNDARY));
  assert.match(code, /console\.error\(/, 'the boundary must log what it caught');
  for (const field of ['message', 'digest', 'stack']) {
    assert.ok(code.includes(field), `the log must carry ${field} to be diagnosable`);
  }
  // ...and none of it may reach the screen. The only error-derived value
  // rendered is the digest, which is a correlation id rather than error text.
  const jsx = code.slice(code.indexOf('return ('));
  assert.ok(!jsx.includes('error.stack'), 'no stack trace in the UI');
  assert.ok(!jsx.includes('error.message'), 'no raw error text in the UI');
});

test('the screen offers a way back IN and a way OUT', () => {
  const code = stripComments(src(BOUNDARY));
  assert.match(code, /href=\{roomHref\}/, 'primary action must re-enter the room');
  assert.match(code, /onClick=\{\(\) => reset\(\)\}/, 'must offer the boundary retry');
  assert.match(code, /ROOM_ERROR\.lobbyHref/, 'must never trap a reader in a room that will not open');
  // Copy stays in register: one plain sentence, no apology theatre.
  assert.ok(!/sorry/i.test(ROOM_ERROR.body + ROOM_ERROR.head), 'no apology theatre');
  assert.ok(ROOM_ERROR.body.includes('saved'), 'must tell the reader their draft survived');
});

test('no test file hides under a dynamic-route segment', () => {
  // node --test globs its arguments, so `[id]` is a character class and any
  // *.test.mjs beneath one is silently skipped - it reports zero tests and exits
  // clean. This caught exactly that while writing this file.
  const hidden = [];
  const walk = (rel) => {
    for (const d of readdirSync(path.join(REPO, rel), { withFileTypes: true })) {
      const next = `${rel}/${d.name}`;
      if (d.isDirectory()) { walk(next); continue; }
      if (d.name.endsWith('.test.mjs') && /\[[^\]]+\]/.test(next)) hidden.push(next);
    }
  };
  for (const root of ['app', 'lib', 'components']) walk(root);
  assert.deepEqual(hidden, [],
    `these would be silently skipped by node --test:\n${hidden.join('\n')}`);
});
