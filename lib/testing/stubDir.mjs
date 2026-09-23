// lib/testing/stubDir.mjs - where a mount test's module stubs live.
//
// A MOUNT TEST WRITES REAL FILES. It stubs 'next/link', a .css import or a server
// action by writing a tiny .mjs and pointing the resolver at it, and those files
// used to be written NEXT TO THE TEST, inside app/ and components/.
//
// TWO THINGS THAT COST US. First, eslint walks the same tree: a run that started
// while the suite was running died outright with
//
//     ENOENT: no such file or directory, open 'app/nfl/game/__follows_stub.mjs'
//
// because the stub was unlinked between eslint listing the tree and reading it.
// Second, a suite killed mid-run left the stubs behind as untracked .mjs files in
// source directories, and the next lint counted them as thirty new problems.
//
// SO THEY LIVE IN ONE PLACE, test-tmp/ at the repo root: eslint-ignored and
// git-ignored, outside every source directory a guard or a linter walks. The test
// still creates and removes its own stubs - that has not changed, and a stub that
// outlives its test is still a bug - but when one does outlive it, it lands
// somewhere that costs nothing.
//
// THE PID IS PART OF THE NAME. `node --test` gives each test FILE its own process,
// and four different tests each wanted a stub called '__css_stub.mjs'. Next to the
// test those were four paths; in one directory they would have been one file and a
// race. The pid separates them, and makes a leftover traceable to its run.

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The one directory. Ignored by eslint (eslint.config.mjs) and by git. */
export const STUB_DIR = path.join(REPO, 'test-tmp');

/**
 * An absolute path for one stub file, its directory created.
 *
 * @param name  the stub's own name, e.g. '__css_stub.mjs'
 */
export function stubPath(name) {
  mkdirSync(STUB_DIR, { recursive: true });
  return path.join(STUB_DIR, `${process.pid}-${name}`);
}
